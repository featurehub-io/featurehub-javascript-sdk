// vite.config.js
import { fileURLToPath } from "node:url";

import { dirname, resolve } from "path";
import { defineConfig } from "vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
  build: {
    lib: {
      // Entry file for the library
      entry: resolve(__dirname, "src/index.ts"),
      // The name of your library (will be a global variable in UMD build)
      name: "featurehub-javascript-client-sdk",
      // The generated file names (defaults to name.es.js and name.umd.js)
      fileName: (format) => `featurehub-javascript-client-sdk.${format}.js`,
    },
    rollupOptions: {
      // Externalize dependencies so they are not bundled into your library
      external: [], // Add your dependencies here
      output: {
        // Provide global variables to use in the UMD build for externalized deps
        globals: {
          // react: 'React',
          // vue: 'Vue',
        },
      },
    },
  },
});
