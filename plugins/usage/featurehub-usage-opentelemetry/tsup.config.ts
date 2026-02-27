import { defineConfig } from "tsup";

import pkg from "./package.json";

export default defineConfig({
  name: "featurehub-usage-segment",
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  bundle: true,
  clean: true,
  dts: {
    footer: `declare module '${pkg.name}'`,
  },
});
