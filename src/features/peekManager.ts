import * as vscode from 'vscode';
import * as path from 'path';
import { StorageManager } from '../storage/storageManager.js';
import { ConfigManager } from '../config/index.js';
import { ProviderRegistry } from '../providers/registry.js';
import { StreamAnimator } from './streamAnimator.js';

/**
 * In-memory virtual document provider for Code Peek View
 * URI scheme: anycomment-peek://<filename> - CodePeek.md
 */
export class AnyCommentDocContentProvider implements vscode.TextDocumentContentProvider {
  public static readonly scheme = 'anycomment-peek';
  private onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
  public readonly onDidChange: vscode.Event<vscode.Uri> = this.onDidChangeEmitter.event;

  private contents = new Map<string, string>();

  public provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contents.get(uri.toString()) ?? '# AnyComment\n\n正在加载代码内联透视内容...';
  }

  public setContent(uri: vscode.Uri, content: string): void {
    this.contents.set(uri.toString(), content);
    this.onDidChangeEmitter.fire(uri);
  }
}

/**
 * Manages Code Peek View (代码内联透视) between code lines
 * Leverages native VS Code editor.action.peekLocations with zero external dependencies
 */
export class PeekManager {
  private static docProvider: AnyCommentDocContentProvider;

  public static initialize(context: vscode.ExtensionContext): void {
    PeekManager.docProvider = new AnyCommentDocContentProvider();
    context.subscriptions.push(
      vscode.workspace.registerTextDocumentContentProvider(
        AnyCommentDocContentProvider.scheme,
        PeekManager.docProvider
      )
    );
  }

  public static async openPeek(options: {
    document: vscode.TextDocument;
    position: vscode.Position;
    text: string;
    signature?: string;
    forceRefresh?: boolean;
    editor?: vscode.TextEditor;
  }): Promise<void> {
    const configMgr = ConfigManager.getInstance();
    const config = configMgr.getConfig();
    const storageMgr = StorageManager.getInstance();
    const editor = options.editor ?? vscode.window.activeTextEditor;

    const fileName = path.basename(options.document.fileName);
    const virtualUri = vscode.Uri.parse(
      `${AnyCommentDocContentProvider.scheme}://${encodeURIComponent(fileName)} - 代码内联透视.md`
    );

    const cachedLiteral = options.forceRefresh
      ? null
      : storageMgr.get(options.text, config.targetLanguage, 'literal-accurate');
    const cachedExplain = options.forceRefresh
      ? null
      : storageMgr.get(options.text, config.targetLanguage, config.explainStyle);

    // 1. If both are cached, render full document immediately in 0ms
    if (cachedLiteral && cachedExplain) {
      const fullDoc = PeekManager.formatDocument({
        fileName,
        literal: cachedLiteral.translation,
        explanation: cachedExplain.translation,
        sourceText: options.text,
        signature: options.signature,
        isCached: true,
      });
      PeekManager.docProvider.setContent(virtualUri, fullDoc);

      await vscode.commands.executeCommand(
        'editor.action.peekLocations',
        options.document.uri,
        options.position,
        [new vscode.Location(virtualUri, new vscode.Position(0, 0))],
        'peek'
      );
      return;
    }

    // 2. Open peek view immediately with structured loading skeleton
    const loadingDoc = PeekManager.formatLoadingDocument({
      fileName,
      provider: config.activeProvider,
      sourceText: options.text,
      signature: options.signature,
    });
    PeekManager.docProvider.setContent(virtualUri, loadingDoc);

    // Start restrained inline waiting pulse on editor line
    if (editor) {
      StreamAnimator.getInstance().start(editor, options.position.line, '正在生成代码透视与双语对照');
    }

    await vscode.commands.executeCommand(
      'editor.action.peekLocations',
      options.document.uri,
      options.position,
      [new vscode.Location(virtualUri, new vscode.Position(0, 0))],
      'peek'
    );

    // 3. Asynchronously fetch literal translation & technical interpretation progressively
    try {
      let literalText = cachedLiteral?.translation;
      let explainText = cachedExplain?.translation;

      // 3.1 Fetch literal first (fast MT / baseline, usually ~200-800ms)
      if (!literalText) {
        try {
          const googleRes = await ProviderRegistry.getInstance().getProvider('google').translate({
            sourceText: options.text,
            targetLang: config.targetLanguage,
            style: configMgr.getTranslationStyle('literal-accurate'),
          });
          literalText = googleRes.translatedText;
          await storageMgr.saveStandardTranslation(
            options.text,
            config.targetLanguage,
            literalText,
            'google'
          );

          // Progressive live update: show Chinese literal translation immediately as soon as ready!
          const progressiveDoc = PeekManager.formatDocument({
            fileName,
            literal: literalText,
            explanation: '> ⏳ 正在深度解析代码上下文并生成工程师通俗解读，即将就绪...',
            sourceText: options.text,
            signature: options.signature,
            isCached: false,
          });
          PeekManager.docProvider.setContent(virtualUri, progressiveDoc);
        } catch {
          literalText = '(公共翻译通道暂不可用，等待大模型解读)';
        }
      }

      // 3.2 Fetch plain technical explanation if missing
      if (!explainText) {
        const explainStyle = configMgr.getExplainStyle(config.explainStyle);
        let userPrompt = explainStyle.userPromptTemplate;
        if (options.signature) {
          userPrompt = userPrompt.replace(
            /\{context_info\}/g,
            `[代码上下文定义]:\n\`\`\`\n${options.signature}\n\`\`\``
          );
        } else {
          userPrompt = userPrompt.replace(/\{context_info\}\n*/g, '');
        }

        const explainRes = await ProviderRegistry.getInstance().executeTranslation({
          sourceText: options.text,
          targetLang: config.targetLanguage,
          style: { ...explainStyle, userPromptTemplate: userPrompt },
        });

        explainText = explainRes.translatedText;
        await storageMgr.saveCustomTranslation(
          options.text,
          config.targetLanguage,
          explainStyle.id,
          explainText,
          explainRes.model,
          explainRes.providerId
        );
      }

      // 4. Live update open Peek View with finalized bilingual contrast
      const resolvedDoc = PeekManager.formatDocument({
        fileName,
        literal: literalText || '(未获取到直译)',
        explanation: explainText || '(未获取到技术解读)',
        sourceText: options.text,
        signature: options.signature,
        isCached: false,
      });
      PeekManager.docProvider.setContent(virtualUri, resolvedDoc);

      StreamAnimator.getInstance().stop('中文解析已就绪');
    } catch (err: unknown) {
      StreamAnimator.getInstance().stop();
      const message = err instanceof Error ? err.message : String(err);
      const errorDoc = `# ❌ AnyComment 解析失败\n\n**提示信息**: ${message}\n\n可在命令面板使用 \`AnyComment: Set API Key\` 配置大模型密钥。`;
      PeekManager.docProvider.setContent(virtualUri, errorDoc);
    }
  }

