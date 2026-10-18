// The app stack, read for the checks (hosting.md, alerting.md).
import { readYaml, templateSchema } from "./repo.ts";

export const appStack = () => readYaml("infra/app.cfn.yml", templateSchema);

export function resourcesOf(type: string) {
  return Object.entries(appStack().Resources)
    .filter(([, resource]) => resource.Type === type)
    .map(([name, resource]) => ({
      name,
      properties: resource.Properties ?? {},
    }));
}

export function only(type: string) {
  const found = resourcesOf(type);
  if (found.length !== 1)
    throw new Error(`expected one ${type}, found ${String(found.length)}`);
  const [first] = found;
  if (first === undefined) throw new Error(`no ${type}`);
  return first.properties;
}
