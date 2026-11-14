import { describe, expect, it } from "vitest";
import { ruleSchema, type Condition } from "../src/automations/types.js";
import { emojiKey, evaluateCondition, evaluateConditions, markCause, takeCause, triggerMatches, type Facts, type TriggerContext } from "../src/automations/engine.js";
import { planRoleChange } from "../src/bot/modules/reactionRoles.js";

const ROLE_A = "100000000000000001";
const ROLE_B = "100000000000000002";
const ROLE_C = "100000000000000003";
const CH = "200000000000000001";
const CAT = "200000000000000099";

/** Minimal stand-ins for discord.js objects — only what conditions read */
function fakeCtx(opts: { roles?: string[]; content?: string; channelId?: string; joinedDaysAgo?: number; accountDaysAgo?: number; values?: string[]; level?: number } = {}): TriggerContext {
  const roles = new Set(opts.roles ?? []);
  const guild = {
    id: "300000000000000001",
    channels: { cache: new Map([[CH, { parentId: CAT }]]) },
    roles: { cache: new Map() },
  };
  const member = {
    id: "400000000000000001",
    roles: { cache: { has: (id: string) => roles.has(id) } },
    joinedTimestamp: Date.now() - (opts.joinedDaysAgo ?? 0) * 86400_000,
    user: { createdTimestamp: Date.now() - (opts.accountDaysAgo ?? 0) * 86400_000 },
  };
  return {
    guild: guild as never,
    member: member as never,
    userId: member.id,
    channelId: opts.channelId ?? CH,
    message: { content: opts.content ?? "" } as never,
    values: opts.values,
    level: opts.level ?? null,
  };
}
const facts = (level = 0, counters: Record<string, number> = {}): Facts => ({
  level: async () => level,
  counter: async (_g, _u, key) => counters[key] ?? 0,
});
const cond = (c: unknown) => c as Condition;

describe("rule schema", () => {
  it("accepts a typical verification rule with defaults filled in", () => {
    const r = ruleSchema.parse({
      name: "Verify",
      trigger: { type: "button_clicked", key: "verify" },
      actions: [{ type: "add_roles", roleIds: [ROLE_A] }, { type: "reply", content: "Welcome!" }],
    });
    expect(r.match).toBe("all");
    expect(r.enabled).toBe(true);
    expect(r.actions[1]).toMatchObject({ type: "reply", private: true });
  });
  it("rejects bad keys, empty action lists and unknown types", () => {
    expect(ruleSchema.safeParse({ trigger: { type: "button_clicked", key: "has space" }, actions: [{ type: "delete_message" }] }).success).toBe(false);
    expect(ruleSchema.safeParse({ trigger: { type: "member_joined" }, actions: [] }).success).toBe(false);
    expect(ruleSchema.safeParse({ trigger: { type: "nope" }, actions: [{ type: "delete_message" }] }).success).toBe(false);
  });
  it("caps wait at 30 days and temp roles at 90 days", () => {
    expect(ruleSchema.safeParse({ trigger: { type: "member_joined" }, actions: [{ type: "wait", minutes: 60 * 24 * 31 }] }).success).toBe(false);
    expect(ruleSchema.safeParse({ trigger: { type: "member_joined" }, actions: [{ type: "temp_role", roleIds: [ROLE_A], minutes: 60 * 24 * 91 }] }).success).toBe(false);
  });
});

describe("trigger matching", () => {
  it("filters by role, channel or category, key, level, emoji", () => {
    expect(triggerMatches({ type: "role_added", roleIds: [ROLE_A] }, "role_added", { roleId: ROLE_A })).toBe(true);
    expect(triggerMatches({ type: "role_added", roleIds: [ROLE_A] }, "role_added", { roleId: ROLE_B })).toBe(false);
    expect(triggerMatches({ type: "role_added", roleIds: [] }, "role_added", { roleId: ROLE_B })).toBe(true);
    expect(triggerMatches({ type: "role_added", roleIds: [] }, "role_removed", { roleId: ROLE_B })).toBe(false);
    expect(triggerMatches({ type: "message_sent", channelIds: [CAT] }, "message_sent", { channelId: CH, parentId: CAT })).toBe(true);
    expect(triggerMatches({ type: "button_clicked", key: "Verify" }, "button_clicked", { key: "verify" })).toBe(true);
    expect(triggerMatches({ type: "level_reached", level: 10 }, "level_reached", { level: 9 })).toBe(false);
    expect(triggerMatches({ type: "level_reached", level: null }, "level_reached", { level: 9 })).toBe(true);
    expect(triggerMatches({ type: "reaction_added", messageId: null, emoji: "<:raid:123456789012345678>" }, "reaction_added", { emoji: "<a:raid:123456789012345678>" })).toBe(true);
    expect(emojiKey("✅")).toBe("✅");
  });
});

