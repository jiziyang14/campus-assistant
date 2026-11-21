import { defineConfig } from 'vitest/config'

// eslint-disable-next-line import/no-default-export
export default defineConfig({
  define: {
    __API_ORIGIN__: JSON.stringify(''),
    __APP_VERSION__: JSON.stringify('test'),
    __BUILD_TIME__: JSON.stringify('2026-01-01T00:00:00.000Z'),
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
