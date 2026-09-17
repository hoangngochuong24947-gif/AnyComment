import type { ITranslationProvider, TranslationRequest, TranslationResponse } from './types.js';
import { ConfigManager } from '../config/index.js';

/**
 * OpenAI Chat Completion API Response shape
 * Official Reference: https://platform.openai.com/docs/api-reference/chat/create
 */
type OpenAIChatCompletionResponse = {
  id?: string;
  choices?: Array<{
    index?: number;
    message?: {
      role?: string;
      content?: string;
    };
    finish_reason?: string;
  }>;
};

/**
 * OpenAI-Compatible Translation Provider
 * Supports DeepSeek, Ollama, Qwen, Kimi, OpenAI, etc.
 * Official Reference: https://platform.openai.com/docs/guides/text-generation
 */
export class OpenAICompatibleProvider implements ITranslationProvider {
  public readonly id = 'openai' as const;
  public readonly name = 'OpenAI Compatible (DeepSeek / Ollama / Qwen)';
  public readonly description = '通用大模型接口，支持 DeepSeek、通义千问、Ollama 本地大模型等';
  public readonly supportsCustomPrompt = true;

  public async translate(request: TranslationRequest): Promise<TranslationResponse> {
    const startTime = Date.now();
    const config = ConfigManager.getInstance().getConfig();
    const apiKey = await ConfigManager.getInstance().getOpenAIApiKey();

    let baseURL = config.openai.baseURL.trim().replace(/\/+$/, '');
    if (!baseURL.endsWith('/v1') && !baseURL.includes('/v1/')) {
      baseURL = `${baseURL}/v1`;
    }

    const systemPrompt = request.style.systemPrompt.replace(/\{target_lang\}/g, request.targetLang);
    const userPrompt = request.style.userPromptTemplate
      .replace(/\{text\}/g, request.sourceText)
      .replace(/\{target_lang\}/g, request.targetLang);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const payload = {
      model: config.openai.model || 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: request.temperature ?? 0.3,
    };

    const response = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`[OpenAI API Error ${response.status}]: ${errBody}`);
    }

    const data = (await response.json()) as OpenAIChatCompletionResponse;
    const translatedText = data.choices?.[0]?.message?.content?.trim() ?? '';

    return {
      translatedText,
      providerId: this.id,
      model: config.openai.model,
      latencyMs: Date.now() - startTime,
    };
  }

  public async testConnection(): Promise<{ success: boolean; message?: string }> {
    try {
      const res = await this.translate({
        sourceText: 'Hello world',
        targetLang: 'zh-CN',
        style: ConfigManager.getInstance().getPromptStyle('literal'),
      });
      return { success: true, message: `连接成功 (模型: ${res.model}, 延迟: ${res.latencyMs}ms)` };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, message };
    }
  }
}
