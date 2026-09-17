import * as vscode from 'vscode';
import * as path from 'path';
import { StorageManager } from '../storage/storageManager.js';
import { ConfigManager } from '../config/index.js';
import { ProviderRegistry } from '../providers/registry.js';

/**
 * In-memory virtual document provider for Peek View
 * URI scheme: anycomment-peek://<filename> - <action>.md
 */
export class AnyCommentDocContentProvider implements vscode.TextDocumentContentProvider {
  public static readonly scheme = 'anycomment-peek';
  private onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
  public readonly onDidChange: vscode.Event<vscode.Uri> = this.onDidChangeEmitter.event;

  private contents = new Map<string, string>();

  public provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contents.get(uri.toString()) ?? '# AnyComment\n\n正在加载内容...';
  }

  public setContent(uri: vscode.Uri, content: string): void {
    this.contents.set(uri.toString(), content);
    this.onDidChangeEmitter.fire(uri);
  }
}

/**
 * Manages Variant C: Inline Peek Drawer between code lines
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
    isExplain?: boolean;
    signature?: string;
  }): Promise<void> {
    const configMgr = ConfigManager.getInstance();
    const config = configMgr.getConfig();
    const storageMgr = StorageManager.getInstance();
    const isExplain = options.isExplain ?? config.enableExplainMode;
    const style = isExplain
      ? configMgr.getExplainStyle(config.explainStyle)
      : configMgr.getTranslationStyle(config.activeStyle);

    const fileName = path.basename(options.document.fileName);
    const actionTitle = isExplain ? `大白话解析 (${style.name})` : `翻译 (${style.name})`;
    const virtualUri = vscode.Uri.parse(
      `${AnyCommentDocContentProvider.scheme}://${encodeURIComponent(fileName)} - ${encodeURIComponent(actionTitle)}.md`
    );

    const activeStyleId = isExplain ? config.explainStyle : config.activeStyle;
    const cached = storageMgr.get(options.text, config.targetLanguage, activeStyleId);

    if (cached) {
      // 1. If already cached, render full formatted document immediately
      const fullDoc = PeekManager.formatDocument({
        title: actionTitle,
        content: cached.translation,
        sourceText: options.text,
        signature: options.signature,
        model: cached.styleId || cached.source,
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

    // 2. If not cached, render instant loading skeleton and pop peek drawer immediately (0ms)
    const loadingDoc = PeekManager.formatLoadingDocument({
      title: actionTitle,
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

    // 3. Asynchronously fetch from provider
    try {
      let userPrompt = style.userPromptTemplate;
      if (options.signature) {
        userPrompt = userPrompt.replace(/\{context_info\}/g, `[代码上下文定义]:\n\`\`\`\n${options.signature}\n\`\`\``);
      } else {
        userPrompt = userPrompt.replace(/\{context_info\}\n*/g, '');
      }

      const effectiveStyle = {
        ...style,
        userPromptTemplate: userPrompt,
      };

      const response = await ProviderRegistry.getInstance().executeTranslation({
        sourceText: options.text,
        targetLang: config.targetLanguage,
        style: effectiveStyle,
      });

      // Save to storage
      if (!isExplain && (response.providerId === 'google' || style.id === 'literal-accurate')) {
        await storageMgr.saveStandardTranslation(
          options.text,
          config.targetLanguage,
          response.translatedText,
          response.providerId === 'google' ? 'google' : 'standard_ai'
        );
      } else {
        await storageMgr.saveCustomTranslation(
          options.text,
          config.targetLanguage,
          style.id,
          response.translatedText,
          response.model,
          response.providerId
        );
      }

      // 4. Live update the open peek drawer
      const resolvedDoc = PeekManager.formatDocument({
        title: actionTitle,
        content: response.translatedText,
        sourceText: options.text,
        signature: options.signature,
        model: response.model,
        latencyMs: response.latencyMs,
        isCached: false,
      });
      PeekManager.docProvider.setContent(virtualUri, resolvedDoc);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const errorDoc = `# ❌ AnyComment 处理失败\n\n**错误信息**: ${message}\n\n请检查网络或大模型配置。`;
      PeekManager.docProvider.setContent(virtualUri, errorDoc);
    }
  }

  private static formatLoadingDocument(data: {
    title: string;
    provider: string;
    sourceText: string;
    signature?: string;
  }): string {
    return [
      `# 💡 AnyComment ${data.title}`,
      '',
      `> ⏳ 正在调用 **[${data.provider}]** 分析代码上下文并生成大白话拆解，请稍候...`,
      '',
      data.signature ? `### 🔍 上下文签名定义\n\`\`\`\n${data.signature}\n\`\`\`\n` : '',
      '### 📄 原始代码注释',
      '```',
      data.sourceText,
      '```',
    ].filter(Boolean).join('\n');
  }

  private static formatDocument(data: {
    title: string;
    content: string;
    sourceText: string;
    signature?: string;
    model?: string;
    latencyMs?: number;
    isCached: boolean;
  }): string {
    const meta = [
      data.model ? `模型: \`${data.model}\`` : '',
      data.latencyMs ? `耗时: \`${data.latencyMs}ms\`` : '',
      data.isCached ? '状态: `本地分隔离缓存秒出`' : '状态: `AI 实时解析生成`',
    ].filter(Boolean).join(' · ');

    return [
      `# 💡 AnyComment ${data.title}`,
      meta ? `_${meta}_\n` : '',
      '---',
      '### 📌 核心解析与通俗说明',
      data.content,
      '',
      data.signature ? `### 🔍 关联代码签名\n\`\`\`\n${data.signature}\n\`\`\`\n` : '',
      '### 📄 原始内容对照',
      '```',
      data.sourceText,
      '```',
    ].filter(Boolean).join('\n');
  }
}
