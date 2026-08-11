import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'tests/profileTelegramRequest.test.js',
      'tests/deploymentContract.test.js',
      'tests/zaiThinking.test.js',
    ],
    reporters: ['verbose'],
  },
});
