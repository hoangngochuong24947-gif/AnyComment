import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { AnyCommentHoverProvider } from '../src/features/hoverProvider.js';
import { ConfigManager } from '../src/config/index.js';
import { StorageManager } from '../src/storage/storageManager.js';
import { ProviderRegistry } from '../src/providers/registry.js';
import { Position, Range, commands } from './mocks/vscode.js';

describe('AnyCommentHoverProvider TDD Tests', () => {
  let tempDir: string;
  let provider: AnyCommentHoverProvider;

  beforeEach(async () => {
    vi.clearAllMocks();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'anycomment-hover-test-'));

    const mockContext: any = {
      globalStorageUri: { fsPath: tempDir },
      globalState: { get: vi.fn(), update: vi.fn() },
      extensionUri: { toString: () => 'file:///mock' },
      secrets: { get: vi.fn(), store: vi.fn(), delete: vi.fn() },
      subscriptions: [],
    };
    ConfigManager.initialize(mockContext);
    const storage = StorageManager.initialize(tempDir);
    await storage.init();

    provider = new AnyCommentHoverProvider();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('1. should return cached translation immediately with zero delay (0ms cache hit)', async () => {
    const storage = StorageManager.getInstance();
    await storage.saveStandardTranslation(
      'Calculate acoustic phonons and thermal conductivity.',
      'zh-CN',
      '计算声子色散与晶格热导率。',
      'google'
    );

    const docLines = [
      '// Calculate acoustic phonons and thermal conductivity.',
      'func computePhonons() {}',
    ];
    const mockDoc: any = {
      lineCount: docLines.length,
      languageId: 'go',
      uri: { toString: () => 'file:///workspace/phonons.go' },
      lineAt: (i: number) => ({ text: docLines[i] }),
    };

    const startTime = performance.now();
    const hover = await provider.provideHover(mockDoc, new Position(0, 10) as any, {} as any);
    const duration = performance.now() - startTime;

    expect(duration).toBeLessThan(50); // Instant < 50ms
    expect(hover).toBeDefined();
    const content = typeof hover?.contents === 'object' && 'value' in hover.contents ? hover.contents.value : '';
    expect(content).toContain('计算声子色散与晶格热导率。');
    expect(content).toContain('AnyComment 双语对照与技术解读');
    expect(content).toContain('打开双语透视抽屉 (方案 D 推荐)');
  });

  it('2. should automatically fetch fast translation when uncached (auto-translation on hover)', async () => {
    // Mock global fetch to simulate Google Fast Translate
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => [[['深度比对算法执行时必须跟踪检查。', 'During deepValueEqual, must keep track of checks.']]],
    } as unknown as Response);

    try {
      const docLines = [
        '// During deepValueEqual, must keep track of checks.',
        'func deepValueEqual() {}',
      ];
      const mockDoc: any = {
        lineCount: docLines.length,
        languageId: 'go',
        uri: { toString: () => 'file:///workspace/deepequal.go' },
        lineAt: (i: number) => ({ text: docLines[i] }),
      };

      const hover = await provider.provideHover(mockDoc, new Position(0, 5) as any, {} as any);
      expect(hover).toBeDefined();
      const content = typeof hover?.contents === 'object' && 'value' in hover.contents ? hover.contents.value : '';

      // The hover MUST contain the translated Chinese text directly!
      expect(content).toContain('深度比对算法执行时必须跟踪检查。');
      expect(content).toContain('中文直译');

      // And it must save to cache so subsequent hovers are 0ms
      const storage = StorageManager.getInstance();
      const cached = storage.get('During deepValueEqual, must keep track of checks.', 'zh-CN', 'literal-accurate');
      expect(cached).toBeDefined();
      expect(cached?.translation).toBe('深度比对算法执行时必须跟踪检查。');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('3. should enforce strict timeout on slow LSP queries so hover never hangs (>150ms capped)', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [[['卡帕', 'kappa_L']]],
    } as unknown as Response);

    try {
      // Simulate a slow or hanging LSP server
      commands.executeCommand = vi.fn().mockImplementation((cmd: string) => {
        if (cmd === 'vscode.executeHoverProvider') {
          return new Promise((resolve) => setTimeout(() => resolve([]), 2000)); // 2s hang
        }
        return Promise.resolve(undefined);
      });

      const docLines = ['const kappa_L = 0.4367;'];
      const mockDoc: any = {
        lineCount: docLines.length,
        languageId: 'python',
        uri: { toString: () => 'file:///workspace/params.py' },
        lineAt: (i: number) => ({ text: docLines[i] }),
        getWordRangeAtPosition: () => new Range(new Position(0, 6), new Position(0, 13)),
        getText: () => 'kappa_L',
      };

      const startTime = performance.now();
      const hover = await provider.provideHover(mockDoc, new Position(0, 8) as any, {} as any);
      const duration = performance.now() - startTime;

      // Must return within ~200ms instead of waiting 2000ms!
      expect(duration).toBeLessThan(350);
      expect(hover).toBeDefined();
      const content = typeof hover?.contents === 'object' && 'value' in hover.contents ? hover.contents.value : '';
      expect(content).toContain('打开双语透视抽屉 (方案 D 推荐)');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('4. should gracefully return action buttons when translation channel is offline', async () => {
    // Simulate network error across all fallback channels
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network offline'));

    try {
      const docLines = [
        '// Uncached comment with offline network',
      ];
      const mockDoc: any = {
        lineCount: docLines.length,
        languageId: 'go',
        uri: { toString: () => 'file:///workspace/offline.go' },
        lineAt: (i: number) => ({ text: docLines[i] }),
      };

      const hover = await provider.provideHover(mockDoc, new Position(0, 5) as any, {} as any);
      expect(hover).toBeDefined();
      const content = typeof hover?.contents === 'object' && 'value' in hover.contents ? hover.contents.value : '';
      expect(content).toContain('打开双语透视抽屉 (方案 D 推荐)');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
