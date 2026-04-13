import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import solid from "vite-plugin-solid";
import { defineConfig } from "vitest/config";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [solid()],
  resolve: {
    alias: {
      "featurehub-javascript-client-sdk": resolve(__dirname, "../js/src"),
      "featurehub-javascript-core-sdk": resolve(__dirname, "../core/src"),
    },
    conditions: ["development", "browser"],
  },
  test: {
    name: "solid-sdk",
    globals: true,
    environment: "jsdom",
    setupFiles: ["src/__tests__/setup.ts"],
    include: ["src/__tests__/**/*.test.{ts,tsx}"],
  },
});
