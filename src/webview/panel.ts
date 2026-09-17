import * as vscode from 'vscode';
import { ConfigManager } from '../config/index.js';
import { ProviderRegistry } from '../providers/registry.js';
import { StorageManager } from '../storage/storageManager.js';
import type { ProviderId, StyleId } from '../config/types.js';

/**
 * AnyComment Sidebar Webview View Provider
 * Official Reference: https://code.visualstudio.com/api/references/vscode-api#WebviewViewProvider
 */
export class AnyCommentViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'anycomment.managerView';
  private _view?: vscode.WebviewView;

  constructor(private readonly extensionUri: vscode.Uri) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    webviewView.webview.html = this.getHtmlContent();

    webviewView.webview.onDidReceiveMessage(async (data) => {
      switch (data.type) {
        case 'refreshState':
          await this.sendCurrentState();
          break;

        case 'saveProvider': {
          const configMgr = ConfigManager.getInstance();
          await configMgr.setActiveProvider(data.providerId as ProviderId);
          if (data.baseURL && data.model) {
            await configMgr.setOpenAIConfig(data.baseURL, data.model);
          }
          if (typeof data.apiKey === 'string') {
            if (data.apiKey.trim()) {
              await configMgr.setOpenAIApiKey(data.apiKey);
            }
          }
          vscode.window.showInformationMessage('AnyComment: 服务配置已更新');
          await this.sendCurrentState();
          break;
        }

        case 'saveStyle': {
          const configMgr = ConfigManager.getInstance();
          await configMgr.setActiveStyle(data.styleId as StyleId);
          if (data.customPrompt) {
            await configMgr.setCustomStylePrompt(data.customPrompt);
          }
          vscode.window.showInformationMessage('AnyComment: 提示词风格已更新');
          await this.sendCurrentState();
          break;
        }

        case 'testConnection': {
          const provider = ProviderRegistry.getInstance().getProvider(data.providerId as ProviderId);
          try {
            const result = await provider.testConnection();
            this._view?.webview.postMessage({
              type: 'testResult',
              success: result.success,
              message: result.message,
            });
          } catch (err: unknown) {
            this._view?.webview.postMessage({
              type: 'testResult',
              success: false,
              message: err instanceof Error ? err.message : String(err),
            });
          }
          break;
        }

        case 'clearCustomCache': {
          await StorageManager.getInstance().clearCustomCache(data.styleId);
          vscode.window.showInformationMessage('AnyComment: 自定义风格缓存已清空');
          await this.sendCurrentState();
          break;
        }
      }
    });

    // Send initial state on load
    this.sendCurrentState();
  }

  public async sendCurrentState(): Promise<void> {
    if (!this._view) return;

    const config = ConfigManager.getInstance().getConfig();
    const storageStats = StorageManager.getInstance().getStats();
    const hasKey = !!(await ConfigManager.getInstance().getOpenAIApiKey());

    this._view.webview.postMessage({
      type: 'state',
      config,
      storageStats,
      hasKey,
    });
  }

  private getHtmlContent(): string {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AnyComment</title>
  <style>
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background-color: var(--vscode-editor-background);
      padding: 12px;
      margin: 0;
      line-height: 1.5;
    }
    h3 {
      font-size: 13px;
      text-transform: uppercase;
      margin-top: 16px;
      margin-bottom: 8px;
      color: var(--vscode-sideBarTitle-foreground, #bbbbbb);
      border-bottom: 1px solid var(--vscode-panel-border, #333333);
      padding-bottom: 4px;
    }
    .field {
      margin-bottom: 12px;
    }
    label {
      display: block;
      font-size: 12px;
      margin-bottom: 4px;
      color: var(--vscode-descriptionForeground);
    }
    select, input, textarea {
      width: 100%;
      box-sizing: border-box;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, #444);
      padding: 6px 8px;
      border-radius: 3px;
      font-size: 12px;
    }
    textarea {
      resize: vertical;
      min-height: 70px;
    }
    button {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      padding: 6px 12px;
      border-radius: 3px;
      cursor: pointer;
      font-size: 12px;
      margin-top: 4px;
      margin-right: 6px;
    }
    button:hover {
      background: var(--vscode-button-hoverBackground);
    }
    button.secondary {
      background: var(--vscode-button-secondaryBackground, #444);
      color: var(--vscode-button-secondaryForeground, #fff);
    }
    .card {
      background: var(--vscode-badge-background, rgba(255,255,255,0.05));
      border: 1px solid var(--vscode-panel-border, #333);
      padding: 8px 10px;
      border-radius: 4px;
      margin-bottom: 8px;
      font-size: 12px;
    }
    .badge {
      display: inline-block;
      padding: 2px 6px;
      border-radius: 3px;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      font-size: 11px;
    }
    #testStatus {
      margin-top: 6px;
      font-size: 12px;
    }
  </style>
</head>
<body>
  <h3>🚀 翻译服务 (Provider)</h3>
  <div class="field">
    <label>当前生效通道：</label>
    <select id="providerSelect">
      <option value="openai">OpenAI Compatible (DeepSeek / Ollama)</option>
      <option value="vscode-lm">VS Code LM (GitHub Copilot 免Key)</option>
      <option value="google">Google Translate (免费公共机翻)</option>
    </select>
  </div>

  <div id="openaiConfigGroup">
    <div class="field">
      <label>Base URL：</label>
      <input type="text" id="openaiBaseURL" placeholder="https://api.deepseek.com" />
    </div>
    <div class="field">
      <label>模型名称 (Model)：</label>
      <input type="text" id="openaiModel" placeholder="deepseek-chat" />
    </div>
    <div class="field">
      <label>API Key (加密保存在 SecretStorage)：</label>
      <input type="password" id="openaiApiKey" placeholder="sk-..." />
    </div>
  </div>

  <div>
    <button id="saveProviderBtn">保存服务配置</button>
    <button id="testConnectionBtn" class="secondary">测试连接</button>
  </div>
  <div id="testStatus"></div>

  <h3>🎨 提示词风格 (Prompt Style)</h3>
  <div class="field">
    <label>选择当前风格：</label>
    <select id="styleSelect">
      <option value="tech-plain">通俗技术化 (保留关键英文术语)</option>
      <option value="literal">精确直译 (严格排版对照)</option>
      <option value="deep-dive">API 深度解析 (含避坑指南)</option>
      <option value="custom">自定义提示词</option>
    </select>
  </div>

  <div class="field" id="customPromptGroup">
    <label>自定义系统提示词 (System Prompt)：</label>
    <textarea id="customPromptInput" placeholder="输入你的自定义规则..."></textarea>
  </div>

  <div>
    <button id="saveStyleBtn">应用风格</button>
  </div>

  <h3>💾 存储与本地缓存治理</h3>
  <div class="card">
    <div><strong>📦 分区 1 (标准库与基线)：</strong></div>
    <div id="stdStats">已加载官方预置文档与基线...</div>
  </div>
  <div class="card">
    <div><strong>🎨 分区 2 (自定义 AI 风格)：</strong></div>
    <div id="customStats">已缓存自定义解析...</div>
  </div>
  <div>
    <button id="clearCustomBtn" class="secondary">清空自定义风格缓存</button>
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    const providerSelect = document.getElementById('providerSelect');
    const openaiConfigGroup = document.getElementById('openaiConfigGroup');
    const openaiBaseURL = document.getElementById('openaiBaseURL');
    const openaiModel = document.getElementById('openaiModel');
    const openaiApiKey = document.getElementById('openaiApiKey');
    const saveProviderBtn = document.getElementById('saveProviderBtn');
    const testConnectionBtn = document.getElementById('testConnectionBtn');
    const testStatus = document.getElementById('testStatus');

    const styleSelect = document.getElementById('styleSelect');
    const customPromptGroup = document.getElementById('customPromptGroup');
    const customPromptInput = document.getElementById('customPromptInput');
    const saveStyleBtn = document.getElementById('saveStyleBtn');

    const stdStats = document.getElementById('stdStats');
    const customStats = document.getElementById('customStats');
    const clearCustomBtn = document.getElementById('clearCustomBtn');

    providerSelect.addEventListener('change', () => {
      openaiConfigGroup.style.display = providerSelect.value === 'openai' ? 'block' : 'none';
    });

    styleSelect.addEventListener('change', () => {
      customPromptGroup.style.display = styleSelect.value === 'custom' ? 'block' : 'none';
    });

    saveProviderBtn.addEventListener('click', () => {
      vscode.postMessage({
        type: 'saveProvider',
        providerId: providerSelect.value,
        baseURL: openaiBaseURL.value,
        model: openaiModel.value,
        apiKey: openaiApiKey.value
      });
    });

    testConnectionBtn.addEventListener('click', () => {
      testStatus.innerText = '正在测试连接...';
      vscode.postMessage({
        type: 'testConnection',
        providerId: providerSelect.value
      });
    });

    saveStyleBtn.addEventListener('click', () => {
      vscode.postMessage({
        type: 'saveStyle',
        styleId: styleSelect.value,
        customPrompt: customPromptInput.value
      });
    });

    clearCustomBtn.addEventListener('click', () => {
      vscode.postMessage({
        type: 'clearCustomCache'
      });
    });

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'state') {
        const config = msg.config;
        providerSelect.value = config.activeProvider;
        openaiConfigGroup.style.display = config.activeProvider === 'openai' ? 'block' : 'none';
        openaiBaseURL.value = config.openai.baseURL || '';
        openaiModel.value = config.openai.model || '';
        if (msg.hasKey) {
          openaiApiKey.placeholder = '已配置 (输入新 Key 覆写)';
        }

        styleSelect.value = config.activeStyle;
        customPromptGroup.style.display = config.activeStyle === 'custom' ? 'block' : 'none';
        customPromptInput.value = config.customStylePrompt || '';

        const stats = msg.storageStats;
        stdStats.innerText = '预置种子: ' + stats.standard.seedCount + ' 条 | 基准缓存: ' + stats.standard.cacheCount + ' 条';
        customStats.innerText = '独立风格条目: ' + stats.custom.totalCount + ' 条 (已与标准库物理隔离)';
      } else if (msg.type === 'testResult') {
        testStatus.innerText = (msg.success ? '✅ ' : '❌ ') + msg.message;
        testStatus.style.color = msg.success ? '#4ec9b0' : '#f48771';
      }
    });

    // Request initial state
    vscode.postMessage({ type: 'refreshState' });
  </script>
</body>
</html>`;
  }
}
