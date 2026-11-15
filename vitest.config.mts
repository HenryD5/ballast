import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    // Los tests del controlador usan una API de VS Code simulada.
    alias: { vscode: fileURLToPath(new URL('./test/unit/mocks/vscode.ts', import.meta.url)) },
  },
  test: {
    include: ['test/unit/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**', 'webview-ui/src/**'],
      exclude: ['webview-ui/src/main.ts', 'src/extension.ts'],
      reporter: ['text-summary', 'html'],
      // Mínimos un poco por debajo de lo actual (93 % de líneas): si un cambio los rompe, falla la publicación.
      thresholds: { lines: 90, statements: 86, branches: 78, functions: 80 },
    },
  },
});
