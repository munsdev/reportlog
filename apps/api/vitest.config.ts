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
          // Some files make and migrate their own databases in beforeAll
          // (archive.test.ts makes two). That is a few seconds on an idle
          // machine and grows with every migration; the default 10s ran out
          // once under load and skipped a whole file.
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
