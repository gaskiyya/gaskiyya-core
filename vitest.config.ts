import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // A real database (GASKIYA_TEST_STORE=mongo or firestore) is slower than the in-memory store.
    testTimeout: process.env.GASKIYA_TEST_STORE ? 90_000 : 20_000,
    pool: 'forks',
    globalSetup: ['tests/mongo-global.ts'],
  },
});
