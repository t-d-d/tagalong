// The upload link's Lambda entry point (LinkFunction in infra/app.cfn.yml).
// Lambda loads a .js file; Node 24 strips the types from the source it
// imports, so there is no build step (types-and-lint.md).
export { handler } from "./service/src/upload-link.ts";