describe("conditions", () => {
  it("roles: any / all / lacks", async () => {
    const ctx = fakeCtx({ roles: [ROLE_A] });
    expect(await evaluateCondition(cond({ type: "has_role", roleIds: [ROLE_A, ROLE_B], mode: "any" }), ctx, facts())).toBe(true);
    expect(await evaluateCondition(cond({ type: "has_role", roleIds: [ROLE_A, ROLE_B], mode: "all" }), ctx, facts())).toBe(false);
    expect(await evaluateCondition(cond({ type: "lacks_role", roleIds: [ROLE_B] }), ctx, facts())).toBe(true);
  });
  it("channel matches the channel or its category", async () => {
    expect(await evaluateCondition(cond({ type: "in_channel", channelIds: [CAT] }), fakeCtx(), facts())).toBe(true);
    expect(await evaluateCondition(cond({ type: "in_channel", channelIds: [ROLE_C] }), fakeCtx(), facts())).toBe(false);
  });
  it("message words respect whole words and åäö", async () => {
    const c = cond({ type: "message_contains", words: ["ansök"], mode: "any", wholeWord: true });
    expect(await evaluateCondition(c, fakeCtx({ content: "Jag vill ansök om plats" }), facts())).toBe(true);
    expect(await evaluateCondition(c, fakeCtx({ content: "ansökan skickad" }), facts())).toBe(false);
    expect(await evaluateCondition(cond({ ...c, wholeWord: false }), fakeCtx({ content: "ansökan skickad" }), facts())).toBe(true);
  });
  it("regex never throws on a bad pattern", async () => {
    expect(await evaluateCondition(cond({ type: "message_regex", pattern: "(" }), fakeCtx({ content: "x" }), facts())).toBe(false);
    expect(await evaluateCondition(cond({ type: "message_regex", pattern: "^!apply" }), fakeCtx({ content: "!Apply now" }), facts())).toBe(true);
  });
  it("level, membership age, account age, counters, selection", async () => {
    expect(await evaluateCondition(cond({ type: "level", op: "gte", value: 10 }), fakeCtx(), facts(12))).toBe(true);
    expect(await evaluateCondition(cond({ type: "level", op: "gte", value: 10 }), fakeCtx({ level: 5 }), facts(12))).toBe(false); // trigger's level wins
    expect(await evaluateCondition(cond({ type: "member_days", op: "gte", value: 14 }), fakeCtx({ joinedDaysAgo: 15 }), facts())).toBe(true);
    expect(await evaluateCondition(cond({ type: "account_days", op: "lte", value: 7 }), fakeCtx({ accountDaysAgo: 2 }), facts())).toBe(true);
    expect(await evaluateCondition(cond({ type: "counter", key: "strikes", op: "gte", value: 3 }), fakeCtx(), facts(0, { strikes: 3 }))).toBe(true);
    expect(await evaluateCondition(cond({ type: "selected", values: ["tank"] }), fakeCtx({ values: ["healer", "tank"] }), facts())).toBe(true);
  });
  it("all / any matching", async () => {
    const conditions = [cond({ type: "has_role", roleIds: [ROLE_A], mode: "any" }), cond({ type: "has_role", roleIds: [ROLE_B], mode: "any" })];
    const ctx = fakeCtx({ roles: [ROLE_A] });
    expect((await evaluateConditions({ conditions, match: "all" }, ctx, facts())).pass).toBe(false);
    expect((await evaluateConditions({ conditions, match: "any" }, ctx, facts())).pass).toBe(true);
    expect((await evaluateConditions({ conditions: [], match: "all" }, ctx, facts())).pass).toBe(true);
  });
});

describe("loop guard", () => {
  it("passes the depth of a rule-made role change to the event it causes, once", () => {
    markCause("g", "u", ROLE_A, "added", 2);
    expect(takeCause("g", "u", ROLE_A, "added")).toBe(2);
    expect(takeCause("g", "u", ROLE_A, "added")).toBe(0);
    expect(takeCause("g", "u", ROLE_A, "removed")).toBe(0);
  });
});

describe("reaction role buttons and menus", () => {
  const roles = [ROLE_A, ROLE_B, ROLE_C];
  const has = (...ids: string[]) => (id: string) => ids.includes(id);
  it("button toggles in normal mode", () => {
    expect(planRoleChange("normal", roles, has(), [ROLE_A], "button")).toEqual({ add: [ROLE_A], remove: [] });
    expect(planRoleChange("normal", roles, has(ROLE_A), [ROLE_A], "button")).toEqual({ add: [], remove: [ROLE_A] });
  });
  it("unique swaps, verify never removes", () => {
    expect(planRoleChange("unique", roles, has(ROLE_B), [ROLE_A], "button")).toEqual({ add: [ROLE_A], remove: [ROLE_B] });
    expect(planRoleChange("verify", roles, has(ROLE_A), [ROLE_A], "button")).toEqual({ add: [], remove: [] });
  });
  it("menu sets exactly the picked roles", () => {
    expect(planRoleChange("normal", roles, has(ROLE_A, ROLE_B), [ROLE_B, ROLE_C], "select")).toEqual({ add: [ROLE_C], remove: [ROLE_A] });
    expect(planRoleChange("unique", roles, has(ROLE_A), [ROLE_B, ROLE_C], "select")).toEqual({ add: [ROLE_B], remove: [ROLE_A] });
    expect(planRoleChange("verify", roles, has(ROLE_A), [], "select")).toEqual({ add: [], remove: [] });
  });
});
