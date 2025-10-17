import { defineConfig } from "tsup";
import pkg from "./package.json";

export default defineConfig({
  name: "featurehub-react-sdk",
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  bundle: true,
  clean: true,
  sourcemap: true,
  splitting: true,
  dts: {
    footer: `declare module '${pkg.name}'`,
  },
});
