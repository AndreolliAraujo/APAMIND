// ESLint 9 flat config — APAMIND
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import prettierConfig from "eslint-config-prettier";

export default tseslint.config(
  // Arquivos ignorados
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "src-tauri/target/**",
      "src-tauri/gen/**",
      ".vs/**",
      "coverage/**",
    ],
  },
  // Base: recommended JS + TypeScript + type-checked
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // React: regras de plugin sem deprecated
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: {
      react: reactPlugin,
      "react-hooks": reactHooksPlugin,
    },
    languageOptions: {
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        window: "readonly",
        document: "readonly",
        console: "readonly",
        localStorage: "readonly",
        requestAnimationFrame: "readonly",
        cancelAnimationFrame: "readonly",
        crypto: "readonly",
        URL: "readonly",
        Blob: "readonly",
        FileReader: "readonly",
        DOMParser: "readonly",
        HTMLElement: "readonly",
        KeyboardEvent: "readonly",
        MouseEvent: "readonly",
        Set: "readonly",
        Map: "readonly",
        Promise: "readonly",
        CustomEvent: "readonly",
        TextEncoder: "readonly",
        TextDecoder: "readonly",
        queueMicrotask: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        navigator: "readonly",
        alert: "readonly",
        confirm: "readonly",
        __TAURI__: "writable",
      },
    },
    rules: {
      // React
      "react/jsx-uses-react": "off",
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
      "react/jsx-key": "warn",
      // Hooks
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      // Estilo
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-expressions": "error",
      "prefer-const": "warn",
      "no-empty": ["error", { allowEmptyCatch: true }],
      // Desativa regras que conflitam com Prettier
      ...prettierConfig.rules,
    },
    settings: {
      react: { version: "detect" },
    },
  },
);
