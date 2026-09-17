import * as vscode from 'vscode';
import {
  AnyCommentConfig,
  ProviderId,
  TranslationStyleId,
  ExplainStyleId,
  PromptStyle,
  TRANSLATION_PRESETS,
  EXPLAIN_PRESETS,
} from './types.js';

const SECRET_KEY_OPENAI = 'anycomment.secret.openai.apiKey';

export class ConfigManager {
  private static instance: ConfigManager;
  private secretStorage: vscode.SecretStorage;
  private globalState: vscode.Memento;

  private constructor(context: vscode.ExtensionContext) {
    this.secretStorage = context.secrets;
    this.globalState = context.globalState;
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
      activeProvider: config.get<ProviderId>('activeProvider', 'vscode-lm'),
      activeStyle: config.get<TranslationStyleId>('activeStyle', 'tech-native'),
      enableExplainMode: config.get<boolean>('enableExplainMode', false),
      explainStyle: config.get<ExplainStyleId>('explainStyle', 'pragmatic'),
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
      hasCompletedOnboarding: this.globalState.get<boolean>('anycomment.hasCompletedOnboarding', false),
    };
  }

  public async setHasCompletedOnboarding(completed: boolean): Promise<void> {
    await this.globalState.update('anycomment.hasCompletedOnboarding', completed);
  }

  public async setEnableExplainMode(enabled: boolean): Promise<void> {
    await vscode.workspace.getConfiguration('anycomment').update('enableExplainMode', enabled, vscode.ConfigurationTarget.Global);
  }

  public async setExplainStyle(styleId: ExplainStyleId): Promise<void> {
    await vscode.workspace.getConfiguration('anycomment').update('explainStyle', styleId, vscode.ConfigurationTarget.Global);
  }

  public async setActiveProvider(providerId: ProviderId): Promise<void> {
    await vscode.workspace.getConfiguration('anycomment').update('activeProvider', providerId, vscode.ConfigurationTarget.Global);
  }

  public async setActiveStyle(styleId: TranslationStyleId): Promise<void> {
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

  /**
   * Returns current active prompt style based on translation or explain mode
   */
  public getEffectiveStyle(): PromptStyle {
    const cfg = this.getConfig();
    if (cfg.enableExplainMode) {
      return this.getExplainStyle(cfg.explainStyle);
    }
    return this.getTranslationStyle(cfg.activeStyle);
  }

  public getTranslationStyle(styleId: TranslationStyleId): PromptStyle {
    if (styleId === 'custom') {
      const customPrompt = this.getConfig().customStylePrompt;
      return {
        id: 'custom',
        name: '自定义提示词',
        description: '由用户自行编写的提示词规则',
        systemPrompt: customPrompt,
        userPromptTemplate: '{text}',
      };
    }
    const preset = TRANSLATION_PRESETS[styleId];
    return preset ?? TRANSLATION_PRESETS['tech-native'];
  }

  public getExplainStyle(styleId: ExplainStyleId): PromptStyle {
    const preset = EXPLAIN_PRESETS[styleId];
    return preset ?? EXPLAIN_PRESETS.pragmatic;
  }
}
