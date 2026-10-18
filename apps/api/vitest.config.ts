import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: { name: 'unit', include: ['test/unit/**/*.test.ts'] },
      },
      {
        test: {
          name: 'db',
          include: ['test/db/**/*.test.ts'],
          globalSetup: ['test/db/global-setup.ts'],
          // One throwaway database for the run; files take turns.
          fileParallelism: false,
          testTimeout: 20_000,
        },
      },
    ],
  },
});
