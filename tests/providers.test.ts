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
});
