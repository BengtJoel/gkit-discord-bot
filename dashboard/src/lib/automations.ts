/** Client-side mirror of server/src/automations/types.ts plus defaults and templates for the builder. */

export type Op = "gte" | "lte" | "eq";

export type Trigger =
  | { type: "message_sent"; channelIds: string[] }
  | { type: "member_joined" }
  | { type: "member_left" }
  | { type: "role_added"; roleIds: string[] }
  | { type: "role_removed"; roleIds: string[] }
  | { type: "reaction_added"; messageId: string | null; emoji: string }
  | { type: "reaction_removed"; messageId: string | null; emoji: string }
  | { type: "button_clicked"; key: string }
  | { type: "select_chosen"; key: string }
  | { type: "level_reached"; level: number | null }
  | { type: "voice_joined"; channelIds: string[] }
  | { type: "voice_left"; channelIds: string[] }
  | { type: "command_used"; command: string }
  | { type: "schedule"; cron: string; timezone: string }
  | { type: "inactive"; days: number };
export type TriggerType = Trigger["type"];

export type Condition =
  | { type: "has_role"; roleIds: string[]; mode: "any" | "all" }
  | { type: "lacks_role"; roleIds: string[] }
  | { type: "in_channel"; channelIds: string[] }
  | { type: "message_contains"; words: string[]; mode: "any" | "all"; wholeWord: boolean }
  | { type: "message_regex"; pattern: string }
  | { type: "level"; op: Op; value: number }
  | { type: "member_days"; op: Op; value: number }
  | { type: "account_days"; op: Op; value: number }
  | { type: "counter"; key: string; op: Op; value: number }
  | { type: "selected"; values: string[] }
  | { type: "chance"; percent: number };
export type ConditionType = Condition["type"];

export interface ButtonDef {
  key: string;
  label: string;
  style: "primary" | "secondary" | "success" | "danger";
  emoji: string;
}
export interface SelectDef {
  key: string;
  placeholder: string;
  min: number;
  max: number;
  options: { label: string; value: string; emoji: string; description: string }[];
}
export type SendMessage = {
  type: "send_message";
  channelId: string | null;
  content: string;
  embed: { title: string; description: string; color: string | null } | null;
  buttons: ButtonDef[];
  select: SelectDef | null;
};

export type Action =
  | SendMessage
  | { type: "reply"; content: string; private: boolean }
  | { type: "send_dm"; content: string }
  | { type: "add_roles"; roleIds: string[] }
  | { type: "remove_roles"; roleIds: string[] }
  | { type: "toggle_roles"; roleIds: string[] }
  | { type: "temp_role"; roleIds: string[]; minutes: number }
  | { type: "roles_from_select"; mapping: { value: string; roleId: string }[] }
  | { type: "delete_message" }
  | { type: "add_reaction"; emoji: string }
  | { type: "timeout"; minutes: number; reason: string }
  | { type: "warn"; reason: string }
  | { type: "give_xp"; amount: number }
  | { type: "set_nickname"; template: string }
  | { type: "wait"; minutes: number }
  | { type: "counter"; key: string; op: "inc" | "dec" | "set"; value: number }
  | { type: "log"; channelId: string; content: string };
export type ActionType = Action["type"];

export interface Rule {
  id?: number;
  name: string;
  enabled: boolean;
  trigger: Trigger;
  conditions: Condition[];
  match: "all" | "any";
  actions: Action[];
  cooldownSeconds: number;
  runCount?: number;
  lastRunAt?: string | null;
}

export const triggerTypes: TriggerType[] = [
  "member_joined",
  "member_left",
  "message_sent",
  "role_added",
  "role_removed",
  "button_clicked",
  "select_chosen",
  "reaction_added",
  "reaction_removed",
  "level_reached",
  "voice_joined",
  "voice_left",
  "command_used",
  "schedule",
  "inactive",
];

export const conditionTypes: ConditionType[] = [
  "has_role",
  "lacks_role",
  "in_channel",
  "message_contains",
  "message_regex",
  "level",
  "member_days",
  "account_days",
  "counter",
  "selected",
  "chance",
];

export const actionTypes: ActionType[] = [
  "add_roles",
  "remove_roles",
  "toggle_roles",
  "temp_role",
  "roles_from_select",
  "send_message",
  "reply",
  "send_dm",
  "log",
  "wait",
  "delete_message",
  "add_reaction",
  "timeout",
  "warn",
  "give_xp",
  "set_nickname",
  "counter",
];

/** Triggers that have no member: actions on "the member" are skipped */
export const memberless: TriggerType[] = ["schedule", "member_left"];

export function defaultTrigger(type: TriggerType): Trigger {
  switch (type) {
    case "message_sent":
    case "voice_joined":
    case "voice_left":
      return { type, channelIds: [] };
    case "role_added":
    case "role_removed":
      return { type, roleIds: [] };
    case "reaction_added":
    case "reaction_removed":
      return { type, messageId: null, emoji: "" };
    case "button_clicked":
    case "select_chosen":
      return { type, key: "" };
    case "level_reached":
      return { type, level: null };
    case "command_used":
      return { type, command: "" };
    case "schedule":
      return { type, cron: "45 18 * * 3", timezone: "Europe/Stockholm" };
    case "inactive":
      return { type, days: 30 };
    default:
      return { type } as Trigger;
  }
}

