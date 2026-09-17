import { StandardStore, StandardTranslationEntry } from './standardStore.js';
import { CustomStyleStore, CustomStyleEntry } from './customStyleStore.js';
import { StyleId } from '../config/types.js';

export interface QueryResult {
  translation: string;
  partition: 'custom' | 'standard';
  source: 'seed' | 'google' | 'standard_ai' | 'custom_ai';
  styleId?: string;
  isFallback?: boolean; // True if user requested a custom style, but we fell back to the standard pre-bundled translation
  updatedAt: number;
}

export class StorageManager {
  private static instance: StorageManager;
  private standardStore: StandardStore;
  private customStore: CustomStyleStore;
  private l1MemoryCache: Map<string, QueryResult> = new Map();
  private maxL1Entries = 500;

  constructor(storageDir: string) {
    this.standardStore = new StandardStore(storageDir);
    this.customStore = new CustomStyleStore(storageDir);
  }

  public static initialize(storageDir: string, bundledSeedsPath?: string): StorageManager {
    if (!StorageManager.instance) {
      StorageManager.instance = new StorageManager(storageDir);
    }
    return StorageManager.instance;
  }

  public static getInstance(): StorageManager {
    if (!StorageManager.instance) {
      throw new Error('StorageManager not initialized yet');
    }
    return StorageManager.instance;
  }

  public async init(bundledSeedsPath?: string): Promise<void> {
    await Promise.all([
      this.standardStore.initialize(bundledSeedsPath),
      this.customStore.initialize(),
    ]);
  }

  /**
   * Fast lookup across L1 memory and L2 dual partitions
   */
  public get(text: string, targetLang: string, styleId: StyleId): QueryResult | undefined {
    const l1Key = `${text}::${targetLang}::${styleId}`;
    const cachedL1 = this.l1MemoryCache.get(l1Key);
    if (cachedL1) {
      return cachedL1;
    }

    // 1. Try Custom Style Store
    const customEntry = this.customStore.getBySourceText(styleId, text, targetLang);
    if (customEntry) {
      const res: QueryResult = {
        translation: customEntry.translation,
        partition: 'custom',
        source: 'custom_ai',
        styleId: customEntry.styleId,
        isFallback: false,
        updatedAt: customEntry.updatedAt,
      };
      this.setL1(l1Key, res);
      return res;
    }

    // 2. Fall back to Standard Store (bundled seeds / objective baseline)
    const stdEntry = this.standardStore.getBySourceText(text, targetLang);
    if (stdEntry) {
      const res: QueryResult = {
        translation: stdEntry.translation,
        partition: 'standard',
        source: stdEntry.source,
        isFallback: true, // We provided the standard canonical translation as a fallback
        updatedAt: stdEntry.updatedAt,
      };
      this.setL1(l1Key, res);
      return res;
    }

    return undefined;
  }

  public async saveCustomTranslation(
    text: string,
    targetLang: string,
    styleId: string,
    translation: string,
    model: string,
    providerId: string
  ): Promise<void> {
    await this.customStore.set({
      sourceText: text,
      targetLang,
      styleId,
      translation,
      model,
      providerId,
    });

    const l1Key = `${text}::${targetLang}::${styleId}`;
    this.setL1(l1Key, {
      translation,
      partition: 'custom',
      source: 'custom_ai',
      styleId,
      isFallback: false,
      updatedAt: Date.now(),
    });
  }

  public async saveStandardTranslation(
    text: string,
    targetLang: string,
    translation: string,
    source: 'google' | 'standard_ai'
  ): Promise<void> {
    await this.standardStore.set({
      sourceText: text,
      targetLang,
      translation,
      source,
    });

    // Also warm L1 for standard lookups
    const l1Key = `${text}::${targetLang}::literal`;
    this.setL1(l1Key, {
      translation,
      partition: 'standard',
      source,
      isFallback: false,
      updatedAt: Date.now(),
    });
  }

  private setL1(key: string, val: QueryResult): void {
    if (this.l1MemoryCache.size >= this.maxL1Entries) {
      // Evict oldest entry
      const firstKey = this.l1MemoryCache.keys().next().value;
      if (firstKey) this.l1MemoryCache.delete(firstKey);
    }
    this.l1MemoryCache.set(key, val);
  }

  public async clearCustomCache(styleId?: string): Promise<void> {
    this.l1MemoryCache.clear();
    if (styleId) {
      await this.customStore.clearStyle(styleId);
    } else {
      await this.customStore.clearAll();
    }
  }

  public getStats() {
    return {
      standard: this.standardStore.getStats(),
      custom: this.customStore.getStats(),
      l1Size: this.l1MemoryCache.size,
    };
  }
}
