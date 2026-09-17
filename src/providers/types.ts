import { ProviderId, PromptStyle } from '../config/types.js';

export interface TranslationRequest {
  sourceText: string;
  targetLang: string;
  style: PromptStyle;
  temperature?: number;
}

export interface TranslationResponse {
  translatedText: string;
  providerId: ProviderId;
  model: string;
  latencyMs: number;
}

export interface ITranslationProvider {
  readonly id: ProviderId;
  readonly name: string;
  readonly description: string;
  readonly supportsCustomPrompt: boolean;

  translate(request: TranslationRequest): Promise<TranslationResponse>;
  testConnection(): Promise<{ success: boolean; message?: string }>;
}
