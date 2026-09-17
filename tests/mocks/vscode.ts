import { vi } from 'vitest';

export class Position {
  constructor(public line: number, public character: number) {}
}

export class Range {
  constructor(public start: Position, public end: Position) {}
}

export const workspace = {
  getConfiguration: vi.fn().mockReturnValue({
    get: vi.fn((key: string, defaultVal: unknown) => defaultVal),
    update: vi.fn().mockResolvedValue(undefined),
  }),
};

export const window = {
  createTextEditorDecorationType: vi.fn().mockReturnValue({
    dispose: vi.fn(),
  }),
  showInformationMessage: vi.fn(),
  showErrorMessage: vi.fn(),
  showQuickPick: vi.fn(),
  showInputBox: vi.fn(),
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
