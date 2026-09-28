import globals from "globals";
import { defineConfig, globalIgnores } from "eslint/config";
import base from "../../eslint.base.js";

export default defineConfig([
  globalIgnores(["dist", "coverage"]),
  base,
  {
    files: ["**/*.ts"],
    languageOptions: {
      globals: globals.node,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/no-extraneous-class": ["error", { allowWithDecorator: true }],
      // erasableSyntaxOnly would also ban Nest's constructor parameter properties, so only its enum ban is kept.
      "no-restricted-syntax": [
        "error",
        { selector: "TSEnumDeclaration", message: "Use a union type or a zod enum from @repo/contracts." },
      ],
    },
  },
  {
    files: ["src/**/*.ts"],
    ignores: ["src/config/**"],
    rules: {
      "no-restricted-properties": [
        "error",
        {
          object: "process",
          property: "env",
          message: "Read configuration through ConfigService; only src/config/ touches process.env.",
        },
      ],
    },
  },
  {
    files: ["scripts/**/*.ts"],
    rules: { "no-console": "off" },
  },
  {
    files: ["**/*.spec.ts", "**/*.e2e-spec.ts"],
    rules: {
      "vitest/expect-expect": ["error", { assertFunctionNames: ["expect", "request.**.expect"] }],
    },
  },
]);
