import { vi } from 'vitest';

export class Position {
  constructor(public line: number, public character: number) {}
}

export class Range {
  constructor(public start: Position, public end: Position) {}
}

export class ThemeColor {
  constructor(public id: string) {}
}

export class MarkdownString {
  public value: string = '';
  public isTrusted: boolean = false;
  public supportHtml: boolean = false;
  constructor(val?: string) {
    if (val) this.value = val;
  }
  appendMarkdown(val: string) {
    this.value += val;
    return this;
  }
  appendText(val: string) {
    this.value += val;
    return this;
  }
}

export class Hover {
  constructor(public contents: MarkdownString | string | any[], public range?: Range) {}
}

export const commands = {
  executeCommand: vi.fn(),
  registerCommand: vi.fn(),
};

export const DecorationRangeBehavior = {
  OpenOpen: 0,
  ClosedClosed: 1,
  OpenClosed: 2,
  ClosedOpen: 3,
};

export const workspace = {
  getConfiguration: vi.fn().mockReturnValue({
    get: vi.fn((key: string, defaultVal: unknown) => defaultVal),
    update: vi.fn().mockResolvedValue(undefined),
  }),
};

export const window = {
  activeTextEditor: undefined as any,
  visibleTextEditors: [] as any[],
  createTextEditorDecorationType: vi.fn().mockReturnValue({
    dispose: vi.fn(),
  }),
  createWebviewPanel: vi.fn().mockReturnValue({
    webview: {
      html: '',
      postMessage: vi.fn(),
      onDidReceiveMessage: vi.fn(),
    },
    onDidDispose: vi.fn(),
    dispose: vi.fn(),
    reveal: vi.fn(),
  }),
  showInformationMessage: vi.fn(),
  showErrorMessage: vi.fn(),
  showQuickPick: vi.fn(),
  showInputBox: vi.fn(),
  setStatusBarMessage: vi.fn(),
};

export const ViewColumn = {
  Active: -1,
  Beside: -2,
  One: 1,
  Two: 2,
};

export const Uri = {
  parse: (s: string) => ({ toString: () => s, fsPath: s }),
  file: (s: string) => ({ toString: () => s, fsPath: s }),
};

export const env = {
  clipboard: {
    writeText: vi.fn().mockResolvedValue(undefined),
  },
};

export const lm = {
  selectChatModels: vi.fn().mockResolvedValue([]),
};

export const LanguageModelChatMessage = {
  User: (content: string) => ({ role: 'user', content }),
  Assistant: (content: string) => ({ role: 'assistant', content }),
};

export class CancellationTokenSource {
  token = {};
  cancel() {}
  dispose() {}
}

export const ConfigurationTarget = {
  Global: 1,
  Workspace: 2,
  WorkspaceFolder: 3,
};

