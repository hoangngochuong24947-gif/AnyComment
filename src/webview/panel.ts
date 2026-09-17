import * as vscode from 'vscode';
import { ConfigManager } from '../config/index.js';
import { ProviderRegistry } from '../providers/registry.js';
import { StorageManager } from '../storage/storageManager.js';
import type { ProviderId, TranslationStyleId, ExplainStyleId } from '../config/types.js';

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
      const configMgr = ConfigManager.getInstance();

      switch (data.type) {
        case 'refreshState':
          await this.sendCurrentState();
          break;

        case 'saveProvider': {
          await configMgr.setActiveProvider(data.providerId as ProviderId);
          if (data.baseURL && data.model) {
            await configMgr.setOpenAIConfig(data.baseURL, data.model);
          }
          if (typeof data.apiKey === 'string' && data.apiKey.trim()) {
            await configMgr.setOpenAIApiKey(data.apiKey);
          }
          vscode.window.showInformationMessage('AnyComment: 服务配置已更新');
          await this.sendCurrentState();
          break;
        }

        case 'saveStyle': {
          await configMgr.setEnableExplainMode(!!data.enableExplainMode);
          if (data.activeStyle) {
            await configMgr.setActiveStyle(data.activeStyle as TranslationStyleId);
          }
          if (data.explainStyle) {
            await configMgr.setExplainStyle(data.explainStyle as ExplainStyleId);
          }
          if (data.customPrompt) {
            await configMgr.setCustomStylePrompt(data.customPrompt);
          }
          vscode.window.showInformationMessage('AnyComment: 模式与提示词风格已更新');
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
          vscode.window.showInformationMessage('AnyComment: 自定义风格与讲解缓存已清空');
          await this.sendCurrentState();
          break;
        }
      }
    });

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
    .checkbox-row {
      display: flex;
      align-items: center;
      margin-bottom: 10px;
      gap: 8px;
    }
    .checkbox-row input {
      width: auto;
      margin: 0;
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
      <option value="vscode-lm">VS Code LM (GitHub Copilot 官方免Key通道)</option>
      <option value="openai">OpenAI Compatible (DeepSeek / Ollama / Qwen)</option>
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
      <label>API Key (加密存储于 SecretStorage)：</label>
      <input type="password" id="openaiApiKey" placeholder="sk-..." />
    </div>
  </div>

  <div>
    <button id="saveProviderBtn">保存服务配置</button>
    <button id="testConnectionBtn" class="secondary">测试连接</button>
  </div>
  <div id="testStatus"></div>

  <h3>🎨 提示词风格与大白话讲解</h3>
  <div class="checkbox-row">
    <input type="checkbox" id="explainModeCheckbox" />
    <label for="explainModeCheckbox" style="margin:0; cursor:pointer;"><strong>开启【中文大白话讲解模式】(Cmd+Shift+E)</strong></label>
  </div>

  <div id="explainStyleGroup" class="field" style="display:none;">
    <label>大白话讲解风格：</label>
    <select id="explainStyleSelect">
      <option value="pragmatic">生产实战务实派 (核心功能 + 场景 + 避坑)</option>
      <option value="eli5">极简大白话 / 小白秒懂 (生动类比)</option>
      <option value="intent">架构意图与职责边界 (设计哲学剖析)</option>
    </select>
  </div>

  <div id="translateStyleGroup" class="field">
    <label>翻译提示词风格（沉浸式翻译成熟规范）：</label>
    <select id="translateStyleSelect">
      <option value="tech-native">科技专家·术语保留 (保留 Goroutine/Mutex 等原词)</option>
      <option value="github-dev">开源与 GitHub 风格 (地道开源语境)</option>
      <option value="literal-accurate">严格逐行对照直译 (结构对齐)</option>
      <option value="bilingual-mix">双语术语混合对照 (如：互斥锁 (Mutex))</option>
      <option value="custom">自定义提示词</option>
    </select>
  </div>

  <div class="field" id="customPromptGroup" style="display:none;">
    <label>自定义系统提示词 (System Prompt)：</label>
    <textarea id="customPromptInput" placeholder="输入你的自定义翻译规则..."></textarea>
  </div>

  <div>
    <button id="saveStyleBtn">应用风格设置</button>
  </div>

  <h3>💾 存储与本地缓存治理</h3>
  <div class="card">
    <div><strong>📦 分区 1 (标准库预置与基准)：</strong></div>
    <div id="stdStats">已加载标准库种子包与基线...</div>
  </div>
  <div class="card">
    <div><strong>🎨 分区 2 (自定义风格与讲解)：</strong></div>
    <div id="customStats">已缓存独立风格条目...</div>
  </div>
  <div>
    <button id="clearCustomBtn" class="secondary">清空自定义风格与讲解缓存</button>
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

    const explainModeCheckbox = document.getElementById('explainModeCheckbox');
    const explainStyleGroup = document.getElementById('explainStyleGroup');
    const explainStyleSelect = document.getElementById('explainStyleSelect');
    const translateStyleGroup = document.getElementById('translateStyleGroup');
    const translateStyleSelect = document.getElementById('translateStyleSelect');
    const customPromptGroup = document.getElementById('customPromptGroup');
    const customPromptInput = document.getElementById('customPromptInput');
    const saveStyleBtn = document.getElementById('saveStyleBtn');

    const stdStats = document.getElementById('stdStats');
    const customStats = document.getElementById('customStats');
    const clearCustomBtn = document.getElementById('clearCustomBtn');

    providerSelect.addEventListener('change', () => {
      openaiConfigGroup.style.display = providerSelect.value === 'openai' ? 'block' : 'none';
    });

    explainModeCheckbox.addEventListener('change', () => {
      const isExplain = explainModeCheckbox.checked;
      explainStyleGroup.style.display = isExplain ? 'block' : 'none';
      translateStyleGroup.style.display = isExplain ? 'none' : 'block';
    });

    translateStyleSelect.addEventListener('change', () => {
      customPromptGroup.style.display = translateStyleSelect.value === 'custom' ? 'block' : 'none';
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
        enableExplainMode: explainModeCheckbox.checked,
        activeStyle: translateStyleSelect.value,
        explainStyle: explainStyleSelect.value,
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

        explainModeCheckbox.checked = !!config.enableExplainMode;
        explainStyleGroup.style.display = config.enableExplainMode ? 'block' : 'none';
        translateStyleGroup.style.display = config.enableExplainMode ? 'none' : 'block';
        explainStyleSelect.value = config.explainStyle || 'pragmatic';

        translateStyleSelect.value = config.activeStyle || 'tech-native';
        customPromptGroup.style.display = config.activeStyle === 'custom' ? 'block' : 'none';
        customPromptInput.value = config.customStylePrompt || '';

        const stats = msg.storageStats;
        stdStats.innerText = '预置种子: ' + stats.standard.seedCount + ' 条 | 基准缓存: ' + stats.standard.cacheCount + ' 条';
        customStats.innerText = '独立风格与讲解条目: ' + stats.custom.totalCount + ' 条 (已与标准库物理隔离)';
      } else if (msg.type === 'testResult') {
        testStatus.innerText = (msg.success ? '✅ ' : '❌ ') + msg.message;
        testStatus.style.color = msg.success ? '#4ec9b0' : '#f48771';
      }
    });

    vscode.postMessage({ type: 'refreshState' });
  </script>
</body>
</html>`;
  }
}
