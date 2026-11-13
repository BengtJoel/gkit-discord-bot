export interface Me {
  user: { id: string; username: string; avatar: string | null };
  guilds: { id: string; name: string; icon: string | null; botPresent: boolean }[];
  inviteUrl: string;
}

export interface Channel {
  id: string;
  name: string;
  type: "text" | "voice" | "category" | "forum";
  parentId: string | null;
  position: number;
}
export interface Role {
  id: string;
  name: string;
  color: string;
  managed: boolean;
  assignable: boolean;
}
export interface Emoji {
  id: string;
  name: string;
  animated: boolean;
  tag: string;
}

export type AutomodAction = "delete" | "delete_warn" | "delete_timeout";

export interface ModuleConfigs {
  levels: {
    xpMin: number;
    xpMax: number;
    cooldownSeconds: number;
    multiplier: number;
    announce: { mode: "current" | "channel" | "dm" | "off"; channelId: string | null; message: string };
    noXpChannelIds: string[];
    noXpRoleIds: string[];
    roleRewards: { level: number; roleId: string }[];
    stackRewards: boolean;
  };
  welcome: {
    join: { enabled: boolean; channelId: string | null; message: string };
    dm: { enabled: boolean; message: string };
    leave: { enabled: boolean; channelId: string | null; message: string };
    autoRoleIds: string[];
  };
  moderation: {
    logChannelId: string | null;
    dmOnAction: boolean;
    warnThresholds: { count: number; action: "timeout" | "kick" | "ban"; durationMinutes: number }[];
  };
  automod: {
    exemptRoleIds: string[];
    exemptChannelIds: string[];
    timeoutMinutes: number;
    badWords: { enabled: boolean; words: string[]; action: AutomodAction };
    invites: { enabled: boolean; action: AutomodAction };
    links: { enabled: boolean; allowedDomains: string[]; action: AutomodAction };
    mentions: { enabled: boolean; max: number; action: AutomodAction };
    caps: { enabled: boolean; minLength: number; percent: number; action: AutomodAction };
    spam: { enabled: boolean; messages: number; seconds: number; action: AutomodAction };
  };
  tempVoice: { hubChannelIds: string[]; categoryId: string | null; nameTemplate: string; userLimit: number };
  activity: { trackMessages: boolean; trackVoice: boolean; ignoredChannelIds: string[]; inactiveDays: number };
  reactionRoles: Record<string, never>;
  customCommands: Record<string, never>;
  timers: Record<string, never>;
}
export type ModuleName = keyof ModuleConfigs;
export type ModuleState<M extends ModuleName = ModuleName> = { enabled: boolean; config: ModuleConfigs[M] };

export interface GuildData {
  id: string;
  name: string;
  icon: string | null;
  memberCount: number;
  channels: Channel[];
  roles: Role[];
  emojis: Emoji[];
  modules: { [M in ModuleName]: ModuleState<M> };
}
