import { defineConfig, globalIgnores } from "eslint/config";
import base from "../../eslint.base.js";

export default defineConfig([
  globalIgnores(["dist", "coverage"]),
  base,
  {
    files: ["**/*.ts"],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
]);
