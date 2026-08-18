import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'tests/profileTelegramRequest.test.js',
      'tests/dashboardAiRequest.test.js',
      'tests/deploymentContract.test.js',
      'tests/zaiThinking.test.js',
      'tests/csrf.test.js',
    ],
    reporters: ['verbose'],
  },
});