export function defaultCondition(type: ConditionType): Condition {
  switch (type) {
    case "has_role":
      return { type, roleIds: [], mode: "any" };
    case "lacks_role":
      return { type, roleIds: [] };
    case "in_channel":
      return { type, channelIds: [] };
    case "message_contains":
      return { type, words: [], mode: "any", wholeWord: true };
    case "message_regex":
      return { type, pattern: "" };
    case "level":
    case "member_days":
    case "account_days":
      return { type, op: "gte", value: type === "level" ? 10 : 7 };
    case "counter":
      return { type, key: "", op: "gte", value: 1 };
    case "selected":
      return { type, values: [] };
    case "chance":
      return { type, percent: 50 };
  }
}

export function defaultAction(type: ActionType): Action {
  switch (type) {
    case "send_message":
      return { type, channelId: null, content: "", embed: null, buttons: [], select: null };
    case "reply":
      return { type, content: "", private: true };
    case "send_dm":
      return { type, content: "" };
    case "add_roles":
    case "remove_roles":
    case "toggle_roles":
      return { type, roleIds: [] };
    case "temp_role":
      return { type, roleIds: [], minutes: 60 * 24 };
    case "roles_from_select":
      return { type, mapping: [] };
    case "delete_message":
      return { type };
    case "add_reaction":
      return { type, emoji: "✅" };
    case "timeout":
      return { type, minutes: 10, reason: "" };
    case "warn":
      return { type, reason: "" };
    case "give_xp":
      return { type, amount: 100 };
    case "set_nickname":
      return { type, template: "" };
    case "wait":
      return { type, minutes: 60 };
    case "counter":
      return { type, key: "", op: "inc", value: 1 };
    case "log":
      return { type, channelId: "", content: "" };
  }
}

export const blankRule = (): Rule => ({
  name: "",
  enabled: true,
  trigger: defaultTrigger("member_joined"),
  conditions: [],
  match: "all",
  actions: [defaultAction("add_roles")],
  cooldownSeconds: 0,
});

/** Ready-made rules for common guild workflows. Roles/channels are left for the admin to pick. */
export const templates: { id: string; rule: () => Rule }[] = [
  {
    id: "verify",
    rule: () => ({
      ...blankRule(),
      trigger: { type: "button_clicked", key: "verify" },
      actions: [{ type: "add_roles", roleIds: [] }, { type: "reply", content: "✅", private: true }],
      cooldownSeconds: 5,
    }),
  },
  {
    id: "classPicker",
    rule: () => ({
      ...blankRule(),
      trigger: { type: "select_chosen", key: "class" },
      actions: [
        { type: "roles_from_select", mapping: ["tank", "healer", "dps"].map((value) => ({ value, roleId: "" })) },
        { type: "reply", content: "✅ {selected}", private: true },
      ],
    }),
  },
  {
    id: "trial",
    rule: () => ({
      ...blankRule(),
      trigger: { type: "role_added", roleIds: [] },
      actions: [
        { type: "wait", minutes: 14 * 24 * 60 },
        { type: "log", channelId: "", content: "{user} – 14 d trial" },
      ],
    }),
  },
  {
    id: "roleSync",
    rule: () => ({
      ...blankRule(),
      trigger: { type: "role_added", roleIds: [] },
      actions: [{ type: "add_roles", roleIds: [] }],
    }),
  },
  {
    id: "inactive",
    rule: () => ({
      ...blankRule(),
      trigger: { type: "inactive", days: 30 },
      conditions: [{ type: "has_role", roleIds: [], mode: "any" }],
      actions: [
        { type: "remove_roles", roleIds: [] },
        { type: "add_roles", roleIds: [] },
        { type: "log", channelId: "", content: "{user} – 30 d" },
      ],
    }),
  },
  {
    id: "welcomeDm",
    rule: () => ({
      ...blankRule(),
      trigger: { type: "member_joined" },
      actions: [{ type: "wait", minutes: 10 }, { type: "send_dm", content: "" }],
    }),
  },
  {
    id: "levelReward",
    rule: () => ({
      ...blankRule(),
      trigger: { type: "level_reached", level: 20 },
      actions: [
        { type: "add_roles", roleIds: [] },
        { type: "send_message", channelId: null, content: "🎉 {user} – level {level}!", embed: null, buttons: [], select: null },
      ],
    }),
  },
  {
    id: "apply",
    rule: () => ({
      ...blankRule(),
      trigger: { type: "command_used", command: "" },
      actions: [
        { type: "reply", content: "", private: true },
        { type: "log", channelId: "", content: "{user}" },
      ],
    }),
  },
];

/** Minutes <-> a friendly unit for inputs */
export function splitMinutes(m: number): { value: number; unit: "min" | "h" | "d" } {
  if (m % 1440 === 0) return { value: m / 1440, unit: "d" };
  if (m % 60 === 0) return { value: m / 60, unit: "h" };
  return { value: m, unit: "min" };
}
export const toMinutes = (value: number, unit: "min" | "h" | "d") => value * (unit === "d" ? 1440 : unit === "h" ? 60 : 1);
