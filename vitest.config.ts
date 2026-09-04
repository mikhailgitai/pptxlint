import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@pptxlint/core": fileURLToPath(
        new URL("./packages/core/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    coverage: {
      enabled: false,
    },
    include: ["packages/**/*.test.ts", "tests/unit/**/*.test.ts"],
  },
});
