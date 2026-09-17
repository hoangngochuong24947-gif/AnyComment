import * as vscode from 'vscode';
import { ConfigManager } from '../config/index.js';
import { ProviderRegistry } from '../providers/registry.js';
import { StorageManager } from '../storage/storageManager.js';
import type { ProviderId, TranslationStyleId, ExplainStyleId } from '../config/types.js';

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

    const toggleExplainCmd = vscode.commands.registerCommand('anycomment.toggleExplainMode', async () => {
      const cfg = ConfigManager.getInstance();
      const current = cfg.getConfig().enableExplainMode;
      await cfg.setEnableExplainMode(!current);
      this.updateLabel();
      vscode.window.showInformationMessage(
        !current ? 'AnyComment: 已切换为【💡 中文大白话讲解模式】' : 'AnyComment: 已切换为【🌐 标准翻译模式】'
      );
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

    this.disposables.push(
      menuCmd,
      toggleExplainCmd,
      switchProviderCmd,
      switchStyleCmd,
      clearCacheCmd,
      configChange,
      this.statusBarItem
    );
    context.subscriptions.push(...this.disposables);
  }

  public updateLabel(): void {
    const config = ConfigManager.getInstance().getConfig();
    const provider = ProviderRegistry.getInstance().getProvider(config.activeProvider);

    let providerShort = 'OpenAI';
    if (provider.id === 'vscode-lm') providerShort = 'Copilot';
    if (provider.id === 'google') providerShort = 'Google';

    if (config.enableExplainMode) {
      const explainStyle = ConfigManager.getInstance().getExplainStyle(config.explainStyle);
      this.statusBarItem.text = `$(lightbulb) AnyComment: ${providerShort} · 讲解(${explainStyle.name.split(' ')[0]})`;
      this.statusBarItem.tooltip = `AnyComment [大白话讲解模式已激活]\n- 服务: ${provider.name}\n- 讲解风格: ${explainStyle.name}\n(点击呼出菜单，或按 Cmd+Shift+E 切回直译)`;
    } else {
      const transStyle = ConfigManager.getInstance().getTranslationStyle(config.activeStyle);
      this.statusBarItem.text = `$(comment-discussion) AnyComment: ${providerShort} · 翻译(${transStyle.name.split('·')[0] || transStyle.name})`;
      this.statusBarItem.tooltip = `AnyComment [标准翻译模式]\n- 服务: ${provider.name}\n- 翻译风格: ${transStyle.name}\n(点击呼出菜单，或按 Cmd+Shift+E 切换为大白话讲解)`;
    }
  }

  private async showQuickMenu(): Promise<void> {
    const config = ConfigManager.getInstance().getConfig();

    const items = [
      {
        label: config.enableExplainMode ? '$(comment) 切换到【标准翻译模式】' : '$(lightbulb) 切换到【中文大白话讲解模式】',
        description: '快捷键: Cmd+Shift+E / Ctrl+Shift+E',
        action: 'toggleExplain',
      },
      {
        label: '$(plug) 切换 AI 翻译服务',
        description: 'Copilot / DeepSeek / Google',
        action: 'provider',
      },
      {
        label: config.enableExplainMode ? '$(symbol-keyword) 切换【大白话讲解风格】' : '$(symbol-keyword) 切换【翻译提示词风格】',
        description: config.enableExplainMode ? '极简大白话 / 生产实战 / 架构意图' : '科技专家 / 开源GitHub / 逐行直译 / 双语混合',
        action: 'style',
      },
      {
        label: '$(eye) 切换行内沉浸式注释 (Cmd+Shift+B)',
        description: '开启/关闭代码行末 Ghost Text 译文',
        action: 'toggleImmersive',
      },
      {
        label: '$(trash) 清理缓存',
        description: '独立重置自定义风格或全部缓存',
        action: 'clearCache',
      },
    ];

    const pick = await vscode.window.showQuickPick(items, {
      placeHolder: 'AnyComment 控制中心快捷菜单',
    });

    if (!pick) return;

    if (pick.action === 'toggleExplain') {
      vscode.commands.executeCommand('anycomment.toggleExplainMode');
    } else if (pick.action === 'provider') {
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

    if (config.enableExplainMode) {
      // Switch Explain Style
      const explainIds: ExplainStyleId[] = ['pragmatic', 'eli5', 'intent'];
      const items = explainIds.map((id) => {
        const style = ConfigManager.getInstance().getExplainStyle(id);
        return {
          label: `${id === config.explainStyle ? '● ' : '○ '} ${style.name}`,
          description: style.description,
          styleId: id,
        };
      });

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: '选择大白话讲解风格',
      });

      if (selected) {
        await ConfigManager.getInstance().setExplainStyle(selected.styleId as ExplainStyleId);
        this.updateLabel();
        vscode.window.showInformationMessage(`AnyComment: 讲解风格已切换为 [${selected.styleId}]`);
      }
    } else {
      // Switch Translation Style
      const transIds: TranslationStyleId[] = ['tech-native', 'github-dev', 'literal-accurate', 'bilingual-mix', 'custom'];
      const items = transIds.map((id) => {
        const style = ConfigManager.getInstance().getTranslationStyle(id);
        return {
          label: `${id === config.activeStyle ? '● ' : '○ '} ${style.name}`,
          description: style.description,
          styleId: id,
        };
      });

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: '选择翻译提示词风格',
      });

      if (selected) {
        await ConfigManager.getInstance().setActiveStyle(selected.styleId as TranslationStyleId);
        this.updateLabel();
        vscode.window.showInformationMessage(`AnyComment: 翻译风格已切换为 [${selected.styleId}]`);
      }
    }
  }

  private async promptClearCache(): Promise<void> {
    const picks = [
      { label: '仅清理当前生效风格的自定义缓存', action: 'current' },
      { label: '清理所有自定义风格与讲解缓存 (保留官方预存标准库)', action: 'all-custom' },
    ];

    const pick = await vscode.window.showQuickPick(picks, {
      placeHolder: '选择缓存清理范围',
    });

    if (!pick) return;

    const storage = StorageManager.getInstance();
    const config = ConfigManager.getInstance().getConfig();

    const activeStyle = config.enableExplainMode ? config.explainStyle : config.activeStyle;
    if (pick.action === 'current') {
      await storage.clearCustomCache(activeStyle);
      vscode.window.showInformationMessage(`已清空风格 [${activeStyle}] 的自定义缓存`);
    } else if (pick.action === 'all-custom') {
      await storage.clearCustomCache();
      vscode.window.showInformationMessage('已清空所有自定义风格与讲解缓存，官方预存标准库完好保留');
    }
  }

  public dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }
}
