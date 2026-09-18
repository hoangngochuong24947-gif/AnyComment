import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { DrawerManager } from '../src/features/drawerManager.js';
import { ConfigManager } from '../src/config/index.js';
import { StorageManager } from '../src/storage/storageManager.js';
import { window, ViewColumn, Position } from './mocks/vscode.js';

describe('DrawerManager Tests (Variant D Slide-out Drawer)', () => {
  let tempDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'anycomment-drawer-test-'));

    const mockContext: any = {
      globalStorageUri: { fsPath: tempDir },
      globalState: { get: vi.fn(), update: vi.fn() },
      extensionUri: { toString: () => 'file:///mock' },
      secrets: { get: vi.fn(), store: vi.fn(), delete: vi.fn() },
      subscriptions: [],
    };
    ConfigManager.initialize(mockContext);
    const storageMgr = StorageManager.initialize(tempDir);
    await storageMgr.init();
    DrawerManager.initialize(mockContext);

    if (DrawerManager.currentPanel) {
      DrawerManager.currentPanel.dispose();
    }
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should initialize with context extensionUri', () => {
    const mockContext: any = {
      extensionUri: { toString: () => 'file:///mock' },
      subscriptions: [],
    };
    expect(() => DrawerManager.initialize(mockContext)).not.toThrow();
  });

  it('should open webview panel in ViewColumn.Beside with preserveFocus true', async () => {
    const mockDoc: any = {
      fileName: '/workspace/deepequal.go',
      uri: { toString: () => 'file:///workspace/deepequal.go' },
    };

    await DrawerManager.openDrawer({
      document: mockDoc,
      position: new Position(10, 5) as any,
      text: '// Comparison algorithm assumes checks are true',
      signature: 'func deepValueEqual',
    });

    expect(window.createWebviewPanel).toHaveBeenCalledTimes(1);
    expect(window.createWebviewPanel).toHaveBeenCalledWith(
      'anycomment.drawer',
      expect.stringContaining('deepequal.go'),
      expect.objectContaining({
        viewColumn: ViewColumn.Beside,
        preserveFocus: true,
      }),
      expect.any(Object)
    );
    expect(DrawerManager.currentPanel).toBeDefined();
  });

  it('should reuse existing panel on repeated openDrawer calls (singleton pattern)', async () => {
    const mockDoc: any = {
      fileName: '/workspace/test.go',
      uri: { toString: () => 'file:///workspace/test.go' },
    };

    await DrawerManager.openDrawer({
      document: mockDoc,
      position: new Position(0, 0) as any,
      text: '// first call',
    });

    const initialPanel = DrawerManager.currentPanel;

    await DrawerManager.openDrawer({
      document: mockDoc,
      position: new Position(5, 0) as any,
      text: '// second call',
    });

    expect(window.createWebviewPanel).toHaveBeenCalledTimes(1);
    expect(DrawerManager.currentPanel).toBe(initialPanel);
  });
});
