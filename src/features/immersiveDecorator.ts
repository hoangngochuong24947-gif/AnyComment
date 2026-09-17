import * as vscode from 'vscode';
import { CommentExtractor } from '../parser/commentExtractor.js';
import { StorageManager } from '../storage/storageManager.js';
import { ConfigManager } from '../config/index.js';
import { ProviderRegistry } from '../providers/registry.js';

/**
 * Immersive Comment Decorator
 * Renders translated comments inline as ghost text at the end of lines.
 * Toggled via Cmd+Shift+B (Ctrl+Shift+B).
 * Official Reference: https://code.visualstudio.com/api/references/vscode-api#window.createTextEditorDecorationType
 */
export class ImmersiveDecorator {
  private isEnabled = false;
  private decorationType: vscode.TextEditorDecorationType;
  private disposables: vscode.Disposable[] = [];

  constructor() {
    this.decorationType = vscode.window.createTextEditorDecorationType({
      after: {
        margin: '0 0 0 2em',
        color: new vscode.ThemeColor('descriptionForeground'),
        fontStyle: 'italic',
      },
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedOpen,
    });
  }

  public register(context: vscode.ExtensionContext): void {
    const toggleCmd = vscode.commands.registerCommand('anycomment.toggleImmersive', () => {
      this.toggle();
    });

    const changeEditor = vscode.window.onDidChangeActiveTextEditor(() => {
      if (this.isEnabled) {
        this.updateActiveEditor();
      }
    });

    const changeDoc = vscode.workspace.onDidChangeTextDocument((e) => {
      if (this.isEnabled && vscode.window.activeTextEditor?.document === e.document) {
        this.updateActiveEditor();
      }
    });

    this.disposables.push(toggleCmd, changeEditor, changeDoc, this.decorationType);
    context.subscriptions.push(...this.disposables);
  }

  public toggle(): void {
    this.isEnabled = !this.isEnabled;
    if (this.isEnabled) {
      vscode.window.showInformationMessage('AnyComment: 行内沉浸式注释翻译已开启');
      this.updateActiveEditor();
    } else {
      this.clearAll();
      vscode.window.showInformationMessage('AnyComment: 行内沉浸式注释翻译已关闭');
    }
  }

  public clearAll(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      editor.setDecorations(this.decorationType, []);
    }
  }

  public async updateActiveEditor(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !this.isEnabled) {
      return;
    }

    const doc = editor.document;
    const comments = CommentExtractor.extractDocumentComments(doc);
    const config = ConfigManager.getInstance().getConfig();
    const storage = StorageManager.getInstance();

    const decorations: vscode.DecorationOptions[] = [];

    for (const comment of comments) {
      const cached = storage.get(comment.cleanText, config.targetLanguage, config.activeStyle);
      if (cached) {
        decorations.push({
          range: comment.range,
          renderOptions: {
            after: {
              contentText: ` // 🌐 ${cached.translation}`,
            },
          },
        });
      }
    }

    editor.setDecorations(this.decorationType, decorations);
  }

  public dispose(): void {
    this.clearAll();
    this.disposables.forEach((d) => d.dispose());
  }
}
