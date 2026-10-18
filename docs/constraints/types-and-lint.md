# Types and lint
Relevance: Compiler options, lint rules, a new boundary where data enters, a new dependency, or any cast or disabled rule: tsconfig*.json, eslint.config.js, service/src/env.ts, service/src/http.ts, service/src/aws.ts, schemas
Decision: Every strictness option is on, lint is type-aware with no warnings, outside data is parsed by a schema, and each outside system has one module.

Why: The compiler is the first reviewer, and an asserted type proves
nothing about what the bridge, claude.ai or a stored file sent.

## Rules

- strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes,
  noImplicitOverride, noImplicitReturns, noFallthroughCasesInSwitch,
  noUnusedLocals and noUnusedParameters are on, everywhere.
- No any, no non-null assertion, no @ts-ignore, no unsafe assertion.
- Everything from outside is parsed by a schema: the webhook's payload,
  the bridge's answers, the sessions API, the bridge's databases,
  groups.json, state.json, the stored login and the environment.
- The environment is read in service/src/env.ts only. Response bodies
  are read in service/src/http.ts only. AWS is reached from
  service/src/aws.ts only. The bridge's databases are opened in
  service/src/store.ts only.
- Types are inferred from schemas.
- No floating promises. Every switch is exhaustive.
- A lint rule is an error or off. Zero warnings.
- A disabled rule carries its reason on the same line.
- The service runs as TypeScript on Node 22 with type stripping. There
  is no build step.

## Do not

- Cast outside data to a type.
- Loosen an option for one folder, tests included.
- Disable a rule for a whole file.
- Add a bundler or a build step: the image runs the source.

History: Set when the repo was made, October 2026, following spotimy.
