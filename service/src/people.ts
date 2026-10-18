// Who a message is from (who-can-use-it.md). One person can appear as a phone
// number or a LID; they are matched on either, never on a name.
import type { WhatsAppStore } from "./store.ts";

export const userPart = (jid: string): string =>
  jid.split("@")[0]?.split(":")[0] ?? "";

export class People {
  readonly #store: WhatsAppStore;
  #names = new Map<string, string>();
  #lidToPn = new Map<string, string>();
  #pnToLid = new Map<string, string>();
  #self = new Set<string>();

  constructor(store: WhatsAppStore) {
    this.#store = store;
  }

  /** Read the device, contacts and LID map again. False while there is no device. */
  refresh(): boolean {
    if (!this.#store.present()) return false;
    const device = this.#store.device();
    const self = new Set(
      [device?.jid, device?.lid].filter((jid) => jid != null).map(userPart),
    );
    const names = new Map<string, string>();
    for (const { jid, name } of this.#store.contacts()) {
      names.set(userPart(jid), name.split(/\s+/u)[0] ?? name);
    }
    const lidToPn = new Map<string, string>();
    const pnToLid = new Map<string, string>();
    for (const { lid, pn } of this.#store.lidMap()) {
      lidToPn.set(userPart(lid), userPart(pn));
      pnToLid.set(userPart(pn), userPart(lid));
      const name = names.get(userPart(pn));
      if (name !== undefined && !names.has(userPart(lid)))
        names.set(userPart(lid), name);
    }
    for (const id of self) names.set(id, "Claude");
    this.#names = names;
    this.#lidToPn = lidToPn;
    this.#pnToLid = pnToLid;
    this.#self = self;
    return true;
  }

  /** Claude's own phone number and LID. */
  get self(): ReadonlySet<string> {
    return this.#self;
  }

  aliasesOf(user: string): string[] {
    const id = userPart(user);
    return [id, this.#lidToPn.get(id), this.#pnToLid.get(id)].filter(
      (alias) => alias !== undefined,
    );
  }

  sameUser(a: string, b: string): boolean {
    const ours = this.aliasesOf(a);
    return this.aliasesOf(b).some((alias) => ours.includes(alias));
  }

  /** A person's phone number where we know it, else what we have. */
  canonical(user: string): string {
    const id = userPart(user);
    return this.#lidToPn.get(id) ?? id;
  }

  nameOf(user: string): string {
    return this.#names.get(userPart(user)) ?? `+${userPart(user)}`;
  }

  toJid(user: string): string {
    if (user.includes("@")) return user;
    return `${user}@${this.#lidToPn.has(user) ? "lid" : "s.whatsapp.net"}`;
  }

  /** WhatsApp writes a mention as "@<number>"; show the name instead. */
  readable(text: string): string {
    return text.replace(/@(\d{6,})/gu, (match, id: string) => {
      const name = this.#names.get(id);
      return name === undefined ? match : `@${name}`;
    });
  }
}
