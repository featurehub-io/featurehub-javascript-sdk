import { defineConfig } from 'tsup'

export default defineConfig((options) => ({
  name: "featurehub-solid-sdk",
  entry: ['src/index.ts'],
  format: ["esm"],
  plugins: [],
  outExtension() {
    return {
      js: `.jsx`,
    }
  },
  bundle: true,
  clean: true,
  dts: true,
  sourcemap: true,
  splitting: true,
  minify: !options.watch,
}))
