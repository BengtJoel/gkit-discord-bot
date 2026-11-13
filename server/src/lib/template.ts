import type { Guild, GuildMember, PartialGuildMember, User } from "discord.js";

export interface TemplateContext {
  user?: User | null;
  member?: GuildMember | PartialGuildMember | null;
  guild?: Guild | null;
  extra?: Record<string, string | number>;
}

/**
 * Variables (same names as MEE6 where possible so imported texts keep working):
 * {user} mention, {username}, {displayname}, {userid}, {server}, {membercount}, + any extra like {level}
 * MEE6 style {user.mention} / {user.name} / {server.name} are accepted too.
 */
export function renderTemplate(text: string, ctx: TemplateContext): string {
  const user = ctx.user ?? ctx.member?.user ?? null;
  const vars: Record<string, string> = {
    user: user ? `<@${user.id}>` : "",
    "user.mention": user ? `<@${user.id}>` : "",
    username: user?.username ?? "",
    "user.name": user?.username ?? "",
    displayname: ctx.member?.displayName ?? user?.globalName ?? user?.username ?? "",
    userid: user?.id ?? "",
    "user.id": user?.id ?? "",
    server: ctx.guild?.name ?? "",
    "server.name": ctx.guild?.name ?? "",
    membercount: String(ctx.guild?.memberCount ?? ""),
    "server.member_count": String(ctx.guild?.memberCount ?? ""),
  };
  for (const [k, v] of Object.entries(ctx.extra ?? {})) vars[k] = String(v);
  return text.replace(/\{([a-z_.]+)\}/gi, (m, name: string) => vars[name.toLowerCase()] ?? m);
}

/** Stockholm-local calendar day as YYYY-MM-DD (used for activity rollups) */
export function dayKey(d = new Date()): string {
  return d.toLocaleDateString("sv-SE", { timeZone: "Europe/Stockholm" });
}
