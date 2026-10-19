// Who may ask a Claude in a chat (who-can-use-it.md): the owners, and the
// people an owner allowed for that Claude in that chat.
import { type Config, type Group, membersOf, openTo } from "./groups.ts";
import type { People } from "./people.ts";

export const isOwner = (
  config: Config,
  people: People,
  user: string,
): boolean => config.owners.some((owner) => people.sameUser(user, owner));

export const allowed = (
  config: Config,
  group: Group | undefined,
  claude: string,
  people: People,
  user: string,
): boolean =>
  isOwner(config, people, user) ||
  (group !== undefined &&
    (openTo(config, group, claude) ||
      membersOf(group, claude).some((member) =>
        people.sameUser(user, member),
      )));
