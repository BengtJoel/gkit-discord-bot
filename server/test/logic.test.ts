import { describe, expect, it } from "vitest";
import { levelFromXp, totalXpForLevel, xpForNext } from "../src/bot/modules/levels.js";
import { checkMessage } from "../src/bot/modules/automod.js";
import { parseDuration, formatDuration } from "../src/bot/modules/moderation.js";
import { renderTemplate } from "../src/lib/template.js";
import { parseConfig } from "../src/settings.js";

describe("levels (MEE6 curve)", () => {
  it("matches MEE6's XP per level", () => {
    expect(xpForNext(0)).toBe(100);
    expect(xpForNext(1)).toBe(155);
    expect(levelFromXp(99).level).toBe(0);
    expect(levelFromXp(100).level).toBe(1);
    expect(levelFromXp(255).level).toBe(2);
  });
  it("round-trips level <-> total XP", () => {
    for (let l = 0; l <= 150; l++) {
      expect(levelFromXp(totalXpForLevel(l)).level).toBe(l);
      if (l > 0) expect(levelFromXp(totalXpForLevel(l) - 1).level).toBe(l - 1);
    }
  });
});

describe("automod", () => {
  const cfg = (patch: Record<string, unknown>) => parseConfig("automod", patch);

  it("matches banned words with wildcards, whole words only", () => {
    const c = cfg({ badWords: { enabled: true, words: ["idiot*", "fan"] } });
    expect(checkMessage("du är en idiot", 0, c)?.[0]).toBe("badWords");
    expect(checkMessage("IDIOTER överallt", 0, c)?.[0]).toBe("badWords");
    expect(checkMessage("fantastiskt", 0, c)).toBeNull();
  });
  it("blocks invites", () => {
    expect(checkMessage("join discord.gg/abc123", 0, cfg({ invites: { enabled: true } }))?.[0]).toBe("invites");
  });
  it("allows listed domains and their subdomains", () => {
    const c = cfg({ links: { enabled: true, allowedDomains: ["warcraftlogs.com"] } });
    expect(checkMessage("https://www.warcraftlogs.com/reports/x", 0, c)).toBeNull();
    expect(checkMessage("https://classic.warcraftlogs.com/x", 0, c)).toBeNull();
    expect(checkMessage("https://evil-warcraftlogs.com/x", 0, c)?.[0]).toBe("links");
  });
  it("counts mentions", () => {
    const c = cfg({ mentions: { enabled: true, max: 3 } });
    expect(checkMessage("hi", 3, c)).toBeNull();
    expect(checkMessage("hi", 4, c)?.[0]).toBe("mentions");
  });
  it("detects caps including åäö", () => {
    const c = cfg({ caps: { enabled: true, minLength: 5, percent: 70 } });
    expect(checkMessage("ÅÄÖ HÖR NI MIG", 0, c)?.[0]).toBe("caps");
    expect(checkMessage("Hej på er", 0, c)).toBeNull();
  });
  it("detects spam bursts per user", () => {
    const c = cfg({ spam: { enabled: true, messages: 3, seconds: 10 } });
    const key = `spam-test-${Math.random()}`;
    expect(checkMessage("a", 0, c, key)).toBeNull();
    expect(checkMessage("a", 0, c, key)).toBeNull();
    expect(checkMessage("a", 0, c, key)).toBeNull();
    expect(checkMessage("a", 0, c, key)?.[0]).toBe("spam");
  });
});

describe("durations", () => {
  it("parses", () => {
    expect(parseDuration("10m")).toBe(600);
    expect(parseDuration("2h")).toBe(7200);
    expect(parseDuration("1w2d")).toBe(604800 + 2 * 86400);
    expect(parseDuration("1d 12h")).toBe(86400 + 12 * 3600);
    expect(parseDuration("5")).toBe(300);
    expect(parseDuration("abc")).toBeNull();
    expect(parseDuration("10x")).toBeNull();
    expect(parseDuration("")).toBeNull();
  });
  it("formats", () => {
    expect(formatDuration(600)).toBe("10 min");
    expect(formatDuration(7200)).toBe("2 h");
    expect(formatDuration(86400 * 3)).toBe("3 d");
    expect(formatDuration(604800)).toBe("1 w");
  });
});

describe("templates", () => {
  it("renders MEE6-style and own variables, leaves unknown ones", () => {
    const user = { id: "1", username: "kalle", globalName: "Kalle" } as never;
    const guild = { name: "Ad Finem", memberCount: 42 } as never;
    expect(renderTemplate("Hej {user} på {server} ({server.member_count}) {nope}", { user, guild })).toBe("Hej <@1> på Ad Finem (42) {nope}");
    expect(renderTemplate("{level}", { extra: { level: 5 } })).toBe("5");
  });
});

describe("settings", () => {
  it("falls back to defaults for corrupt config", () => {
    expect(parseConfig("levels", { xpMin: "lots" }).xpMin).toBe(15);
  });
  it("leaves message templates empty so the localized default is used", () => {
    expect(parseConfig("levels", {}).announce.message).toBe("");
    expect(parseConfig("welcome", {}).join.message).toBe("");
  });
  it("defaults the server language to auto", () => {
    expect(parseConfig("general", {}).language).toBe("auto");
  });
});
