import type { ITranslationProvider, TranslationRequest, TranslationResponse } from './types.js';
import type { ProviderId } from '../config/types.js';
import { OpenAICompatibleProvider } from './openaiCompatible.js';
import { VSCodeLMProvider } from './vscodeLM.js';
import { GoogleTranslateProvider } from './googleTranslate.js';
import { ConfigManager } from '../config/index.js';

export class ProviderRegistry {
  private static instance: ProviderRegistry;
  private providers: Map<ProviderId, ITranslationProvider> = new Map();

  private constructor() {
    this.register(new OpenAICompatibleProvider());
    this.register(new VSCodeLMProvider());
    this.register(new GoogleTranslateProvider());
  }

  public static getInstance(): ProviderRegistry {
    if (!ProviderRegistry.instance) {
      ProviderRegistry.instance = new ProviderRegistry();
    }
    return ProviderRegistry.instance;
  }

  public register(provider: ITranslationProvider): void {
    this.providers.set(provider.id, provider);
  }

  public getProvider(id: ProviderId): ITranslationProvider {
    const provider = this.providers.get(id);
    if (!provider) {
      // Fall back to OpenAI or Google
      const fallback = this.providers.get('openai') ?? this.providers.get('google');
      if (!fallback) {
        throw new Error('No providers registered');
      }
      return fallback;
    }
    return provider;
  }

  public getActiveProvider(): ITranslationProvider {
    const activeId = ConfigManager.getInstance().getConfig().activeProvider;
    return this.getProvider(activeId);
  }

  public getAllProviders(): ITranslationProvider[] {
    return Array.from(this.providers.values());
  }

  public async executeTranslation(request: TranslationRequest): Promise<TranslationResponse> {
    const activeProvider = this.getActiveProvider();
    try {
      return await activeProvider.translate(request);
    } catch (err: unknown) {
      console.warn(`[AnyComment] Active provider ${activeProvider.id} failed:`, err);
      // Try VS Code LM (Copilot) if active was not vscode-lm
      if (activeProvider.id !== 'vscode-lm') {
        try {
          const vsCodeLm = this.getProvider('vscode-lm');
          console.info('[AnyComment] Falling back to VS Code LM (Copilot)...');
          return await vsCodeLm.translate(request);
        } catch {
          // Continue to Google Translate baseline
        }
      }
      // Finally fall back to Google Translate baseline
      if (activeProvider.id !== 'google') {
        const googleProvider = this.getProvider('google');
        console.info('[AnyComment] Falling back to Google Translate baseline...');
        return await googleProvider.translate(request);
      }
      throw err;
    }
  }
}
