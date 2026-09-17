import { defineConfig } from 'vitest/config';
import * as path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
  },
  resolve: {
    alias: {
      vscode: path.resolve(__dirname, './tests/mocks/vscode.ts'),
    },
  },
});
