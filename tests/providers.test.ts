import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProviderRegistry } from '../src/providers/registry.js';
import type { ITranslationProvider, TranslationRequest, TranslationResponse } from '../src/providers/types.js';

describe('Provider Registry & Fallback Tests', () => {
  let registry: ProviderRegistry;

  beforeEach(() => {
    registry = ProviderRegistry.getInstance();
  });

  it('should have built-in providers registered', () => {
    const providers = registry.getAllProviders();
    expect(providers.length).toBeGreaterThanOrEqual(3);
    const ids = providers.map((p) => p.id);
    expect(ids).toContain('openai');
    expect(ids).toContain('vscode-lm');
    expect(ids).toContain('google');
  });

  it('should allow registering custom providers', () => {
    const mockProvider: ITranslationProvider = {
      id: 'openai',
      name: 'Mock Provider',
      description: 'Mock for testing',
      supportsCustomPrompt: true,
      async translate(req: TranslationRequest): Promise<TranslationResponse> {
        return {
          translatedText: `Mocked: ${req.sourceText}`,
          providerId: 'openai',
          model: 'mock-model',
          latencyMs: 10,
        };
      },
      async testConnection() {
        return { success: true };
      },
    };

    registry.register(mockProvider);
    const retrieved = registry.getProvider('openai');
    expect(retrieved.name).toBe('Mock Provider');
  });

  it('should test GoogleTranslateProvider with fast channel fallback', async () => {
    const google = registry.getProvider('google');
    expect(google.id).toBe('google');
    expect(google.supportsCustomPrompt).toBe(false);

    // Mock global fetch to simulate dict-chrome-ex response
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => [[['你好世界', 'Hello world']]],
    } as unknown as Response);

    try {
      const res = await google.translate({
        sourceText: 'Hello world',
        targetLang: 'zh-CN',
        style: {
          id: 'literal-accurate',
          name: '直译',
          description: '',
          systemPrompt: '',
          userPromptTemplate: '',
        },
      });
      expect(res.translatedText).toBe('你好世界');
      expect(res.providerId).toBe('google');
      expect(res.model).toBe('google-dict-chrome-ex');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('should fast-fail OpenAI provider when API key is missing on remote host', async () => {
    const { ConfigManager } = await import('../src/config/index.js');
    const { OpenAICompatibleProvider } = await import('../src/providers/openaiCompatible.js');

    vi.spyOn(ConfigManager, 'getInstance').mockReturnValue({
      getConfig: () => ({
        openai: {
          baseURL: 'https://api.deepseek.com',
          model: 'deepseek-chat',
        },
      }),
      getOpenAIApiKey: async () => undefined,
    } as any);

    const provider = new OpenAICompatibleProvider();

    await expect(
      provider.translate({
        sourceText: 'Test text',
        targetLang: 'zh-CN',
        style: {
          id: 'literal-accurate',
          name: '直译',
          description: '',
          systemPrompt: '',
          userPromptTemplate: '{text}',
        },
      })
    ).rejects.toThrow('未配置大模型 API Key');
  });
});

