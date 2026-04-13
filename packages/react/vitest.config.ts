import react from "@vitejs/plugin-react-swc";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { defineConfig } from "vitest/config";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "featurehub-javascript-client-sdk": resolve(__dirname, "../js/src"),
      "featurehub-javascript-core-sdk": resolve(__dirname, "../core/src"),
    },
  },
  test: {
    name: "react-sdk",
    globals: true,
    environment: "jsdom",
    setupFiles: ["src/__tests__/setup.ts"],
    include: ["src/__tests__/**/*.test.{ts,tsx}"],
  },
});
