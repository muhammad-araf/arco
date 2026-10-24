import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Lives under tests/ (the only directory this QA work may add files to),
// so the test script invokes it explicitly:
//   npm test  ->  vitest run --config tests/vitest.config.ts
const here = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    // Mirror tsconfig.json paths: "@/*" -> repo root.
    alias: {
      "@": path.resolve(here, ".."),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
