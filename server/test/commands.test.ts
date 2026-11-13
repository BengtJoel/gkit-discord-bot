import { beforeAll, describe, expect, it } from "vitest";
import { Client, GatewayIntentBits } from "discord.js";
import { commands } from "../src/bot/registry.js";
import { registerLevels } from "../src/bot/modules/levels.js";
import { registerModeration } from "../src/bot/modules/moderation.js";
import { registerTempVoice } from "../src/bot/modules/tempVoice.js";

// Discord's rules for command and option names
const nameRe = /^[-_\p{L}\p{N}\p{sc=Deva}\p{sc=Thai}]{1,32}$/u;

type Opt = { name: string; description: string; name_localizations?: Record<string, string>; description_localizations?: Record<string, string>; options?: Opt[] };

function walk(opts: Opt[] | undefined, fn: (o: Opt) => void) {
  for (const o of opts ?? []) {
    fn(o);
    walk(o.options, fn);
  }
}

describe("slash commands", () => {
  beforeAll(() => {
    const client = new Client({ intents: [GatewayIntentBits.Guilds] }); // never logged in
    registerLevels(client);
    registerModeration();
    registerTempVoice(client);
  });

  it("registers the built-in commands with English names", () => {
    expect([...commands.keys()].sort()).toEqual(["ban", "cases", "kick", "leaderboard", "purge", "rank", "timeout", "unban", "voice", "warn"]);
  });

  it("every command and option has a real description and Swedish translations", () => {
    for (const c of commands.values()) {
      const all: Opt[] = [c.data as unknown as Opt];
      walk(c.data.options as unknown as Opt[], (o) => all.push(o));
      for (const o of all) {
        expect(o.name, c.data.name).toMatch(nameRe);
        expect(o.name).toBe(o.name.toLowerCase());
        expect(o.description.length, `${c.data.name}/${o.name}`).toBeGreaterThan(1);
        expect(o.description.length).toBeLessThanOrEqual(100);
        // descriptions were filled from locale keys, not left as the placeholder key name
        expect(o.description, `${c.data.name}/${o.name}`).not.toBe(o.name);
        expect(o.description_localizations?.["sv-SE"], `${c.data.name}/${o.name} sv`).toBeTruthy();
        if (o !== all[0]) {
          const sv = o.name_localizations?.["sv-SE"];
          expect(sv, `${c.data.name}/${o.name} sv name`).toBeTruthy();
          expect(sv).toMatch(nameRe);
          expect(sv).toBe(sv!.toLowerCase());
        }
      }
    }
  });

  it("stays well below Discord's 100 commands per server", () => {
    expect(commands.size).toBeLessThan(25);
  });
});
