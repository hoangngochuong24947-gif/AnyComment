import * as vscode from 'vscode';
import { AnyCommentConfig, ProviderId, StyleId, PromptStyle, PRESET_STYLES } from './types.js';

const SECRET_KEY_OPENAI = 'anycomment.secret.openai.apiKey';

export class ConfigManager {
  private static instance: ConfigManager;
  private secretStorage: vscode.SecretStorage;

  private constructor(context: vscode.ExtensionContext) {
    this.secretStorage = context.secrets;
  }

  public static initialize(context: vscode.ExtensionContext): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager(context);
    }
    return ConfigManager.instance;
  }

  public static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      throw new Error('ConfigManager not initialized yet');
    }
    return ConfigManager.instance;
  }

  public getConfig(): AnyCommentConfig {
    const config = vscode.workspace.getConfiguration('anycomment');
    return {
      activeProvider: config.get<ProviderId>('activeProvider', 'openai'),
      activeStyle: config.get<StyleId>('activeStyle', 'tech-plain'),
      targetLanguage: config.get<string>('targetLanguage', 'zh-CN'),
      openai: {
        baseURL: config.get<string>('openai.baseURL', 'https://api.deepseek.com'),
        model: config.get<string>('openai.model', 'deepseek-chat'),
      },
      customStylePrompt: config.get<string>(
        'customStylePrompt',
        '你是一位资深工程师。请将以下代码注释/文档翻译为中文，保持技术术语准确，语气通俗简练。'
      ),
      enableHoverAutoTranslate: config.get<boolean>('enableHoverAutoTranslate', false),
    };
  }

  public async setActiveProvider(providerId: ProviderId): Promise<void> {
    await vscode.workspace.getConfiguration('anycomment').update('activeProvider', providerId, vscode.ConfigurationTarget.Global);
  }

  public async setActiveStyle(styleId: StyleId): Promise<void> {
    await vscode.workspace.getConfiguration('anycomment').update('activeStyle', styleId, vscode.ConfigurationTarget.Global);
  }

  public async setCustomStylePrompt(prompt: string): Promise<void> {
    await vscode.workspace.getConfiguration('anycomment').update('customStylePrompt', prompt, vscode.ConfigurationTarget.Global);
  }

  public async setOpenAIConfig(baseURL: string, model: string): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('anycomment');
    await cfg.update('openai.baseURL', baseURL, vscode.ConfigurationTarget.Global);
    await cfg.update('openai.model', model, vscode.ConfigurationTarget.Global);
  }

  public async getOpenAIApiKey(): Promise<string | undefined> {
    return await this.secretStorage.get(SECRET_KEY_OPENAI);
  }

  public async setOpenAIApiKey(apiKey: string): Promise<void> {
    await this.secretStorage.store(SECRET_KEY_OPENAI, apiKey.trim());
  }

  public async deleteOpenAIApiKey(): Promise<void> {
    await this.secretStorage.delete(SECRET_KEY_OPENAI);
  }

  public getPromptStyle(styleId: StyleId): PromptStyle {
    if (styleId === 'custom') {
      const customPrompt = this.getConfig().customStylePrompt;
      return {
        id: 'custom',
        name: '自定义提示词',
        description: '由用户在控制中心自行编写的提示词规则',
        systemPrompt: customPrompt,
        userPromptTemplate: '{text}',
      };
    }
    return PRESET_STYLES[styleId];
  }
}
