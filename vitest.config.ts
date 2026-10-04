import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      include: ['src/**/*.ts'],
      // cli.ts runs in a child process in test/cli.test.ts, which v8 coverage does not see. The paste UI is DOM glue
      // and render.ts needs a real Chromium; both are checked by hand (see CONTRIBUTING).
      exclude: ['src/web/**', 'src/render.ts', 'src/cli.ts'],
      reporter: ['text-summary', 'text'],
    },
  },
});
