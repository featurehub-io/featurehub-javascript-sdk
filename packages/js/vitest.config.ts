import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "js-sdk",
    globals: true,
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts"],
    coverage: {
      provider: "istanbul",
      reporter: ["text", "json", "html"],
    },
  },
});
