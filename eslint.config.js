// Flat config para ESLint 9
// Integração com TypeScript e Prettier
import js from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import prettier from "eslint-config-prettier";
import pluginImport from "eslint-plugin-import";
import pluginPrettier from "eslint-plugin-prettier";
import globals from "globals";

export default [
  {
    ignores: ["node_modules/**", "dist/**", "coverage/**"],
  },
  {
    files: ["**/*.{ts,tsx,js}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        sourceType: "module",
        ecmaVersion: "latest",
        project: false,
      },
      globals: {
        ...globals.node,
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
      import: pluginImport,
      prettier: pluginPrettier,
    },
    settings: {
      "import/resolver": {
        typescript: {
          alwaysTryTypes: true,
        },
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      ...tseslint.configs.recommended.rules,
      "prettier/prettier": "warn",
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "off",
      "import/no-unresolved": "off",
    },
  },
  prettier,
];
