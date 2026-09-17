import * as vscode from 'vscode';

/**
 * Lightweight, zero-dependency stream and waiting animation controller.
 * Provides a restrained, elegant inline ghost pulse and native 60fps status bar feedback.
 *
 * Official Reference: https://code.visualstudio.com/api/references/vscode-api#window.createTextEditorDecorationType
 */
export class StreamAnimator {
  private static instance: StreamAnimator;

  private decorationType: vscode.TextEditorDecorationType;
  private timer: NodeJS.Timeout | null = null;
  private currentEditor: vscode.TextEditor | null = null;
  private currentLine = 0;
  private currentStep = 0;
  private statusBarDisposable: vscode.Disposable | null = null;

  private readonly FRAMES = [
    '  ⏳ [AnyComment: 正在解析中文 ·]',
    '  ⏳ [AnyComment: 正在解析中文 · ·]',
    '  ⏳ [AnyComment: 正在解析中文 · · ·]',
    '  ⏳ [AnyComment: 中文即将就绪 ...]',
  ];

  private constructor() {
    this.decorationType = vscode.window.createTextEditorDecorationType({
      after: {
        margin: '0 0 0 1.5em',
        color: new vscode.ThemeColor('editorGhostText.foreground'),
        fontStyle: 'italic',
      },
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedOpen,
    });
  }

  public static getInstance(): StreamAnimator {
    if (!StreamAnimator.instance) {
      StreamAnimator.instance = new StreamAnimator();
    }
    return StreamAnimator.instance;
  }

  /**
   * Start restrained inline waiting animation on the specified editor line.
   */
  public start(editor: vscode.TextEditor, lineIndex: number, label = '正在解析中文'): void {
    this.stop(); // Clean up any active timer

    this.currentEditor = editor;
    this.currentLine = Math.min(lineIndex, editor.document.lineCount - 1);
    this.currentStep = 0;

    // 1. Trigger VS Code native spinning icon in status bar
    this.statusBarDisposable = vscode.window.setStatusBarMessage(
      `$(sync~spin) AnyComment: ${label}...`
    );

    // 2. Render initial frame immediately (0ms)
    this.renderFrame();

    // 3. Cycle frames subtly every 350ms
    this.timer = setInterval(() => {
      this.currentStep = (this.currentStep + 1) % this.FRAMES.length;
      this.renderFrame();
    }, 350);
  }

  private renderFrame(): void {
    if (!this.currentEditor || this.currentEditor.document.isClosed) {
      this.stop();
      return;
    }

    try {
      const line = this.currentEditor.document.lineAt(this.currentLine);
      const text = this.FRAMES[this.currentStep] ?? this.FRAMES[0];

      this.currentEditor.setDecorations(this.decorationType, [
        {
          range: line.range,
          renderOptions: {
            after: {
              contentText: text,
            },
          },
        },
      ]);
    } catch {
      this.stop();
    }
  }

  /**
   * Stop waiting animation and optionally display a success banner for 2 seconds.
   */
  public stop(successHint?: string): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    if (this.statusBarDisposable) {
      this.statusBarDisposable.dispose();
      this.statusBarDisposable = null;
    }

    if (!this.currentEditor || this.currentEditor.document.isClosed) {
      this.currentEditor = null;
      return;
    }

    if (successHint) {
      try {
        const line = this.currentEditor.document.lineAt(this.currentLine);
        this.currentEditor.setDecorations(this.decorationType, [
          {
            range: line.range,
            renderOptions: {
              after: {
                contentText: `  ✓ [AnyComment: ${successHint}]`,
                color: new vscode.ThemeColor('testing.iconPassed'),
              },
            },
          },
        ]);

        const editorRef = this.currentEditor;
        setTimeout(() => {
          if (!editorRef.document.isClosed) {
            editorRef.setDecorations(this.decorationType, []);
          }
        }, 2200);
      } catch {
        this.currentEditor.setDecorations(this.decorationType, []);
      }
    } else {
      this.currentEditor.setDecorations(this.decorationType, []);
    }

    this.currentEditor = null;
  }

  public getDecorationType(): vscode.TextEditorDecorationType {
    return this.decorationType;
  }

  public dispose(): void {
    this.stop();
    this.decorationType.dispose();
  }
}
