import * as vscode from 'vscode';
import * as path from 'path';
import { StorageManager } from '../storage/storageManager.js';
import { ConfigManager } from '../config/index.js';
import { ProviderRegistry } from '../providers/registry.js';

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
  }): Promise<void> {
    const configMgr = ConfigManager.getInstance();
    const config = configMgr.getConfig();
    const storageMgr = StorageManager.getInstance();

    const fileName = path.basename(options.document.fileName);
    const virtualUri = vscode.Uri.parse(
      `${AnyCommentDocContentProvider.scheme}://${encodeURIComponent(fileName)} - 代码内联透视.md`
    );

    const cachedLiteral = storageMgr.get(options.text, config.targetLanguage, 'literal-accurate');
    const cachedExplain = storageMgr.get(options.text, config.targetLanguage, config.explainStyle);

    // 1. If both are cached, render full document immediately
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

    // 2. Open peek view immediately in 0ms with loading state
    const loadingDoc = PeekManager.formatLoadingDocument({
      fileName,
      provider: config.activeProvider,
      sourceText: options.text,
      signature: options.signature,
    });
    PeekManager.docProvider.setContent(virtualUri, loadingDoc);

    await vscode.commands.executeCommand(
      'editor.action.peekLocations',
      options.document.uri,
      options.position,
      [new vscode.Location(virtualUri, new vscode.Position(0, 0))],
      'peek'
    );

    // 3. Asynchronously fetch literal translation & technical interpretation
    try {
      let literalText = cachedLiteral?.translation;
      let explainText = cachedExplain?.translation;

      // 3.1 Fetch literal if missing
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
        } catch {
          literalText = '(机翻暂时不可用)';
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

      // 4. Live update open Peek View with pristine bilingual contrast
      const resolvedDoc = PeekManager.formatDocument({
        fileName,
        literal: literalText,
        explanation: explainText,
        sourceText: options.text,
        signature: options.signature,
        isCached: false,
      });
      PeekManager.docProvider.setContent(virtualUri, resolvedDoc);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const errorDoc = `# ❌ AnyComment 解析失败\n\n**错误信息**: ${message}\n\n请检查网络或大模型配置。`;
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
      `> ⏳ 正在调用 **[${data.provider}]** 分析代码上下文并生成双语对照与技术解读，请稍候...`,
      '',
      data.signature ? `### 🔍 关联代码签名\n\`\`\`\n${data.signature}\n\`\`\`\n` : '',
      '### 📄 原始代码注释',
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
