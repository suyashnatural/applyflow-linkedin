import js from "@eslint/js";

export default [
  js.configs.recommended,
  {
    ignores: ["**/dist/**", "**/.next/**", "**/build/**", "**/coverage/**", "prettier.config.cjs"],
  },
  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
    },
    rules: {
      "no-console": "off",
    },
  },
];
