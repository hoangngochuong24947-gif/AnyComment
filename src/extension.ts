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

  // 4. Register Hover Provider for all programming languages
  const hoverProvider = vscode.languages.registerHoverProvider(
    { scheme: 'file' },
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

  // 8. Register translateHover command
  const translateHoverCmd = vscode.commands.registerCommand(
    'anycomment.translateHover',
    async (args?: {
      text: string;
      forceExplain?: boolean;
      forceTranslate?: boolean;
      forceRefresh?: boolean;
      signature?: string;
    }) => {
      let textToTranslate = args?.text;

      if (!textToTranslate) {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
          const selection = editor.selection;
          textToTranslate = editor.document.getText(selection).trim();
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

            // Refresh decorations and views
            immersiveDecorator.updateActiveEditor();
            viewProvider.sendCurrentState();

            vscode.window.showInformationMessage(
              `AnyComment (${response.model} · ${style.name}):\n\n${response.translatedText}`
            );
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage(`AnyComment 处理失败: ${message}`);
          }
        }
      );
    }
  );
  context.subscriptions.push(translateHoverCmd);

  // 9. Run First-time Onboarding Wizard if not completed
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
