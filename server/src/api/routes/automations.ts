import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, asc, desc, eq } from "drizzle-orm";
import type { Message } from "discord.js";
import { db, schema } from "../../db/index.js";
import { client } from "../../bot/client.js";
import { requireGuildAccess } from "../auth.js";
import { apiError } from "../errors.js";
import { audit, discordGuild, type GP } from "./guild.js";
import { actionSchema, ruleSchema, type RuleInput } from "../../automations/types.js";
import { buildMessage, dbFacts, evaluateConditions, rowToRule } from "../../automations/engine.js";
import { sendToChannel } from "../../core/actions.js";
import { onRulesChanged } from "../../automations/wire.js";
import { previewCron } from "../../bot/modules/timers.js";
import { checkRoles } from "../../core/actions.js";

type IdP = { Params: { guildId: string; id: string } };

/** Checks zod can't do: cron syntax, regex syntax */
function extraValidation(rule: RuleInput): { code: string; params?: Record<string, string> } | null {
  if (rule.trigger.type === "schedule") {
    try {
      previewCron(rule.trigger.cron, rule.trigger.timezone);
    } catch (err) {
      return { code: "errors.invalidSchedule", params: { detail: (err as Error).message } };
    }
  }
  for (const c of rule.conditions) {
    if (c.type === "message_regex") {
      try {
        new RegExp(c.pattern, "i");
      } catch (err) {
        return { code: "errors.invalidRegex", params: { detail: (err as Error).message } };
      }
    }
  }
  return null;
}

function toRow(guildId: string, rule: RuleInput) {
  return {
    guildId,
    name: rule.name,
    enabled: rule.enabled,
    trigger: rule.trigger,
    conditions: rule.conditions,
    match: rule.match,
    actions: rule.actions,
    cooldownSeconds: rule.cooldownSeconds,
    updatedAt: new Date(),
  };
}

export function registerAutomationRoutes(app: FastifyInstance) {
  app.register(async (r) => {
    r.addHook("preHandler", requireGuildAccess);

    r.get<GP>("/api/guilds/:guildId/automations", async (req) =>
      db.select().from(schema.automations).where(eq(schema.automations.guildId, req.params.guildId)).orderBy(asc(schema.automations.id)),
    );

    r.post<GP>("/api/guilds/:guildId/automations", async (req, reply) => {
      const rule = ruleSchema.parse(req.body);
      const bad = extraValidation(rule);
      if (bad) return apiError(reply, 400, bad.code, bad.params);
      const [row] = await db.insert(schema.automations).values(toRow(req.params.guildId, rule)).returning();
      onRulesChanged(req.params.guildId, client, rowToRule(row));
      await audit(req.params.guildId, req.session!.userId, "automations.create", { id: row.id, name: row.name });
      return row;
    });

    r.put<IdP>("/api/guilds/:guildId/automations/:id", async (req, reply) => {
      const rule = ruleSchema.parse(req.body);
      const bad = extraValidation(rule);
      if (bad) return apiError(reply, 400, bad.code, bad.params);
      const t = schema.automations;
      const [row] = await db
        .update(t)
        .set(toRow(req.params.guildId, rule))
        .where(and(eq(t.id, Number(req.params.id)), eq(t.guildId, req.params.guildId)))
        .returning();
      if (!row) return apiError(reply, 404, "errors.notFound");
      onRulesChanged(req.params.guildId, client, rowToRule(row));
      await audit(req.params.guildId, req.session!.userId, "automations.update", { id: row.id, name: row.name, enabled: row.enabled });
      return row;
    });

    r.delete<IdP>("/api/guilds/:guildId/automations/:id", async (req) => {
      const t = schema.automations;
      await db.delete(t).where(and(eq(t.id, Number(req.params.id)), eq(t.guildId, req.params.guildId)));
      onRulesChanged(req.params.guildId, client, null, Number(req.params.id));
      await audit(req.params.guildId, req.session!.userId, "automations.delete", { id: req.params.id });
      return { ok: true };
    });

    r.get<GP & { Querystring: { automationId?: string; status?: string } }>("/api/guilds/:guildId/automation-runs", async (req) => {
      const t = schema.automationRuns;
      const conds = [eq(t.guildId, req.params.guildId)];
      if (req.query.automationId) conds.push(eq(t.automationId, Number(req.query.automationId)));
      if (req.query.status) conds.push(eq(t.status, req.query.status));
      return db.select().from(t).where(and(...conds)).orderBy(desc(t.createdAt)).limit(100);
    });

    /** Posts a message with buttons/a menu right away — the "panel" that button/menu rules react to */
    r.post<GP>("/api/guilds/:guildId/automations/panel", async (req, reply) => {
      const action = actionSchema.parse({ ...(req.body as object), type: "send_message" });
      if (action.type !== "send_message" || !action.channelId) return apiError(reply, 400, "errors.invalidValues");
      const guild = discordGuild(req.params.guildId);
      if (!guild) return apiError(reply, 404, "errors.botNotInGuild");
      const msg = await sendToChannel(guild, action.channelId, await buildMessage(action, { guild }), { source: "automations:panel" });
      if (!msg) return apiError(reply, 400, "errors.botCannotWrite");
      await audit(req.params.guildId, req.session!.userId, "automations.panel", { channelId: action.channelId });
      return { messageId: msg.id, url: msg.url };
    });

    /**
     * "Would this rule run for this member?" — evaluates the conditions against a real member
     * without doing anything, and flags actions that will fail (e.g. a role above the bot).
     */
    r.post<GP>("/api/guilds/:guildId/automations/simulate", async (req, reply) => {
      const body = z
        .object({
          rule: ruleSchema,
          userId: z.string().regex(/^\d{15,22}$/, "errors.invalidId"),
          channelId: z.string().regex(/^\d{15,22}$/).nullable().default(null),
          content: z.string().max(2000).default(""),
          values: z.array(z.string()).default([]),
        })
        .parse(req.body);
      const guild = discordGuild(req.params.guildId);
      if (!guild) return apiError(reply, 404, "errors.botNotInGuild");
      const member = await guild.members.fetch(body.userId).catch(() => null);
      if (!member) return apiError(reply, 404, "errors.memberNotFound");
      const ctx = {
        guild,
        member,
        userId: member.id,
        channelId: body.channelId,
        message: { content: body.content } as unknown as Message,
        values: body.values,
      };
      const cond = await evaluateConditions(body.rule, ctx, dbFacts);
      const warnings: { index: number; code: string; params?: Record<string, string> }[] = [];
      body.rule.actions.forEach((a, index) => {
        if ("roleIds" in a) for (const b of checkRoles(guild, a.roleIds).blocked) warnings.push({ index, code: b.code, params: b.params });
        if (a.type === "roles_from_select") for (const b of checkRoles(guild, a.mapping.map((m) => m.roleId)).blocked) warnings.push({ index, code: b.code, params: b.params });
      });
      return { pass: cond.pass, conditions: cond.results, warnings };
    });
  });
}
