import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // Contra MongoDB los archivos comparten la misma base, así que van uno por uno.
    fileParallelism: false,
    testTimeout: 15000,
  },
});
