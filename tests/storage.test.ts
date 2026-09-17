import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { computeCacheKey, normalizeText } from '../src/storage/cacheKey.js';
import { StandardStore } from '../src/storage/standardStore.js';
import { CustomStyleStore } from '../src/storage/customStyleStore.js';
import { StorageManager } from '../src/storage/storageManager.js';

describe('Storage & Cache Tests', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'anycomment-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('normalizeText should handle line endings and trailing whitespace', () => {
    const raw = '  hello world   \r\n\r\nsecond line  \r\n';
    const norm = normalizeText(raw);
    expect(norm).toBe('hello world\n\nsecond line');
  });

  it('computeCacheKey should produce identical hash for same content with different spacing', () => {
    const k1 = computeCacheKey('hello world\r\n', 'zh-CN');
    const k2 = computeCacheKey('  hello world \n', 'zh-CN');
    expect(k1).toBe(k2);
  });

  it('StandardStore should load seeds and isolate user cache', async () => {
    // Create a mock seeds file
    const seedFile = path.join(tempDir, 'seeds.json');
    await fs.writeFile(
      seedFile,
      JSON.stringify({
        seeds: [
          {
            identifier: 'http.ListenAndServe',
            sourceText: 'ListenAndServe listens on addr',
            targetLang: 'zh-CN',
            translation: '监听 addr 地址并提供服务',
          },
        ],
      })
    );

    const store = new StandardStore(tempDir);
    await store.initialize(seedFile);

    // Verify seed is loaded
    const hit = store.getBySourceText('ListenAndServe listens on addr', 'zh-CN');
    expect(hit).toBeDefined();
    expect(hit?.translation).toBe('监听 addr 地址并提供服务');
    expect(hit?.source).toBe('seed');

    // Add user cache entry
    await store.set({
      sourceText: 'New doc',
      targetLang: 'zh-CN',
      translation: '新文档翻译',
      source: 'google',
    });

    const stats = store.getStats();
    expect(stats.seedCount).toBe(1);
    expect(stats.cacheCount).toBe(1);
    expect(stats.totalCount).toBe(2);
  });

  it('CustomStyleStore should isolate different styles', async () => {
    const store = new CustomStyleStore(tempDir);
    await store.initialize();

    await store.set({
      sourceText: 'func Worker()',
      targetLang: 'zh-CN',
      styleId: 'tech-plain',
      translation: 'Worker 协程处理任务',
      model: 'deepseek-chat',
      providerId: 'openai',
    });

    await store.set({
      sourceText: 'func Worker()',
      targetLang: 'zh-CN',
      styleId: 'deep-dive',
      translation: '【深度解析】Worker 函数用于后台任务调度',
      model: 'gpt-4o',
      providerId: 'vscode-lm',
    });

    const hitPlain = store.getBySourceText('tech-plain', 'func Worker()', 'zh-CN');
    const hitDeep = store.getBySourceText('deep-dive', 'func Worker()', 'zh-CN');

    expect(hitPlain?.translation).toBe('Worker 协程处理任务');
    expect(hitDeep?.translation).toBe('【深度解析】Worker 函数用于后台任务调度');

    // Clearing tech-plain should NOT delete deep-dive
    await store.clearStyle('tech-plain');
    expect(store.getBySourceText('tech-plain', 'func Worker()', 'zh-CN')).toBeUndefined();
    expect(store.getBySourceText('deep-dive', 'func Worker()', 'zh-CN')).toBeDefined();
  });

  it('StorageManager should fall back to standard store when custom translation is missing', async () => {
    const mgr = new StorageManager(tempDir);
    await mgr.init();

    // Save a standard translation
    await mgr.saveStandardTranslation('Standard text', 'zh-CN', '标准中文释义', 'google');

    // Query with a custom style 'deep-dive' (which hasn't been translated with custom style yet)
    const res = mgr.get('Standard text', 'zh-CN', 'deep-dive');
    expect(res).toBeDefined();
    expect(res?.translation).toBe('标准中文释义');
    expect(res?.isFallback).toBe(true);
    expect(res?.partition).toBe('standard');

    // Now generate and save a custom translation for it
    await mgr.saveCustomTranslation(
      'Standard text',
      'zh-CN',
      'deep-dive',
      '深度解读：标准文本的注意事项',
      'deepseek-chat',
      'openai'
    );

    // Query again with 'deep-dive'
    const res2 = mgr.get('Standard text', 'zh-CN', 'deep-dive');
    expect(res2?.translation).toBe('深度解读：标准文本的注意事项');
    expect(res2?.isFallback).toBe(false);
    expect(res2?.partition).toBe('custom');
  });
});
