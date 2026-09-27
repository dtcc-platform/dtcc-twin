import js from "@eslint/js";
import vitest from "@vitest/eslint-plugin";
import tseslint from "typescript-eslint";

// Shared by every package; each sets its own parserOptions, since tsconfigRootDir is per package.
export default [
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
    rules: {
      // Safe with Nest's DI: the rule skips files with decorators, where `import type` would break injection.
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-shadow": "error",
      // Types by default, interfaces where merging or extends is wanted; the stylistic preset would force one.
      "@typescript-eslint/consistent-type-definitions": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "no-console": "warn",
    },
  },
  {
    files: ["**/*.spec.ts", "**/*.e2e-spec.ts"],
    plugins: { vitest },
    rules: {
      ...vitest.configs.recommended.rules,
      "@typescript-eslint/unbound-method": "off",
      "vitest/unbound-method": "error",
    },
  },
];
