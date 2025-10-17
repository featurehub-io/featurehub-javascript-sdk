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
      exclude: ["node_modules/", "src/**/__tests__/**", "dist/", "*.config.*"],
    },
  },
  resolve: {
    alias: {
      "cross-sha256": new URL(
        "../../node_modules/.pnpm/cross-sha256@1.2.0/node_modules/cross-sha256/index.js",
        import.meta.url,
      ).pathname,
    },
  },
});
