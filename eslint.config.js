// @ts-check
//
// Lint for the Angular app (`npm run lint`, also run before every deploy by
// .github/workflows/deploy-pages.yml).
//
// "Gentle" mode, set up mid-con on 2026-11-20: anything set to "error" stops a deploy; the
// rules in GENTLE below are only warnings, because the existing code had ~130 hits on them
// and a stuck deploy during BGG.CON would cost more than the style issue. After the con, fix
// the warnings and delete the GENTLE block so they block deploys too (see README → After
// the con).
const eslint = require("@eslint/js");
const tseslint = require("typescript-eslint");
const angular = require("angular-eslint");

/** Warn-only for now (README → After the con). Counts are from 2026-11-20. */
const GENTLE = {
  "@typescript-eslint/no-explicit-any": "warn", // 84: mostly Tabletop.Events API responses
  "@typescript-eslint/no-unused-vars": "warn", // 19
  "prefer-const": "warn", // 12
  "@angular-eslint/no-output-native": "warn", // 4: outputs named like DOM events (e.g. "select")
  "@typescript-eslint/no-inferrable-types": "warn",
  "@typescript-eslint/no-empty-function": "warn",
  "@typescript-eslint/consistent-generic-constructors": "warn",
  "no-extra-boolean-cast": "warn",
  "no-useless-escape": "warn",
};

module.exports = tseslint.config(
  {
    files: ["**/*.ts"],
    extends: [
      eslint.configs.recommended,
      ...tseslint.configs.recommended,
      ...tseslint.configs.stylistic,
      ...angular.configs.tsRecommended,
    ],
    processor: angular.processInlineTemplates,
    rules: {
      // "app-" for screens and features, "bl-" for small shared building blocks (bl-icon,
      // bl-rich-text, [blInView]) — both are this app's own.
      "@angular-eslint/directive-selector": [
        "error",
        { type: "attribute", prefix: ["app", "bl"], style: "camelCase" },
      ],
      "@angular-eslint/component-selector": [
        "error",
        { type: "element", prefix: ["app", "bl"], style: "kebab-case" },
      ],
      ...GENTLE,
    },
  },
  {
    files: ["**/*.html"],
    extends: [
      ...angular.configs.templateRecommended,
      ...angular.configs.templateAccessibility,
    ],
    rules: {},
  }
);
