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

    // 1. Primary fast channel: Google Translate via official Chrome Dictionary client
    try {
      const url = `https://translate.googleapis.com/translate_a/single?client=dict-chrome-ex&sl=auto&tl=${encodeURIComponent(
        targetLang
      )}&dt=t&q=${encodeURIComponent(sourceText)}`;

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AnyComment/0.2.0',
        },
        signal: AbortSignal.timeout(3000),
      });

      if (response.ok) {
        const data: unknown = await response.json();
        if (isGoogleTranslateResponse(data)) {
          const segments = data[0];
          const translatedText = segments.map((item) => item[0] ?? '').join('').trim();
          if (translatedText) {
            return {
              translatedText,
              providerId: this.id,
              model: 'google-dict-chrome-ex',
              latencyMs: Date.now() - startTime,
            };
          }
        }
      }
    } catch (err: unknown) {
      console.warn('[AnyComment] Google dict-chrome-ex channel failed, attempting fallback...', err);
    }

    // 2. Secondary fallback channel: MyMemory public translation API
    try {
      const myMemoryUrl = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(
        sourceText
      )}&langpair=auto|${encodeURIComponent(targetLang)}`;

      const mmResponse = await fetch(myMemoryUrl, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AnyComment/0.2.0',
        },
        signal: AbortSignal.timeout(3000),
      });

      if (mmResponse.ok) {
        const mmData = (await mmResponse.json()) as { responseData?: { translatedText?: string } };
        const translatedText = mmData.responseData?.translatedText?.trim();
        if (translatedText) {
          return {
            translatedText,
            providerId: this.id,
            model: 'mymemory-mt',
            latencyMs: Date.now() - startTime,
          };
        }
      }
    } catch (err: unknown) {
      console.warn('[AnyComment] MyMemory fallback channel failed:', err);
    }

    // 3. Final baseline channel: Google Translate gtx
    const gtxUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(
      targetLang
    )}&dt=t&q=${encodeURIComponent(sourceText)}`;

    const gtxResponse = await fetch(gtxUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AnyComment/0.2.0',
      },
      signal: AbortSignal.timeout(3000),
    });

    if (!gtxResponse.ok) {
      throw new Error(`公共翻译通道暂时不可用 (HTTP ${gtxResponse.status})`);
    }

    const gtxData: unknown = await gtxResponse.json();
    if (!isGoogleTranslateResponse(gtxData)) {
      throw new Error('公共翻译返回数据结构异常');
    }

    const segments = gtxData[0];
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
