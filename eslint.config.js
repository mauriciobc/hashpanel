export default [
  {
    ignores: ["node_modules/**", "data/**", "logs/**", "public/**"],
  },
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        process: "readonly",
        console: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        fetch: "readonly",
        Buffer: "readonly",
        URL: "readonly",
        Date: "readonly",
        Math: "readonly",
        Error: "readonly",
        Map: "readonly",
        Set: "readonly",
        Promise: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "semi": ["error", "always"],
      "quotes": ["error", "single"],
    },
  },
  {
    // The CLI is a terminal user interface: console output is expected.
    files: ["src/cli/**/*.js"],
    rules: {
      "no-console": "off",
    },
  },
];
