import * as fs from 'fs/promises';
import * as path from 'path';
import { computeCacheKey } from './cacheKey.js';

export interface CustomStyleEntry {
  key: string;
  sourceText: string;
  targetLang: string;
  styleId: string;
  translation: string;
  model: string;
  providerId: string;
  updatedAt: number;
}

export class CustomStyleStore {
  private baseDir: string;
  // styleId -> Map<key, entry>
  private memoryCaches: Map<string, Map<string, CustomStyleEntry>> = new Map();
  private isInitialized = false;

  constructor(storageDir: string) {
    this.baseDir = path.join(storageDir, 'custom_style_store');
  }

  public async initialize(): Promise<void> {
    if (this.isInitialized) return;

    await fs.mkdir(this.baseDir, { recursive: true });

    try {
      const entries = await fs.readdir(this.baseDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const styleId = entry.name;
          const styleFile = path.join(this.baseDir, styleId, 'cache.json');
          try {
            const raw = await fs.readFile(styleFile, 'utf-8');
            const list: CustomStyleEntry[] = JSON.parse(raw);
            const map = new Map<string, CustomStyleEntry>();
            for (const item of list) {
              map.set(item.key, item);
            }
            this.memoryCaches.set(styleId, map);
          } catch {
            // New or empty directory
          }
        }
      }
    } catch (err) {
      console.warn('[AnyComment CustomStyleStore] Init error:', err);
    }

    this.isInitialized = true;
  }

  private getOrCreateStyleMap(styleId: string): Map<string, CustomStyleEntry> {
    let map = this.memoryCaches.get(styleId);
    if (!map) {
      map = new Map();
      this.memoryCaches.set(styleId, map);
    }
    return map;
  }

  public get(styleId: string, key: string): CustomStyleEntry | undefined {
    const map = this.memoryCaches.get(styleId);
    return map?.get(key);
  }

  public getBySourceText(styleId: string, sourceText: string, targetLang: string): CustomStyleEntry | undefined {
    const key = computeCacheKey(sourceText, targetLang, styleId);
    return this.get(styleId, key);
  }

  public async set(entry: Omit<CustomStyleEntry, 'key' | 'updatedAt'>): Promise<CustomStyleEntry> {
    const key = computeCacheKey(entry.sourceText, entry.targetLang, entry.styleId);
    const fullEntry: CustomStyleEntry = {
      ...entry,
      key,
      updatedAt: Date.now(),
    };

    const map = this.getOrCreateStyleMap(entry.styleId);
    map.set(key, fullEntry);

    await this.persistStyle(entry.styleId);
    return fullEntry;
  }

  private async persistStyle(styleId: string): Promise<void> {
    const map = this.memoryCaches.get(styleId);
    if (!map) return;

    const styleDir = path.join(this.baseDir, styleId);
    await fs.mkdir(styleDir, { recursive: true });

    const entries = Array.from(map.values());
    await fs.writeFile(path.join(styleDir, 'cache.json'), JSON.stringify(entries, null, 2), 'utf-8');
  }

  public async clearStyle(styleId: string): Promise<void> {
    this.memoryCaches.delete(styleId);
    const styleDir = path.join(this.baseDir, styleId);
    try {
      await fs.rm(styleDir, { recursive: true, force: true });
    } catch {
      // Ignore if not present
    }
  }

  public async clearAll(): Promise<void> {
    this.memoryCaches.clear();
    try {
      await fs.rm(this.baseDir, { recursive: true, force: true });
      await fs.mkdir(this.baseDir, { recursive: true });
    } catch {
      // Ignore
    }
  }

  public getStats() {
    const styleStats: Record<string, number> = {};
    let totalEntries = 0;
    for (const [styleId, map] of this.memoryCaches.entries()) {
      styleStats[styleId] = map.size;
      totalEntries += map.size;
    }
    return {
      styleCounts: styleStats,
      totalCount: totalEntries,
    };
  }
}
