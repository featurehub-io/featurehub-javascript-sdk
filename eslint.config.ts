import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import react from "eslint-plugin-react";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import solid from "eslint-plugin-solid/configs/typescript";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
  //
  // ────────────────────────────────
  // 1️⃣ Ignored paths (like .eslintignore)
  // ────────────────────────────────
  //
  {
    ignores: [
      "**/build/**",
      "**/coverage/**",
      "**/dist/**",
      "**/node_modules/**",
      // TODO: Revisit these sections later so that we can have linting across everything
      "examples/todo-server-tests/features/**",
      "examples/todo-angular-featurehub-app/**",
      "plugins/**",
    ],
  },
  //
  // ────────────────────────────────
  // 2️⃣ Base recommended rules
  // ────────────────────────────────
  //
  js.configs.recommended,
  tseslint.configs.strict,
  //
  // ────────────────────────────────
  // 3️⃣ Import sorting
  // ────────────────────────────────
  //
  {
    plugins: {
      "simple-import-sort": simpleImportSort,
    },
    rules: {
      "simple-import-sort/imports": "error",
      "simple-import-sort/exports": "error",
    },
  },
  //
  // ────────────────────────────────
  // 3️⃣ TypeScript (General - Base rules)
  // ────────────────────────────────
  //
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
        ...globals.es2022,
        ...globals.node,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-extraneous-class": "warn",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          args: "after-used",
          argsIgnorePattern: "^_",
          caughtErrors: "all",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  //
  // ────────────────────────────────
  // 5️⃣ React
  // ────────────────────────────────
  //
  {
    files: [
      "packages/react/**/*.{jsx,ts,tsx}",
      "examples/todo-frontend-react-sdk/**/*.{jsx,ts,tsx}",
      "examples/todo-frontend-react-typescript/**/*.{jsx,ts,tsx}",
      "examples/todo-frontend-react-typescript-catch-and-release/**/*.{jsx,ts,tsx}",
      "examples/todo-frontend-react-typescript-feature-override/**/*.{jsx,ts,tsx}",
    ],
    ...react.configs.flat.recommended,
    ...react.configs.flat["jsx-runtime"],
    languageOptions: {
      ...react.configs.flat.recommended.languageOptions,
      globals: {
        ...globals.browser,
      },
    },
  },
  //
  // ────────────────────────────────
  // 6️⃣ SolidJS
  // ────────────────────────────────
  //
  {
    files: [
      "packages/solid/**/*.{jsx,ts,tsx}",
      "examples/todo-frontend-solid-sdk/**/*.{jsx,ts,tsx}",
    ],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
      },
    },
    plugins: {
      solid: {
        meta: solid.plugins.solid.meta,
        // @ts-expect-error — Solid config typing is a bit off
        rules: solid.plugins.solid.rules,
      },
    },
    rules: solid.rules,
  },
  //
  // ────────────────────────────────
  // 7️⃣ Test environment (Vitest)
  // ────────────────────────────────
  //
  {
    files: ["**/*.test.{ts,tsx}", "**/*.spec.{ts,tsx}"],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.vitest,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/naming-convention": "off",
    },
  },
]);
