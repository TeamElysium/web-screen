import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: [],
    environmentMatchGlobs: [
      ['src/__tests__/socket-handler.test.ts', 'node'],
      ['src/__tests__/screen-manager.test.ts', 'node'],
      ['src/__tests__/auth.test.ts', 'node'],
    ],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
