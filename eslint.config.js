// eslint.config.js — flat config. Type-aware lint cho src/ (Bun + TS strict, ESM).
// Encode luật CLAUDE.md: no-any, await mọi promise, type-import nhất quán, không nuốt lỗi.

import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // Không lint: deps, repo tham chiếu, SQL generate, plugin/skill, chính file config.
  { ignores: ["node_modules/", "taxlegal/", "migrations/", ".claude/", "**/*.js"] },

  { files: ["src/**/*.ts"], extends: [js.configs.recommended, tseslint.configs.recommendedTypeChecked] },

  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parserOptions: {
        // projectService: type-aware không cần liệt kê từng tsconfig.
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.node,
        Bun: "readonly",
      },
    },
    rules: {
      // CLAUDE.md: không any; không rõ kiểu → unknown rồi narrow.
      "@typescript-eslint/no-explicit-any": "error",
      // CLAUDE.md: await mọi promise, không floating.
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      // ESM + verbatimModuleSyntax: import type nhất quán.
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { fixStyle: "inline-type-imports" },
      ],
      // CLAUDE.md: không log debug; error/warn (vận hành) cho phép.
      "no-console": ["warn", { allow: ["error", "warn"] }],
      // Dọn biến/import thừa DO thay đổi mình gây ra; cho phép _prefix cố ý bỏ.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },

  // Test: nới rule không hợp ngữ cảnh test (mock async không await, fixture lỏng kiểu).
  {
    files: ["src/**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/await-thenable": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-return": "off",
    },
  },

  // gen-migration: script CLI, in SQL ra stdout là chủ đích (không phải debug).
  {
    files: ["src/db/gen-migration.ts"],
    rules: { "no-console": "off" },
  },
);
