import * as vscode from 'vscode';
import * as path from 'path';
import { ConfigManager } from './config/index.js';
import { StorageManager } from './storage/storageManager.js';
import { ProviderRegistry } from './providers/registry.js';
import { AnyCommentHoverProvider } from './features/hoverProvider.js';
import { ImmersiveDecorator } from './features/immersiveDecorator.js';
import { StatusBarManager } from './features/statusBar.js';
import { AnyCommentViewProvider } from './webview/panel.js';
import { OnboardingWizard } from './features/onboarding.js';
import { PeekManager } from './features/peekManager.js';
import { CommentExtractor } from './parser/commentExtractor.js';
import { StreamAnimator } from './features/streamAnimator.js';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  console.log('[AnyComment] Activating personal translation extension...');

  // 1. Initialize ConfigManager
  const configMgr = ConfigManager.initialize(context);

  // 2. Initialize StorageManager with globalStorageUri & bundled seeds
  const storageDir = context.globalStorageUri.fsPath;
  const bundledSeedsPath = path.join(context.extensionPath, 'assets', 'seeds', 'standard_seeds.json');
  const storageMgr = StorageManager.initialize(storageDir);
  await storageMgr.init(bundledSeedsPath);

  // 3. Initialize Providers
  const providerRegistry = ProviderRegistry.getInstance();

  // 4. Register Hover Provider for all programming languages and untitled buffers
  const hoverProvider = vscode.languages.registerHoverProvider(
    [{ scheme: 'file' }, { scheme: 'untitled' }],
    new AnyCommentHoverProvider()
  );
  context.subscriptions.push(hoverProvider);

  // 5. Register Immersive Decorator (Cmd+Shift+B)
  const immersiveDecorator = new ImmersiveDecorator();
  immersiveDecorator.register(context);

  // 6. Register Status Bar Switcher
  const statusBarManager = new StatusBarManager();
  statusBarManager.register(context);

  // 7. Register Sidebar Control Center Webview
  const viewProvider = new AnyCommentViewProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(AnyCommentViewProvider.viewType, viewProvider)
  );

  // 8. Stream & Waiting Animator
  const streamAnimator = StreamAnimator.getInstance();
  context.subscriptions.push(streamAnimator);

  // 9. Register translateHover command
  const translateHoverCmd = vscode.commands.registerCommand(
    'anycomment.translateHover',
    async (args?: {
      text: string;
      forceExplain?: boolean;
      forceTranslate?: boolean;
      forceRefresh?: boolean;
      signature?: string;
      uri?: string;
      position?: { line: number; character: number };
    }) => {
      let textToTranslate = args?.text;

      if (!textToTranslate) {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
          if (!editor.selection.isEmpty) {
            textToTranslate = editor.document.getText(editor.selection).trim();
          } else {
            const comment = CommentExtractor.extractEnclosingComment(editor.document, editor.selection.active);
            if (comment) {
              textToTranslate = comment.cleanText;
              if (!args?.signature) {
                args = { ...args, signature: comment.associatedCodeSignature } as any;
              }
            } else {
              const str = CommentExtractor.extractEnclosingString(editor.document, editor.selection.active);
              if (str) {
                textToTranslate = str;
              } else {
                const inline = CommentExtractor.extractInlineComment(editor.document, editor.selection.active.line);
                if (inline) {
                  textToTranslate = inline;
                }
              }
            }
          }
        }
      }

      if (!textToTranslate) {
        textToTranslate = await vscode.window.showInputBox({
          prompt: '请输入要翻译或大白话解析的代码注释/英文文本：',
        });
      }

      if (!textToTranslate) {
        return;
      }

      if (args?.forceExplain) {
        await configMgr.setEnableExplainMode(true);
      } else if (args?.forceTranslate) {
        await configMgr.setEnableExplainMode(false);
      }

      const config = configMgr.getConfig();
      const isExplain = args?.forceExplain ?? (args?.forceTranslate ? false : config.enableExplainMode);

      const style = isExplain
        ? configMgr.getExplainStyle(config.explainStyle)
        : configMgr.getTranslationStyle(config.activeStyle);

      // Inject associated code signature into template if available
      let userPrompt = style.userPromptTemplate;
      if (args?.signature) {
        userPrompt = userPrompt.replace(/\{context_info\}/g, `[代码上下文定义]:\n\`\`\`\n${args.signature}\n\`\`\``);
      } else {
        userPrompt = userPrompt.replace(/\{context_info\}\n*/g, '');
      }

      const effectiveStyle = {
        ...style,
        userPromptTemplate: userPrompt,
      };

      const actionTitle = isExplain ? `大白话讲解 (${style.name})` : `翻译 (${style.name})`;

      // 1. Immediately place an inline restrained waiting animation on the target line
      const editor = vscode.window.activeTextEditor;
      if (editor && args?.position) {
        StreamAnimator.getInstance().start(editor, args.position.line, `正在生成 ${actionTitle}`);
      }

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `AnyComment: 正在使用 [${config.activeProvider}] 生成 ${actionTitle}...`,
          cancellable: false,
        },
        async () => {
          try {
            const response = await providerRegistry.executeTranslation({
              sourceText: textToTranslate!,
              targetLang: config.targetLanguage,
              style: effectiveStyle,
            });

            if (!isExplain && (response.providerId === 'google' || style.id === 'literal-accurate')) {
              // Save to standard store baseline
              await storageMgr.saveStandardTranslation(
                textToTranslate!,
                config.targetLanguage,
                response.translatedText,
                response.providerId === 'google' ? 'google' : 'standard_ai'
              );
            } else {
              // Save to isolated custom style store
              await storageMgr.saveCustomTranslation(
                textToTranslate!,
                config.targetLanguage,
                style.id,
                response.translatedText,
                response.model,
                response.providerId
              );
            }

            // Stop waiting animation and display crisp Chinese preview
            StreamAnimator.getInstance().stop(
              response.translatedText.length > 20
                ? `${response.translatedText.slice(0, 20)}...`
                : response.translatedText
            );

            // Refresh decorations and views
            immersiveDecorator.updateActiveEditor();
            viewProvider.sendCurrentState();

            // Re-trigger hover card in place at target position with active editor focus
            if (editor) {
              if (args?.position) {
                const pos = new vscode.Position(args.position.line, args.position.character);
                editor.selection = new vscode.Selection(pos, pos);
              }
              await vscode.window.showTextDocument(editor.document, {
                viewColumn: editor.viewColumn,
                preserveFocus: false,
              });
              // Delay slightly so VS Code's editor focus settles before showing hover
              setTimeout(() => {
                vscode.commands.executeCommand('editor.action.showHover');
              }, 80);
            } else {
              vscode.window.setStatusBarMessage(`AnyComment: ${actionTitle}已完成并缓存`, 3000);
            }
          } catch (err: unknown) {
            StreamAnimator.getInstance().stop();
            const message = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage(`AnyComment 处理失败: ${message}`);
          }
        }
      );
    }
  );
  context.subscriptions.push(translateHoverCmd);

  // 10. Initialize PeekManager (Variant B: Native Code Peek)
  PeekManager.initialize(context);

  const openPeekCmd = vscode.commands.registerCommand(
    'anycomment.openPeek',
    async (args?: {
      text?: string;
      uri?: string;
      position?: { line: number; character: number };
      isExplain?: boolean;
      forceExplain?: boolean;
      forceTranslate?: boolean;
      forceRefresh?: boolean;
      signature?: string;
    }) => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('请先打开代码文件再使用代码内联透视');
        return;
      }

      const position = args?.position
        ? new vscode.Position(args.position.line, args.position.character)
        : editor.selection.active;

      let text = args?.text;
      let signature = args?.signature;

      if (!text) {
        if (!editor.selection.isEmpty) {
          text = editor.document.getText(editor.selection).trim();
          signature = CommentExtractor.findAssociatedSignature(editor.document, editor.selection.end.line);
        } else {
          // Try extracting enclosing comment or docstring
          const comment = CommentExtractor.extractEnclosingComment(editor.document, position);
          if (comment) {
            text = comment.cleanText;
            signature = comment.associatedCodeSignature;
          } else {
            const str = CommentExtractor.extractEnclosingString(editor.document, position);
            if (str) {
              text = str;
            } else {
              const inline = CommentExtractor.extractInlineComment(editor.document, position.line);
              if (inline) {
                text = inline;
              }
            }
          }
        }
      }

      if (!text) {
        text = await vscode.window.showInputBox({
          prompt: '请输入要在代码内联透视中解析的文本或注释：',
        });
      }

      if (!text) return;

      await PeekManager.openPeek({
        document: editor.document,
        position,
        text,
        signature,
        forceRefresh: args?.forceRefresh,
        editor,
      });
    }
  );
  context.subscriptions.push(openPeekCmd);

  // 11. Run First-time Onboarding Wizard if not completed
  if (!configMgr.getConfig().hasCompletedOnboarding) {
    // Run wizard asynchronously so extension activation is not blocked
    setTimeout(() => {
      OnboardingWizard.run().catch((e) => console.warn('[AnyComment] Onboarding error:', e));
    }, 1000);
  }

  console.log('[AnyComment] Activated successfully.');
}

export function deactivate(): void {
  console.log('[AnyComment] Deactivating...');
}
