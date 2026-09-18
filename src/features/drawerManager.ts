import * as vscode from 'vscode';
import * as path from 'path';
import { StorageManager } from '../storage/storageManager.js';
import { ConfigManager } from '../config/index.js';
import { ProviderRegistry } from '../providers/registry.js';
import { StreamAnimator } from './streamAnimator.js';

export interface DrawerPayload {
  fileName: string;
  lineRange: string;
  sourceText: string;
  signature?: string;
  literal?: string;
  explanation?: string;
  statusText: string;
  isCached: boolean;
  isLoading: boolean;
  modelInfo?: string;
}

/**
 * Manages the slide-out bilingual drawer (侧边滑出式双语透视抽屉 - 方案 D).
 * Uses vscode.ViewColumn.Beside with preserveFocus to keep code editor in view.
 * Singleton pattern guarantees no tab clutter.
 */
export class DrawerManager {
  public static currentPanel: DrawerManager | undefined;
  private static extensionUri: vscode.Uri;
  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];
  private currentOptions?: {
    document: vscode.TextDocument;
    position: vscode.Position;
    text: string;
    signature?: string;
  };

  private constructor(panel: vscode.WebviewPanel) {
    this.panel = panel;

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.command) {
          case 'close':
            this.dispose();
            break;
          case 'copy':
            if (message.text) {
              await vscode.env.clipboard.writeText(message.text);
              vscode.window.setStatusBarMessage('AnyComment: 已复制到剪贴板', 2500);
            }
            break;
          case 'refresh':
            if (this.currentOptions) {
              await DrawerManager.openDrawer({
                ...this.currentOptions,
                forceRefresh: true,
              });
            }
            break;
        }
      },
      null,
      this.disposables
    );
  }

  public static initialize(context: vscode.ExtensionContext): void {
    DrawerManager.extensionUri = context.extensionUri;
  }

  public static async openDrawer(options: {
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
    const lineIndex = options.position.line + 1;
    const lineRange = `${fileName}:${lineIndex}`;

    // 1. Create or reveal existing beside panel
    if (DrawerManager.currentPanel) {
      DrawerManager.currentPanel.panel.reveal(vscode.ViewColumn.Beside, true);
    } else {
      const panel = vscode.window.createWebviewPanel(
        'anycomment.drawer',
        `双语透视: ${fileName}`,
        { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [DrawerManager.extensionUri],
        }
      );
      DrawerManager.currentPanel = new DrawerManager(panel);
    }

    DrawerManager.currentPanel.currentOptions = {
      document: options.document,
      position: options.position,
      text: options.text,
      signature: options.signature,
    };

    const cachedLiteral = options.forceRefresh
      ? null
      : storageMgr.get(options.text, config.targetLanguage, 'literal-accurate');
    const cachedExplain = options.forceRefresh
      ? null
      : storageMgr.get(options.text, config.targetLanguage, config.explainStyle);

    // 2. Immediate 0ms cache hit
    if (cachedLiteral && cachedExplain) {
      DrawerManager.currentPanel.updateWebview({
        fileName,
        lineRange,
        sourceText: options.text,
        signature: options.signature,
        literal: cachedLiteral.translation,
        explanation: cachedExplain.translation,
        statusText: '● 本地隔离缓存秒出',
        isCached: true,
        isLoading: false,
        modelInfo: cachedExplain.styleId || config.activeProvider,
      });
      return;
    }

    // 3. Progressive render: show skeleton and start restrained animation
    DrawerManager.currentPanel.updateWebview({
      fileName,
      lineRange,
      sourceText: options.text,
      signature: options.signature,
      literal: cachedLiteral?.translation,
      explanation: cachedExplain?.translation,
      statusText: '⏳ 正在实时解析代码注释与语义...',
      isCached: false,
      isLoading: true,
      modelInfo: config.activeProvider,
    });

    if (editor) {
      StreamAnimator.getInstance().start(editor, options.position.line, 'AnyComment: 双语透视抽屉生成中');
    }

    try {
      let literalText = cachedLiteral?.translation;
      let explainText = cachedExplain?.translation;

      // 3.1 Fetch fast translation first
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

          // Update webview progressively with literal translation
          DrawerManager.currentPanel.updateWebview({
            fileName,
            lineRange,
            sourceText: options.text,
            signature: options.signature,
            literal: literalText,
            explanation: undefined,
            statusText: '⏳ 中文直译已就绪，正在生成工程师通俗解读...',
            isCached: false,
            isLoading: true,
            modelInfo: 'Google 词典快道 + ' + config.activeProvider,
          });
        } catch {
          literalText = '(公共翻译通道暂未响应，等待大模型直译与解读)';
        }
      }

      // 3.2 Fetch deep plain-language explanation
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

      // 4. Finalized drawer view
      DrawerManager.currentPanel.updateWebview({
        fileName,
        lineRange,
        sourceText: options.text,
        signature: options.signature,
        literal: literalText || '(未获取到直译)',
        explanation: explainText || '(未获取到技术解读)',
        statusText: '● 已就绪并完成缓存',
        isCached: false,
        isLoading: false,
        modelInfo: config.activeProvider,
      });

      StreamAnimator.getInstance().stop('中文透视已就绪');
    } catch (err: unknown) {
      StreamAnimator.getInstance().stop();
      const message = err instanceof Error ? err.message : String(err);
      DrawerManager.currentPanel.updateWebview({
        fileName,
        lineRange,
        sourceText: options.text,
        signature: options.signature,
        statusText: `❌ 生成失败: ${message}`,
        isCached: false,
        isLoading: false,
      });
    }
  }

  private updateWebview(data: DrawerPayload): void {
    this.panel.title = `透视: ${data.fileName}`;
    this.panel.webview.html = this.renderHtml(data);
  }

  public dispose(): void {
    DrawerManager.currentPanel = undefined;
    this.panel.dispose();
    while (this.disposables.length) {
      const d = this.disposables.pop();
      if (d) d.dispose();
    }
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  private renderMarkdown(mdText?: string): string {
    if (!mdText) return '';
    let html = this.escapeHtml(mdText);

    // Bold **text**
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    // Code inline `code`
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    // Markdown bullet points
    html = html.replace(/^[\*\-]\s+(.*)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>)/s, '<ul style="margin-left: 20px; margin-top: 6px;">$1</ul>');
    // Line breaks
    html = html.replace(/\n\n+/g, '<br><br>').replace(/\n/g, '<br>');

    return html;
  }

  private renderHtml(data: DrawerPayload): string {
    const rawCommentEscaped = this.escapeHtml(data.sourceText);
    const signatureHtml = data.signature
      ? `<div class="meta-row">
           <span>关联目标: <code>${this.escapeHtml(data.signature)}</code></span>
         </div>`
      : '';

    const statusBadgeClass = data.statusText.includes('❌')
      ? 'badge-error'
      : data.isLoading
      ? 'badge-loading'
      : 'badge-success';

    const literalSection = data.literal
      ? `<div class="card-box">
          <div class="section-title trans">🌐 中文直译 (Literal Translation)</div>
          <div class="card-text">${this.renderMarkdown(data.literal)}</div>
          <div class="card-action-bar">
            <span class="meta-tip">${data.modelInfo ? this.escapeHtml(data.modelInfo) : '标准直译通道'}</span>
            <button class="pill-btn" onclick="copyText('literal')">📋 复制直译</button>
          </div>
        </div>`
      : `<div class="card-box skeleton-box">
          <div class="section-title trans">🌐 中文直译 (Literal Translation)</div>
          <div class="card-text skeleton-text">⏳ 正在联机解析语义，即将呈现精准中文直译...</div>
        </div>`;

    const explainSection = data.explanation
      ? `<div class="card-box">
          <div class="section-title explain">💡 工程师通俗解读 (Plain Technical Interpretation)</div>
          <div class="card-text explain-card">${this.renderMarkdown(data.explanation)}</div>
          <div class="card-action-bar">
            <span class="meta-tip">资深工程师大白话模型</span>
            <button class="pill-btn" onclick="copyText('explanation')">📋 复制解读</button>
          </div>
        </div>`
      : `<div class="card-box skeleton-box">
          <div class="section-title explain">💡 工程师通俗解读 (Plain Technical Interpretation)</div>
          <div class="card-text skeleton-text explain-card">⏳ 正在结合代码上下文推导底层技术原理与架构意图...</div>
        </div>`;

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AnyComment 抽屉</title>
  <style>
    :root {
      --bg: var(--vscode-editor-background, #161b22);
      --card-bg: var(--vscode-sideBar-background, #1c2128);
      --border: var(--vscode-panel-border, #30363d);
      --text: var(--vscode-editor-foreground, #e6edf3);
      --text-muted: var(--vscode-descriptionForeground, #8b949e);
      --accent: var(--vscode-button-background, #007acc);
      --trans-accent: #58a6ff;
      --explain-accent: #d2a8ff;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "JetBrains Mono", Consolas, monospace; }
    body {
      background: var(--bg);
      color: var(--text);
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
      font-size: 13px;
    }
    .drawer-header {
      padding: 12px 18px;
      background: var(--card-bg);
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-shrink: 0;
    }
    .drawer-tag {
      background: rgba(56, 139, 253, 0.15);
      color: var(--trans-accent);
      border: 1px solid rgba(56, 139, 253, 0.3);
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 600;
    }
    .close-btn {
      cursor: pointer;
      color: var(--text-muted);
      font-size: 16px;
      padding: 2px 6px;
      border-radius: 4px;
      transition: all 0.15s;
    }
    .close-btn:hover {
      color: #fff;
      background: rgba(255, 255, 255, 0.1);
    }
    .drawer-body {
      flex: 1;
      padding: 16px 20px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .meta-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 11.5px;
      color: var(--text-muted);
      background: var(--card-bg);
      padding: 8px 12px;
      border-radius: 6px;
      border: 1px solid var(--border);
    }
    .badge-success { color: #4ec9b0; font-weight: 600; }
    .badge-loading { color: #e3b341; font-weight: 600; }
    .badge-error { color: #f85149; font-weight: 600; }
    .card-box {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 12px 14px;
    }
    .section-title {
      font-size: 12px;
      font-weight: 700;
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 8px;
    }
    .section-title.trans { color: var(--trans-accent); }
    .section-title.explain { color: var(--explain-accent); }
    .card-text {
      font-size: 13px;
      line-height: 22px;
      color: var(--text);
    }
    .explain-card {
      border-left: 3px solid var(--explain-accent);
      padding-left: 10px;
    }
    .skeleton-text {
      color: var(--text-muted);
      font-style: italic;
    }
    .card-action-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 10px;
      padding-top: 6px;
      border-top: 1px solid rgba(255, 255, 255, 0.05);
    }
    .meta-tip {
      font-size: 11px;
      color: var(--text-muted);
    }
    .pill-btn {
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid var(--border);
      color: var(--text);
      padding: 4px 10px;
      border-radius: 4px;
      font-size: 11.5px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      transition: all 0.15s;
    }
    .pill-btn:hover {
      background: rgba(255, 255, 255, 0.15);
      color: #fff;
    }
    .source-box {
      background: #0d1117;
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 8px 10px;
      font-size: 11.5px;
      color: var(--text-muted);
      overflow-x: auto;
      white-space: pre-wrap;
      word-break: break-word;
      font-family: "JetBrains Mono", Consolas, monospace;
    }
    .bottom-bar {
      padding: 10px 18px;
      background: var(--card-bg);
      border-top: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-shrink: 0;
    }
    code {
      font-family: "JetBrains Mono", Consolas, monospace;
      font-size: 11.5px;
      background: rgba(255, 255, 255, 0.08);
      padding: 1px 5px;
      border-radius: 3px;
      color: #f0f6fc;
    }
  </style>
</head>
<body>
  <div class="drawer-header">
    <div style="display: flex; align-items: center; gap: 8px;">
      <span style="font-size: 15px;">📑</span>
      <span style="font-weight: 700; font-size: 13px;">AnyComment 双语透视抽屉</span>
      <span class="drawer-tag">${this.escapeHtml(data.lineRange)}</span>
    </div>
    <div class="close-btn" onclick="closeDrawer()" title="关闭 (Esc)">✕</div>
  </div>

  <div class="drawer-body">
    <div class="meta-bar">
      <div>${signatureHtml || `<span>文件: <code>${this.escapeHtml(data.fileName)}</code></span>`}</div>
      <div class="${statusBadgeClass}">${this.escapeHtml(data.statusText)}</div>
    </div>

    ${literalSection}
    ${explainSection}

    <div class="card-box">
      <div class="section-title" style="color: var(--text-muted);">📄 原始代码注释对照</div>
      <div class="source-box">${rawCommentEscaped}</div>
    </div>
  </div>

  <div class="bottom-bar">
    <span class="meta-tip">按 Esc 快捷收起 · 悬停其它代码可实时刷新</span>
    <button class="pill-btn" onclick="refreshDrawer()">🔄 重新生成</button>
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        vscode.postMessage({ command: 'close' });
      }
    });

    function closeDrawer() {
      vscode.postMessage({ command: 'close' });
    }

    function refreshDrawer() {
      vscode.postMessage({ command: 'refresh' });
    }

    function copyText(type) {
      let text = '';
      if (type === 'literal') {
        const el = document.querySelector('.card-text');
        if (el) text = el.innerText;
      } else if (type === 'explanation') {
        const el = document.querySelector('.explain-card');
        if (el) text = el.innerText;
      }
      if (text) {
        vscode.postMessage({ command: 'copy', text: text.trim() });
      }
    }
  </script>
</body>
</html>`;
  }
}
