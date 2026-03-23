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
      ['src/__tests__/screen-utf8.test.ts', 'node'],
      ['src/__tests__/charwidth.test.ts', 'node'],
      ['src/__tests__/pty-rendering.test.ts', 'node'],
    ],
    // screen 세션을 사용하는 테스트는 병렬 실행 시 충돌하므로 sequential 실행
    poolOptions: {
      threads: {
        singleThread: false,
      },
    },
    sequence: {
      concurrent: false,
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
