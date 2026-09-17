import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ConfigManager } from '../config/index.js';
import type { ProviderId, TranslationStyleId, ExplainStyleId } from '../config/types.js';

export class OnboardingWizard {
  /**
   * Checks if an LLM Wiki exists in the current workspace or home directory
   */
  public static detectLLMWiki(): boolean {
    // 1. Check workspace folders
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders) {
      for (const folder of workspaceFolders) {
        const p1 = path.join(folder.uri.fsPath, 'wiki');
        const p2 = path.join(folder.uri.fsPath, 'docs', 'wiki');
        if (fs.existsSync(p1) || fs.existsSync(p2)) {
          return true;
        }
      }
    }

    // 2. Check standard Lewis agent output directory
    const lewisPath = path.join(os.homedir(), 'Desktop', 'Lewis', 'Agent-Output');
    if (fs.existsSync(lewisPath)) {
      return true;
    }

    return false;
  }

  /**
   * Runs the lightweight 3-step QuickPick onboarding wizard
   */
  public static async run(): Promise<void> {
    const configMgr = ConfigManager.getInstance();
    const wikiDetected = OnboardingWizard.detectLLMWiki();

    const notifyMsg = wikiDetected
      ? '🎉 欢迎使用 AnyComment！已检测到关联的本地 LLM 知识库，建议快速配置翻译与讲解偏好。'
      : '🎉 欢迎使用 AnyComment！未检测到额外 LLM Wiki 配置，默认将通过本地调用 VS Code 官方 Copilot 模型通道。';

    const action = await vscode.window.showInformationMessage(
      notifyMsg,
      '⚡ 30秒极速配置',
      '直接使用默认 Copilot'
    );

    if (action === '直接使用默认 Copilot') {
      await configMgr.setActiveProvider('vscode-lm');
      await configMgr.setHasCompletedOnboarding(true);
      vscode.window.showInformationMessage('✅ AnyComment 已就绪！默认使用 VS Code 官方 Copilot 通道，悬停代码即可体验。');
      return;
    }

    if (action !== '⚡ 30秒极速配置') {
      // User dismissed or closed; mark completed so we don't nag repeatedly
      await configMgr.setHasCompletedOnboarding(true);
      return;
    }

    // Step 1: Select Provider
    const providerPicks = [
      {
        label: '$(sparkle) VS Code 官方通道 (Copilot)',
        description: '推荐！免个人 API Key，零 Token 计费，直接复用已登录的 Copilot',
        providerId: 'vscode-lm' as ProviderId,
      },
      {
        label: '$(key) 自定义大模型 (DeepSeek / 通义千问 / Ollama)',
        description: '配置自己的 BaseURL 与 API Key，支持全平台大模型',
        providerId: 'openai' as ProviderId,
      },
      {
        label: '$(globe) Google Translate (免费公共机翻)',
        description: '传统机器翻译，零门槛秒开',
        providerId: 'google' as ProviderId,
      },
    ];

    const selectedProvider = await vscode.window.showQuickPick(providerPicks, {
      placeHolder: '【第 1 步】请选择默认翻译服务通道',
    });

    if (!selectedProvider) {
      await configMgr.setHasCompletedOnboarding(true);
      return;
    }

    await configMgr.setActiveProvider(selectedProvider.providerId);

    // If Custom OpenAI / DeepSeek selected, configure credentials
    if (selectedProvider.providerId === 'openai') {
      const baseURL = await vscode.window.showInputBox({
        prompt: '请输入 OpenAI 兼容接口 Base URL：',
        value: 'https://api.deepseek.com',
        ignoreFocusOut: true,
      });

      const model = await vscode.window.showInputBox({
        prompt: '请输入模型名称 (Model Name)：',
        value: 'deepseek-chat',
        ignoreFocusOut: true,
      });

      const apiKey = await vscode.window.showInputBox({
        prompt: '请输入 API Key (将加密存储在 VS Code SecretStorage 中)：',
        password: true,
        ignoreFocusOut: true,
      });

      if (baseURL && model) {
        await configMgr.setOpenAIConfig(baseURL, model);
      }
      if (apiKey) {
        await configMgr.setOpenAIApiKey(apiKey);
      }
    }

    // Step 2: Select Preferred Prompt Style
    const stylePicks = [
      {
        label: '$(symbol-keyword) 科技专家·术语保留 (沉浸式翻译规范)',
        description: '严谨直译，保留 Goroutine, Mutex, Promise 等专业英文原词',
        styleId: 'tech-native' as TranslationStyleId,
      },
      {
        label: '$(github) 开源与 GitHub 风格',
        description: '针对开源社区 PR、Issue 与库文档润色，语言地道',
        styleId: 'github-dev' as TranslationStyleId,
      },
      {
        label: '$(book) 双语术语混合对照',
        description: '格式为：互斥锁 (Mutex)、协程 (Goroutine)',
        styleId: 'bilingual-mix' as TranslationStyleId,
      },
      {
        label: '$(lightbulb) 开启默认【大白话讲解模式】',
        description: '不仅翻译，更用通俗大白话讲清楚代码/结构体到底在干嘛',
        styleId: 'explain',
      },
    ];

    const selectedStyle = await vscode.window.showQuickPick(stylePicks, {
      placeHolder: '【第 2 步】选择你最喜欢的默认呈现风格',
    });

    if (selectedStyle) {
      if (selectedStyle.styleId === 'explain') {
        await configMgr.setEnableExplainMode(true);
        await configMgr.setExplainStyle('pragmatic');
      } else {
        await configMgr.setEnableExplainMode(false);
        await configMgr.setActiveStyle(selectedStyle.styleId as TranslationStyleId);
      }
    }

    await configMgr.setHasCompletedOnboarding(true);
    vscode.window.showInformationMessage('🎉 AnyComment 配置完成！随时按 Cmd+Shift+B 开启沉浸阅读，Cmd+Shift+E 切换大白话讲解。');
  }
}
