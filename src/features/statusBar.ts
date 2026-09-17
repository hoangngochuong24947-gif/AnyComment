import * as vscode from 'vscode';
import { ConfigManager } from '../config/index.js';
import { ProviderRegistry } from '../providers/registry.js';
import { StorageManager } from '../storage/storageManager.js';
import type { ProviderId, StyleId } from '../config/types.js';

export class StatusBarManager {
  private statusBarItem: vscode.StatusBarItem;
  private disposables: vscode.Disposable[] = [];

  constructor() {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this.statusBarItem.command = 'anycomment.statusBarMenu';
    this.updateLabel();
    this.statusBarItem.show();
  }

  public register(context: vscode.ExtensionContext): void {
    const menuCmd = vscode.commands.registerCommand('anycomment.statusBarMenu', () => {
      this.showQuickMenu();
    });

    const switchProviderCmd = vscode.commands.registerCommand('anycomment.switchProvider', () => {
      this.promptSwitchProvider();
    });

    const switchStyleCmd = vscode.commands.registerCommand('anycomment.switchStyle', () => {
      this.promptSwitchStyle();
    });

    const clearCacheCmd = vscode.commands.registerCommand('anycomment.clearCache', async () => {
      await this.promptClearCache();
    });

    const configChange = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('anycomment')) {
        this.updateLabel();
      }
    });

    this.disposables.push(menuCmd, switchProviderCmd, switchStyleCmd, clearCacheCmd, configChange, this.statusBarItem);
    context.subscriptions.push(...this.disposables);
  }

  public updateLabel(): void {
    const config = ConfigManager.getInstance().getConfig();
    const provider = ProviderRegistry.getInstance().getProvider(config.activeProvider);
    const style = ConfigManager.getInstance().getPromptStyle(config.activeStyle);

    let providerShort = 'OpenAI';
    if (provider.id === 'vscode-lm') providerShort = 'Copilot';
    if (provider.id === 'google') providerShort = 'Google';

    this.statusBarItem.text = `$(comment-discussion) AnyComment: ${providerShort} · ${style.name.split(' ')[0]}`;
    this.statusBarItem.tooltip = `AnyComment 状态:\n- 服务: ${provider.name}\n- 风格: ${style.name}\n- 目标语言: ${config.targetLanguage}\n(点击切换)`;
  }

  private async showQuickMenu(): Promise<void> {
    const items = [
      { label: '$(plug) 切换 AI 翻译服务', description: 'DeepSeek / Copilot / Google', action: 'provider' },
      { label: '$(symbol-keyword) 切换提示词风格', description: '通俗 / 直译 / 深度解析 / 自定义', action: 'style' },
      { label: '$(eye) 切换行内沉浸式注释 (Cmd+Shift+B)', description: '开启/关闭行末 Ghost Text', action: 'toggleImmersive' },
      { label: '$(trash) 清理缓存', description: '独立重置自定义风格或全部缓存', action: 'clearCache' },
    ];

    const pick = await vscode.window.showQuickPick(items, {
      placeHolder: 'AnyComment 控制菜单',
    });

    if (!pick) return;

    if (pick.action === 'provider') {
      await this.promptSwitchProvider();
    } else if (pick.action === 'style') {
      await this.promptSwitchStyle();
    } else if (pick.action === 'toggleImmersive') {
      vscode.commands.executeCommand('anycomment.toggleImmersive');
    } else if (pick.action === 'clearCache') {
      await this.promptClearCache();
    }
  }

  private async promptSwitchProvider(): Promise<void> {
    const providers = ProviderRegistry.getInstance().getAllProviders();
    const config = ConfigManager.getInstance().getConfig();

    const items = providers.map((p) => ({
      label: `${p.id === config.activeProvider ? '● ' : '○ '} ${p.name}`,
      description: p.description,
      providerId: p.id,
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: '选择要使用的翻译服务 (Provider)',
    });

    if (selected) {
      await ConfigManager.getInstance().setActiveProvider(selected.providerId as ProviderId);
      this.updateLabel();
      vscode.window.showInformationMessage(`AnyComment: 已切换服务为 [${selected.providerId}]`);
    }
  }

  private async promptSwitchStyle(): Promise<void> {
    const config = ConfigManager.getInstance().getConfig();
    const styleIds: StyleId[] = ['tech-plain', 'literal', 'deep-dive', 'custom'];

    const items = styleIds.map((id) => {
      const style = ConfigManager.getInstance().getPromptStyle(id);
      return {
        label: `${id === config.activeStyle ? '● ' : '○ '} ${style.name}`,
        description: style.description,
        styleId: id,
      };
    });

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: '选择翻译与解析的提示词风格',
    });

    if (selected) {
      await ConfigManager.getInstance().setActiveStyle(selected.styleId);
      this.updateLabel();
      vscode.window.showInformationMessage(`AnyComment: 已切换提示词风格为 [${selected.styleId}]`);
    }
  }

  private async promptClearCache(): Promise<void> {
    const picks = [
      { label: '仅清理当前风格的自定义缓存', action: 'current' },
      { label: '清理所有自定义风格缓存 (保留官方预置标准库)', action: 'all-custom' },
    ];

    const pick = await vscode.window.showQuickPick(picks, {
      placeHolder: '选择缓存清理范围',
    });

    if (!pick) return;

    const storage = StorageManager.getInstance();
    const config = ConfigManager.getInstance().getConfig();

    if (pick.action === 'current') {
      await storage.clearCustomCache(config.activeStyle);
      vscode.window.showInformationMessage(`已清空风格 [${config.activeStyle}] 的自定义缓存`);
    } else if (pick.action === 'all-custom') {
      await storage.clearCustomCache();
      vscode.window.showInformationMessage('已清空所有自定义风格缓存，官方预存标准库完好保留');
    }
  }

  public dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }
}
