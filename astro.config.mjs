import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import node from '@astrojs/node';

export default defineConfig({
  integrations: [react()],
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  vite: {
    ssr: {
      external: ['node:sqlite', 'node:fs', 'node:path', 'node:crypto'],
    },
  },
});
