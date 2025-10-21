import { defineConfig } from "tsup";

import pkg from "./package.json";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs"],
  platform: "node",
  bundle: true,
  clean: true,
  dts: {
    footer: `declare module '${pkg.name}'`,
  },
});
