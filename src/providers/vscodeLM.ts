import * as vscode from 'vscode';
import type { ITranslationProvider, TranslationRequest, TranslationResponse } from './types.js';

/**
 * VS Code Native Language Model API Translation Provider (Copilot)
 * Official Reference: https://code.visualstudio.com/api/references/vscode-api#lm
 * LanguageModelChatSelector: https://code.visualstudio.com/api/references/vscode-api#LanguageModelChatSelector
 */
export class VSCodeLMProvider implements ITranslationProvider {
  public readonly id = 'vscode-lm' as const;
  public readonly name = 'VS Code Language Model (GitHub Copilot)';
  public readonly description = '直接复用宿主环境已配置的 GitHub Copilot，无需个人 API Key，零 Token 计费';
  public readonly supportsCustomPrompt = true;

  public async translate(request: TranslationRequest): Promise<TranslationResponse> {
    const startTime = Date.now();

    // Verification of vscode.lm availability in current runtime
    if (!('lm' in vscode) || typeof vscode.lm.selectChatModels !== 'function') {
      throw new Error('当前 VS Code 版本或环境不支持 vscode.lm API，请更新 VS Code 或改用 OpenAI 兼容接口');
    }

    // Select Copilot model or first available chat model
    const copilotModels = await vscode.lm.selectChatModels({ vendor: 'copilot' });
    const model = copilotModels[0] ?? (await vscode.lm.selectChatModels())[0];

    if (!model) {
      throw new Error('未检测到可用的 VS Code 语言模型，请确保已安装并登录 GitHub Copilot 插件');
    }

    const systemPrompt = request.style.systemPrompt.replace(/\{target_lang\}/g, request.targetLang);
    const userPrompt = request.style.userPromptTemplate
      .replace(/\{text\}/g, request.sourceText)
      .replace(/\{target_lang\}/g, request.targetLang);

    const messages = [
      vscode.LanguageModelChatMessage.User(`[系统指令/System Rule]\n${systemPrompt}`),
      vscode.LanguageModelChatMessage.User(`[请翻译以下代码内容]\n${userPrompt}`),
    ];

    const chatResponse = await model.sendRequest(messages, {}, new vscode.CancellationTokenSource().token);
    const fragments: string[] = [];

    for await (const chunk of chatResponse.text) {
      fragments.push(chunk);
    }

    const translatedText = fragments.join('').trim();

    return {
      translatedText,
      providerId: this.id,
      model: `${model.vendor}/${model.family || model.name}`,
      latencyMs: Date.now() - startTime,
    };
  }

  public async testConnection(): Promise<{ success: boolean; message?: string }> {
    try {
      if (!('lm' in vscode) || typeof vscode.lm.selectChatModels !== 'function') {
        return { success: false, message: '当前环境不支持 vscode.lm' };
      }
      const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
      const activeModel = models[0];
      if (!activeModel) {
        return { success: false, message: '未找到已登录的 Copilot 语言模型' };
      }
      return { success: true, message: `已连接 Copilot 模型: ${activeModel.name || activeModel.family}` };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, message };
    }
  }
}
