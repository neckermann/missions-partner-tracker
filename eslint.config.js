// One config for both workspaces. They're different environments -- backend
// is CommonJS on Node, frontend is ESM in a browser with JSX -- so each gets
// its own block rather than a lowest-common-denominator setup.
//
// Rule severities are chosen for a codebase that has never been linted:
// anything that catches a real bug is an error, anything stylistic that
// Prettier already settles is off, and the rest warn. CI runs with --quiet
// (errors only), so warnings are a to-do list rather than a blocker.

const js = require("@eslint/js");
const globals = require("globals");
const react = require("eslint-plugin-react");
const reactHooks = require("eslint-plugin-react-hooks");
const jsxA11y = require("eslint-plugin-jsx-a11y");

module.exports = [
  {
    ignores: [
      "**/node_modules/**",
      "backend/public/**", // the built frontend, written here by vite
      "backend/prisma/migrations/**",
      "frontend/dist/**",
      "frontend/test-results/**",
      "frontend/playwright-report/**",
    ],
  },

  // --- Backend: CommonJS, Node ---
  {
    files: ["backend/**/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "commonjs",
      globals: { ...globals.node },
    },
    rules: {
      ...js.configs.recommended.rules,
      // Unused function arguments are load-bearing in Express: an error
      // handler is only recognised as one because it takes four parameters,
      // so `next` must stay even when unused.
      // ignoreRestSiblings covers the deliberate omit pattern --
      // `const { passwordHash, mfaSecret, ...rest } = user` is how sensitive
      // fields get dropped before a response, and flagging it would push
      // people toward keeping them.
      "no-unused-vars": [
        "error",
        { argsIgnorePattern: "^(next|_)", varsIgnorePattern: "^_", ignoreRestSiblings: true },
      ],
      "no-console": "off", // this is a server; logging is the point
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-var": "error",
      "prefer-const": "warn",
    },
  },

  // --- Backend tests: Node's built-in test runner ---
  {
    files: ["backend/test/**/*.js"],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },

  // --- Frontend: ESM, browser, React ---
  {
    files: ["frontend/**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: { react: { version: "detect" } },
    plugins: {
      react,
      "react-hooks": reactHooks,
      "jsx-a11y": jsxA11y,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...react.configs.flat.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,

      // This project uses the modern JSX transform, so React needn't be in
      // scope and prop-types aren't used.
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",

      // Off deliberately. It flags every apostrophe in ordinary prose, and
      // the "fix" is to write don&apos;t in the source -- harder to read and
      // easier to get wrong than the thing it guards against, which React
      // escapes correctly anyway.
      "react/no-unescaped-entities": "off",

      // The codebase labels inputs by wrapping them, which is valid and
      // accessible. Two adjustments so the rule sees that: allow either
      // wrapping or htmlFor, and name the custom components that render a
      // real control inside, which the linter can't see through.
      "jsx-a11y/label-has-associated-control": [
        "error",
        {
          assert: "either",
          depth: 3,
          controlComponents: ["PresetOrCustomSelect", "PartnerSelect", "AddressFields"],
        },
      ],

      // Warn, not error. Focusing the first field of a single-purpose form
      // the user navigated to on purpose (login, first-run setup) is
      // defensible; doing it elsewhere usually isn't. Worth seeing, not
      // worth blocking.
      "jsx-a11y/no-autofocus": "warn",

      // The two that actually catch bugs here. exhaustive-deps found a real
      // stale-closure bug in this codebase, so it's not decorative.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",

      "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true }],
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-var": "error",
      "prefer-const": "warn",
    },
  },

  // --- Playwright specs ---
  {
    files: ["frontend/e2e/**/*.js"],
    languageOptions: {
      sourceType: "module",
      globals: { ...globals.node, ...globals.browser },
    },
  },

  // --- Config files at the repo root ---
  {
    files: ["*.js", "frontend/vite.config.js", "frontend/playwright.config.js"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
];
