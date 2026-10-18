import js from "@eslint/js";
import comments from "@eslint-community/eslint-plugin-eslint-comments/configs";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

// Each outside system is reached from one module (types-and-lint.md).
const owned = [
  {
    name: "node:sqlite",
    message:
      "Only service/src/store.ts opens the WhatsApp databases (one-device.md).",
  },
  ...[
    "@aws-sdk/client-s3",
    "@aws-sdk/client-ssm",
    "@aws-sdk/s3-request-presigner",
  ].map((name) => ({
    name,
    message: "Reach AWS through service/src/aws.ts (types-and-lint.md).",
  })),
];

const otherLoggers = [
  "pino",
  "winston",
  "bunyan",
  "loglevel",
  "debug",
  "consola",
].map((name) => ({
  name,
  message: "Log through service/src/log.ts (logging.md).",
}));

const processImports = ["process", "node:process"].map((name) => ({
  name,
  importNames: ["env", "stdout", "stderr"],
  message:
    "Read the environment in service/src/env.ts, and log through service/src/log.ts.",
}));

// The service's modules may not read the environment, print, or read a body
// except in the module that owns each (types-and-lint.md, logging.md).
const boundaries = {
  "no-restricted-imports": [
    "error",
    { paths: [...owned, ...otherLoggers, ...processImports] },
  ],
  "no-console": "error",
  "no-restricted-properties": [
    "error",
    {
      object: "process",
      property: "env",
      message:
        "Read the environment in service/src/env.ts, through its schema (types-and-lint.md).",
    },
    {
      object: "process",
      property: "stdout",
      message: "Log through service/src/log.ts.",
    },
    {
      object: "process",
      property: "stderr",
      message: "Log through service/src/log.ts.",
    },
  ],
  "no-restricted-syntax": [
    "error",
    {
      selector:
        "CallExpression[callee.property.name=/^(json|text|formData|arrayBuffer|blob|bytes)$/]:not([callee.object.name='Response'])",
      message:
        "Read a response body in service/src/http.ts, through its schema (types-and-lint.md).",
    },
  ],
};

const allow = (rules) => ({
  "no-restricted-imports": [
    "error",
    {
      paths: [...owned, ...otherLoggers, ...processImports].filter(
        (path) => !rules.includes(path.name),
      ),
    },
  ],
});

export default defineConfig(
  globalIgnores(["**/dist/", "docs/", "coverage/"]),
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  comments.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: "error",
      reportUnusedInlineConfigs: "error",
    },
    rules: {
      "@typescript-eslint/ban-ts-comment": [
        "error",
        {
          "ts-expect-error": "allow-with-description",
          "ts-ignore": true,
          "ts-nocheck": true,
        },
      ],
      "@typescript-eslint/no-unsafe-type-assertion": "error",
      "@typescript-eslint/switch-exhaustiveness-check": [
        "error",
        {
          considerDefaultExhaustiveForUnions: false,
          requireDefaultForNonUnion: true,
        },
      ],
      "@eslint-community/eslint-comments/require-description": "error",
      "@eslint-community/eslint-comments/no-unlimited-disable": "error",
      "@eslint-community/eslint-comments/disable-enable-pair": [
        "error",
        { allowWholeFile: false },
      ],
    },
  },
  {
    files: ["service/src/**/*.ts"],
    ignores: ["service/src/**/*.test.ts", "service/src/**/*.int.ts"],
    rules: boundaries,
  },
  {
    files: ["service/src/store.ts"],
    rules: allow(["node:sqlite"]),
  },
  {
    files: ["service/src/aws.ts"],
    rules: allow([
      "@aws-sdk/client-s3",
      "@aws-sdk/client-ssm",
      "@aws-sdk/s3-request-presigner",
    ]),
  },
  {
    files: ["**/*.js"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
);
