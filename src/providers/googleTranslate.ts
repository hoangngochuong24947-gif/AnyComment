import type { ITranslationProvider, TranslationRequest, TranslationResponse } from './types.js';

/**
 * Shape of Google Translate raw array response:
 * [ [ [ "translated text", "source text", ... ], ... ], ... ]
 */
type GoogleTranslateSegment = [string, string, ...unknown[]];
type GoogleTranslateRawResponse = [GoogleTranslateSegment[], ...unknown[]];

function isGoogleTranslateResponse(data: unknown): data is GoogleTranslateRawResponse {
  return (
    Array.isArray(data) &&
    data.length > 0 &&
    Array.isArray(data[0]) &&
    data[0].length > 0 &&
    Array.isArray(data[0][0]) &&
    typeof data[0][0][0] === 'string'
  );
}

/**
 * Google Translate Public Machine Translation Provider
 * Used as standard objective baseline translation.
 */
export class GoogleTranslateProvider implements ITranslationProvider {
  public readonly id = 'google' as const;
  public readonly name = 'Google Translate (免费公共通道)';
  public readonly description = '传统机器翻译，极速、无需任何 API Key，作为客观基线翻译';
  public readonly supportsCustomPrompt = false;

  public async translate(request: TranslationRequest): Promise<TranslationResponse> {
    const startTime = Date.now();
    const sourceText = request.sourceText;
    const targetLang = request.targetLang === 'zh-CN' ? 'zh-CN' : request.targetLang;

    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(
      targetLang
    )}&dt=t&q=${encodeURIComponent(sourceText)}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AnyComment/0.1.0',
      },
    });

    if (!response.ok) {
      throw new Error(`Google Translate 请求失败: HTTP ${response.status}`);
    }

    const data: unknown = await response.json();

    if (!isGoogleTranslateResponse(data)) {
      throw new Error('Google Translate 返回数据结构异常');
    }

    const segments = data[0];
    const translatedText = segments.map((item) => item[0] ?? '').join('').trim();

    return {
      translatedText,
      providerId: this.id,
      model: 'google-gtx-mt',
      latencyMs: Date.now() - startTime,
    };
  }

  public async testConnection(): Promise<{ success: boolean; message?: string }> {
    try {
      const res = await this.translate({
        sourceText: 'Hello world',
        targetLang: 'zh-CN',
        style: {
          id: 'literal',
          name: '直译',
          description: '',
          systemPrompt: '',
          userPromptTemplate: '',
        },
      });
      return { success: true, message: `连接成功 (结果: "${res.translatedText}", 延迟: ${res.latencyMs}ms)` };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, message };
    }
  }
}
