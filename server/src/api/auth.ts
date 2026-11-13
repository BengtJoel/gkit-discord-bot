import crypto from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { eq, lt } from "drizzle-orm";
import { PermissionFlagsBits, PermissionsBitField } from "discord.js";
import { db, schema } from "../db/index.js";
import { env, ownerIds, botEnabled } from "../env.js";
import { client } from "../bot/client.js";
import { apiError, ApiError } from "./errors.js";

const DISCORD = "https://discord.com/api/v10";
const COOKIE = "gb_sid";
const redirectUri = () => `${env.PUBLIC_URL.replace(/\/$/, "")}/api/auth/callback`;

export type Session = typeof schema.sessions.$inferSelect;
declare module "fastify" {
  interface FastifyRequest {
    session?: Session;
  }
}

export const botPermissions = new PermissionsBitField([
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.AddReactions,
  PermissionFlagsBits.UseExternalEmojis,
  PermissionFlagsBits.ManageMessages,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.ModerateMembers,
  PermissionFlagsBits.MoveMembers,
  PermissionFlagsBits.Connect,
  PermissionFlagsBits.ViewAuditLog,
  PermissionFlagsBits.ChangeNickname,
]).bitfield;

export function inviteUrl(guildId?: string) {
  const p = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID,
    scope: "bot applications.commands",
    permissions: botPermissions.toString(),
  });
  if (guildId) {
    p.set("guild_id", guildId);
    p.set("disable_guild_select", "true");
  }
  return `https://discord.com/oauth2/authorize?${p}`;
}

interface DiscordGuild {
  id: string;
  name: string;
  icon: string | null;
  owner: boolean;
  permissions: string;
}

/** User guild list is cached per session for 60s to stay well within Discord's rate limits */
const guildCache = new Map<string, { at: number; guilds: DiscordGuild[] }>();

export async function userGuilds(s: Session): Promise<DiscordGuild[]> {
  const hit = guildCache.get(s.id);
  if (hit && Date.now() - hit.at < 60_000) return hit.guilds;
  const res = await fetch(`${DISCORD}/users/@me/guilds`, { headers: { Authorization: `Bearer ${s.accessToken}` } });
  if (res.status === 429 && hit) return hit.guilds;
  if (!res.ok) throw new ApiError(res.status === 401 ? 401 : 502, "errors.discordGuilds");
  const guilds = (await res.json()) as DiscordGuild[];
  guildCache.set(s.id, { at: Date.now(), guilds });
  return guilds;
}

export function canManage(g: DiscordGuild) {
  const perms = BigInt(g.permissions);
  return g.owner || (perms & PermissionFlagsBits.ManageGuild) !== 0n || (perms & PermissionFlagsBits.Administrator) !== 0n;
}

/** Guilds the dashboard user may manage, annotated with whether the bot is present */
export async function manageableGuilds(s: Session) {
  const list = await userGuilds(s);
  return list
    .filter((g) => canManage(g) || ownerIds.has(s.userId))
    .map((g) => ({
      id: g.id,
      name: g.name,
      icon: g.icon,
      botPresent: botEnabled ? client.guilds.cache.has(g.id) : true,
    }))
    .sort((a, b) => Number(b.botPresent) - Number(a.botPresent) || a.name.localeCompare(b.name, "sv"));
}

export async function requireSession(req: FastifyRequest, reply: FastifyReply) {
  const raw = req.cookies[COOKIE];
  const unsigned = raw ? req.unsignCookie(raw) : null;
  if (!unsigned?.valid || !unsigned.value) return apiError(reply, 401, "errors.notLoggedIn");
  const [s] = await db.select().from(schema.sessions).where(eq(schema.sessions.id, unsigned.value));
  if (!s || s.expiresAt < new Date()) return apiError(reply, 401, "errors.sessionExpired");
  req.session = s;
}

/** Guard for /api/guilds/:guildId/* */
export async function requireGuildAccess(req: FastifyRequest<{ Params: { guildId: string } }>, reply: FastifyReply) {
  await requireSession(req, reply);
  if (reply.sent) return;
  const s = req.session!;
  const { guildId } = req.params;
  if (botEnabled && !client.guilds.cache.has(guildId)) return apiError(reply, 404, "errors.botNotInGuild", undefined, { inviteUrl: inviteUrl(guildId) });
  if (ownerIds.has(s.userId)) return;
  const guilds = await userGuilds(s);
  const g = guilds.find((x) => x.id === guildId);
  if (!g || !canManage(g)) return apiError(reply, 403, "errors.needManageGuild");
}

export function registerAuth(app: FastifyInstance) {
  app.get("/api/auth/login", async (req, reply) => {
    const state = crypto.randomBytes(16).toString("hex");
    reply.setCookie("gb_state", state, { path: "/", httpOnly: true, sameSite: "lax", maxAge: 600, signed: true, secure: env.PUBLIC_URL.startsWith("https") });
    const p = new URLSearchParams({
      client_id: env.DISCORD_CLIENT_ID,
      redirect_uri: redirectUri(),
      response_type: "code",
      scope: "identify guilds",
      state,
      prompt: "none",
    });
    return reply.redirect(`https://discord.com/oauth2/authorize?${p}`);
  });

  app.get<{ Querystring: { code?: string; state?: string } }>("/api/auth/callback", async (req, reply) => {
    const { code, state } = req.query;
    const stateCookie = req.cookies.gb_state ? req.unsignCookie(req.cookies.gb_state) : null;
    if (!code || !state || !stateCookie?.valid || stateCookie.value !== state) return reply.redirect("/?login_error=1");
    reply.clearCookie("gb_state", { path: "/" });

    const tokenRes = await fetch(`${DISCORD}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.DISCORD_CLIENT_ID,
        client_secret: env.DISCORD_CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri(),
      }),
    });
    if (!tokenRes.ok) return reply.redirect("/?login_error=1");
    const token = (await tokenRes.json()) as { access_token: string; expires_in: number };
    const meRes = await fetch(`${DISCORD}/users/@me`, { headers: { Authorization: `Bearer ${token.access_token}` } });
    const me = (await meRes.json()) as { id: string; username: string; global_name?: string; avatar: string | null };

    const id = crypto.randomBytes(32).toString("hex");
    await db.delete(schema.sessions).where(lt(schema.sessions.expiresAt, new Date()));
    await db.insert(schema.sessions).values({
      id,
      userId: me.id,
      username: me.global_name || me.username,
      avatar: me.avatar,
      accessToken: token.access_token,
      expiresAt: new Date(Date.now() + Math.min(token.expires_in, 7 * 86400) * 1000),
    });
    reply.setCookie(COOKIE, id, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: env.PUBLIC_URL.startsWith("https"),
      signed: true,
      maxAge: 7 * 86400,
    });
    return reply.redirect("/");
  });

  app.post("/api/auth/logout", async (req, reply) => {
    const raw = req.cookies[COOKIE];
    const u = raw ? req.unsignCookie(raw) : null;
    if (u?.valid && u.value) {
      await db.delete(schema.sessions).where(eq(schema.sessions.id, u.value));
      guildCache.delete(u.value);
    }
    reply.clearCookie(COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/api/me", { preHandler: requireSession }, async (req) => {
    const s = req.session!;
    return {
      user: { id: s.userId, username: s.username, avatar: s.avatar },
      guilds: await manageableGuilds(s),
      inviteUrl: inviteUrl(),
    };
  });
}
