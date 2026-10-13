import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Unit tests run in plain Node, without Obsidian. Everything under src/core is
// written so that it can be tested this way.
//
// The "obsidian" module only exists inside the Obsidian app (the npm package
// holds type declarations, no code). The few tests that load code which
// imports it get a small stand-in instead: tests/obsidianStub.ts.
export default defineConfig({
  resolve: {
    alias: {
      obsidian: fileURLToPath(new URL('./tests/obsidianStub.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    passWithNoTests: false,
  },
});
