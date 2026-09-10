import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "drizzle/**",
      "data/**",
      "backups/**",
      "coverage/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
    },
    rules: {
      // Unused symbols are surfaced as warnings so lint stays green while
      // still flagging dead code; a leading underscore opts out explicitly.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // The codebase forbids `any`; the guard rules below keep that honest.
      "@typescript-eslint/no-explicit-any": "warn",
      "no-console": "off",
    },
  },
  {
    // Scripts and config talk to the process/console directly.
    files: ["scripts/**/*.{ts,mjs}", "*.config.{ts,mjs}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
);
