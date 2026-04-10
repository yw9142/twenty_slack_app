import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

const isIntegrationRun = process.env.RUN_TWENTY_INTEGRATION_TESTS === 'true';

export default defineConfig({
  plugins: [
    tsconfigPaths({
      projects: ['tsconfig.spec.json'],
      ignoreConfigErrors: true,
    }),
  ],
  test: {
    testTimeout: 120_000,
    hookTimeout: 120_000,
    include: isIntegrationRun
      ? ['src/**/*.integration-test.ts']
      : ['src/**/*.test.ts'],
    exclude: isIntegrationRun ? [] : ['src/**/*.integration-test.ts'],
    setupFiles: isIntegrationRun ? ['src/__tests__/setup-test.ts'] : [],
  },
});
