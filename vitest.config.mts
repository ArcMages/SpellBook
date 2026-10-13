import { defineConfig } from 'vitest/config';

// Unit tests run in plain Node, without Obsidian. Everything under src/core is
// written so that it can be tested this way.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    passWithNoTests: false,
  },
});
