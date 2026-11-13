import { Events, PermissionFlagsBits, type Client, type Message } from "discord.js";
import { enabledConfig, type ModuleConfig } from "../../settings.js";
import { createCase, isImmune, warn } from "./moderation.js";
import { guildT } from "../../i18n/index.js";
import { timeoutMember } from "../../core/actions.js";
import { recordEvent } from "./activity.js";
import { log } from "../../lib/log.js";

type Cfg = ModuleConfig<"automod">;
type Action = Cfg["badWords"]["action"];
export type RuleKey = "badWords" | "invites" | "links" | "mentions" | "caps" | "spam";

const inviteRe = /(discord\.gg|discord(?:app)?\.com\/invite)\/[\w-]+/i;
const linkRe = /https?:\/\/([^\s/]+)/gi;
const recent = new Map<string, number[]>();

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Returns [ruleName, action] for the first rule the message breaks, or null */
export function checkMessage(content: string, mentionCount: number, cfg: Cfg, spamKey?: string): [RuleKey, Action] | null {
  const lower = content.toLowerCase();
  if (cfg.badWords.enabled && cfg.badWords.words.length) {
    const hit = cfg.badWords.words.some((w) => {
      const word = w.toLowerCase().trim();
      // "*" wildcard support: "idiot*" matches "idioter"
      const re = new RegExp(`(^|\\W)${escapeRe(word).replace(/\\\*/g, "\\w*")}($|\\W)`, "i");
      return re.test(lower);
    });
    if (hit) return ["badWords", cfg.badWords.action];
  }
  if (cfg.invites.enabled && inviteRe.test(content)) return ["invites", cfg.invites.action];
  if (cfg.links.enabled) {
    const allowed = cfg.links.allowedDomains.map((d) => d.toLowerCase().replace(/^www\./, ""));
    for (const m of content.matchAll(linkRe)) {
      const host = m[1].toLowerCase().replace(/^www\./, "");
      if (!allowed.some((d) => host === d || host.endsWith(`.${d}`))) return ["links", cfg.links.action];
    }
  }
  if (cfg.mentions.enabled && mentionCount > cfg.mentions.max) return ["mentions", cfg.mentions.action];
  if (cfg.caps.enabled) {
    const letters = content.replace(/[^a-zåäöA-ZÅÄÖ]/g, "");
    if (letters.length >= cfg.caps.minLength) {
      const upper = letters.replace(/[^A-ZÅÄÖ]/g, "").length;
      if ((upper / letters.length) * 100 >= cfg.caps.percent) return ["caps", cfg.caps.action];
    }
  }
  if (cfg.spam.enabled && spamKey) {
    const now = Date.now();
    const list = (recent.get(spamKey) ?? []).filter((t) => now - t < cfg.spam.seconds * 1000);
    list.push(now);
    recent.set(spamKey, list);
    if (list.length > cfg.spam.messages) return ["spam", cfg.spam.action];
  }
  return null;
}

async function handle(msg: Message<true>) {
  const cfg = await enabledConfig(msg.guildId, "automod");
  if (!cfg || !msg.member) return;
  if (msg.member.permissions.has(PermissionFlagsBits.ManageMessages)) return;
  if (cfg.exemptChannelIds.includes(msg.channelId)) return;
  if (msg.member.roles.cache.some((r) => cfg.exemptRoleIds.includes(r.id))) return;
  if (await isImmune(msg.member)) return;

  const mentions = msg.mentions.users.size + msg.mentions.roles.size;
  const hit = checkMessage(msg.content, mentions, cfg, `${msg.guildId}|${msg.author.id}`);
  if (!hit) return;
  const [ruleKey, action] = hit;
  const tr = await guildT(msg.guild);
  const rule = tr(`automod.rules.${ruleKey}`);

  await msg.delete().catch(() => {});
  await recordEvent(msg.guildId, "automod", { userId: msg.author.id, channelId: msg.channelId, data: { rule: ruleKey, action } });
  if (msg.channel.isSendable()) {
    const notice = await msg.channel.send({ content: tr("automod.notice", { user: `${msg.author}`, rule }) }).catch(() => null);
    if (notice) setTimeout(() => void notice.delete().catch(() => {}), 6000);
  }
  const reason = tr("automod.reason", { rule });
  const me = msg.client.user;
  if (action === "delete_warn") await warn(msg.guild, msg.member, me, reason, "automod");
  else if (action === "delete_timeout" && msg.member.moderatable) {
    await timeoutMember(msg.member, cfg.timeoutMinutes * 60_000, { source: "automod", reason });
    await createCase(msg.guild, { user: msg.author, moderator: me, action: "timeout", reason, durationSeconds: cfg.timeoutMinutes * 60 });
  }
}

export function registerAutomod(client: Client) {
  client.on(Events.MessageCreate, (msg) => {
    if (!msg.inGuild() || msg.author.bot || msg.webhookId) return;
    handle(msg).catch((err) => log.warn({ err }, "automod failed"));
  });
  client.on(Events.MessageUpdate, (_old, msg) => {
    if (msg.partial || !msg.inGuild() || msg.author.bot) return;
    handle(msg).catch((err) => log.warn({ err }, "automod (edit) failed"));
  });
}
