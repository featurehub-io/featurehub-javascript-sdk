import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    name: "todo-frontend-react-sdk",
    globals: true,
    environment: "jsdom",
    setupFiles: ["src/__tests__/setup.ts"],
    include: ["src/**/__tests__/**/*.test.tsx", "src/**/__tests__/**/*.test.ts"],
  },
});
