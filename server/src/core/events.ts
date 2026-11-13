import { EventEmitter } from "node:events";
import { Events, type Client, type GuildMember, type PartialGuildMember, type Role } from "discord.js";
import { log } from "../lib/log.js";

/**
 * Internal event bus. Discord gateway events are translated into higher-level events here
 * (a role added, a nickname changed, a level reached) so modules — and later the automation
 * engine — can subscribe to exactly what they need instead of diffing raw member updates.
 */
export interface BotEvents {
  "member.roleAdded": [member: GuildMember, role: Role];
  "member.roleRemoved": [member: GuildMember, role: Role];
  "member.nicknameChanged": [member: GuildMember, before: string | null, after: string | null];
  "member.timeoutChanged": [member: GuildMember, until: Date | null];
  "level.reached": [member: GuildMember, level: number, previous: number];
}

class TypedBus {
  private ee = new EventEmitter();
  constructor() {
    this.ee.setMaxListeners(50);
  }
  on<K extends keyof BotEvents>(event: K, fn: (...args: BotEvents[K]) => unknown) {
    this.ee.on(event, (...args: unknown[]) => {
      try {
        const r = fn(...(args as BotEvents[K]));
        if (r instanceof Promise) r.catch((err) => log.warn({ err, event }, "event handler failed"));
      } catch (err) {
        log.warn({ err, event }, "event handler failed");
      }
    });
  }
  emit<K extends keyof BotEvents>(event: K, ...args: BotEvents[K]) {
    this.ee.emit(event, ...args);
  }
}

export const bus = new TypedBus();

/** Translate raw guildMemberUpdate into fine-grained bus events */
export function diffMember(oldM: GuildMember | PartialGuildMember, newM: GuildMember) {
  if (!oldM.partial) {
    for (const role of newM.roles.cache.values()) if (!oldM.roles.cache.has(role.id)) bus.emit("member.roleAdded", newM, role);
    for (const role of oldM.roles.cache.values()) if (!newM.roles.cache.has(role.id)) bus.emit("member.roleRemoved", newM, role);
    if (oldM.nickname !== newM.nickname) bus.emit("member.nicknameChanged", newM, oldM.nickname, newM.nickname);
  }
  const before = oldM.communicationDisabledUntilTimestamp ?? null;
  const after = newM.communicationDisabledUntilTimestamp ?? null;
  const active = (ts: number | null) => (ts && ts > Date.now() ? ts : null);
  if (active(before) !== active(after)) bus.emit("member.timeoutChanged", newM, active(after) ? new Date(after!) : null);
}

export function registerGateway(client: Client) {
  client.on(Events.GuildMemberUpdate, (oldM, newM) => diffMember(oldM, newM));
}
