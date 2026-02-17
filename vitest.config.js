import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@contracts': path.resolve(__dirname, '../contracts'),
    },
  },
  test: {
    environment: 'node',
  },
});
