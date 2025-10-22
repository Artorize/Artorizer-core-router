import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 120000, // 2 minutes - processing can take time
    hookTimeout: 30000,
    include: ['tests/**/*.test.ts'],
  },
});