  private static formatLoadingDocument(data: {
    fileName: string;
    provider: string;
    sourceText: string;
    signature?: string;
  }): string {
    return [
      `# 📖 代码内联透视: ${data.fileName}`,
      '',
      `_⚡ 状态: 正在联机生成中文对照与技术解读..._`,
      '',
      '---',
      '### 🌐 中文直译 (Literal Translation)',
      '> ⏳ 正在联机解析英文注释语义，即将呈现准确中文直译...',
      '',
      '---',
      '### 💡 工程师通俗解读 (Plain Technical Interpretation)',
      '> ⏳ 正在结合代码上下文推导技术原理与底层逻辑...',
      '',
      data.signature ? `--- \n### 🔍 关联代码签名\n\`\`\`\n${data.signature}\n\`\`\`\n` : '',
      '---',
      '### 📄 原始代码注释对照',
      '```',
      data.sourceText,
      '```',
    ].filter(Boolean).join('\n');
  }

  private static formatDocument(data: {
    fileName: string;
    literal: string;
    explanation: string;
    sourceText: string;
    signature?: string;
    isCached: boolean;
  }): string {
    const statusTag = data.isCached ? '状态: `本地分隔离缓存秒出`' : '状态: `AI 实时解析生成`';

    return [
      `# 📖 代码内联透视: ${data.fileName}`,
      `_${statusTag}_\n`,
      '---',
      '### 🌐 中文直译 (Literal Translation)',
      data.literal,
      '',
      '---',
      '### 💡 工程师通俗解读 (Plain Technical Interpretation)',
      data.explanation,
      '',
      data.signature ? `--- \n### 🔍 关联代码签名\n\`\`\`\n${data.signature}\n\`\`\`\n` : '',
      '---',
      '### 📄 原始代码注释对照',
      '```',
      data.sourceText,
      '```',
    ].filter(Boolean).join('\n');
  }
}
