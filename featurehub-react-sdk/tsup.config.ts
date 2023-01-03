import { defineConfig } from 'tsup'

export default defineConfig((options) => ({
  entry: ['src/index.ts'],
  format: ["esm", "cjs"],
  bundle: true,
  clean: true,
  dts: true,
  sourcemap: true,
  splitting: true,
  minify: !options.watch,
}))
