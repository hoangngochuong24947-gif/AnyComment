import * as fs from 'fs/promises';
import * as path from 'path';
import { computeCacheKey, normalizeText } from './cacheKey.js';

export interface StandardTranslationEntry {
  key: string;
  sourceText: string;
  targetLang: string;
  translation: string;
  source: 'seed' | 'google' | 'standard_ai';
  identifier?: string;
  updatedAt: number;
}

export class StandardStore {
  private baseDir: string;
  private cacheFilePath: string;
  private memoryMap: Map<string, StandardTranslationEntry> = new Map();
  private seedKeys: Set<string> = new Set();
  private isInitialized = false;

  constructor(storageDir: string) {
    this.baseDir = path.join(storageDir, 'standard_store');
    this.cacheFilePath = path.join(this.baseDir, 'user_standard_cache.json');
  }

  public async initialize(bundledSeedsPath?: string): Promise<void> {
    if (this.isInitialized) return;

    await fs.mkdir(this.baseDir, { recursive: true });

    // 1. Load bundled seeds if provided
    if (bundledSeedsPath) {
      try {
        const seedRaw = await fs.readFile(bundledSeedsPath, 'utf-8');
        const seedData = JSON.parse(seedRaw);
        if (Array.isArray(seedData.seeds)) {
          for (const item of seedData.seeds) {
            const key = computeCacheKey(item.sourceText, item.targetLang || 'zh-CN');
            const entry: StandardTranslationEntry = {
              key,
              sourceText: item.sourceText,
              targetLang: item.targetLang || 'zh-CN',
              translation: item.translation,
              source: 'seed',
              identifier: item.identifier,
              updatedAt: Date.now(),
            };
            this.memoryMap.set(key, entry);
            this.seedKeys.add(key);
          }
        }
      } catch (err) {
        console.warn('[AnyComment StandardStore] Failed to load seeds:', err);
      }
    }

    // 2. Load user runtime standard cache
    try {
      const cacheRaw = await fs.readFile(this.cacheFilePath, 'utf-8');
      const cacheEntries: StandardTranslationEntry[] = JSON.parse(cacheRaw);
      if (Array.isArray(cacheEntries)) {
        for (const entry of cacheEntries) {
          // Seeds take priority or user cache overrides if newer
          if (!this.memoryMap.has(entry.key)) {
            this.memoryMap.set(entry.key, entry);
          }
        }
      }
    } catch {
      // File may not exist yet on first run; normal behavior
    }

    this.isInitialized = true;
  }

  public get(key: string): StandardTranslationEntry | undefined {
    return this.memoryMap.get(key);
  }

  public getBySourceText(sourceText: string, targetLang: string): StandardTranslationEntry | undefined {
    const key = computeCacheKey(sourceText, targetLang);
    return this.memoryMap.get(key);
  }

  public async set(entry: Omit<StandardTranslationEntry, 'key' | 'updatedAt'>): Promise<StandardTranslationEntry> {
    const key = computeCacheKey(entry.sourceText, entry.targetLang);
    const fullEntry: StandardTranslationEntry = {
      ...entry,
      key,
      updatedAt: Date.now(),
    };

    this.memoryMap.set(key, fullEntry);
    await this.persistUserCache();
    return fullEntry;
  }

  private async persistUserCache(): Promise<void> {
    try {
      const userEntries: StandardTranslationEntry[] = [];
      for (const [key, entry] of this.memoryMap.entries()) {
        if (!this.seedKeys.has(key)) {
          userEntries.push(entry);
        }
      }
      await fs.writeFile(this.cacheFilePath, JSON.stringify(userEntries, null, 2), 'utf-8');
    } catch (err) {
      console.error('[AnyComment StandardStore] Persist error:', err);
    }
  }

  public getStats() {
    return {
      seedCount: this.seedKeys.size,
      cacheCount: this.memoryMap.size - this.seedKeys.size,
      totalCount: this.memoryMap.size,
    };
  }
}
