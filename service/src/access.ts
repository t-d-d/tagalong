// Who may use a group (who-can-use-it.md): its owners and the members they named.
import type { Config, Group } from "./groups.ts";
import type { People } from "./people.ts";

export const isOwner = (
  config: Config,
  people: People,
  user: string,
): boolean => config.owners.some((owner) => people.sameUser(user, owner));

export const allowed = (
  config: Config,
  group: Group | undefined,
  people: People,
  user: string,
): boolean =>
  isOwner(config, people, user) ||
  (group?.members ?? []).some((member) => people.sameUser(user, member));
