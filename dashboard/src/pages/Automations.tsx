import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { ArrowDown, ArrowUp, Check, Copy, FlaskConical, History, Pencil, Plus, Send, Trash2, Workflow, X, Zap } from "lucide-react";
import { api, fmtDateTime, timeAgo } from "../lib/api";
import { useGuild, useModuleForm } from "../lib/guild";
import { ModuleShell } from "../components/ModuleShell";
import {
  Badge,
  Button,
  Card,
  ChannelMultiSelect,
  ChannelSelect,
  Empty,
  Field,
  Modal,
  NumberInput,
  RoleMultiSelect,
  RoleSelect,
  Segmented,
  Spinner,
  TagInput,
  TemplateInput,
  Toggle,
  useToast,
} from "../components/ui";
import { useT, tr } from "../lib/i18n";
import {
  actionTypes,
  blankRule,
  conditionTypes,
  defaultAction,
  defaultCondition,
  defaultTrigger,
  memberless,
  splitMinutes,
  templates,
  toMinutes,
  triggerTypes,
  type Action,
  type ActionType,
  type Condition,
  type Op,
  type Rule,
  type SendMessage,
  type Trigger,
} from "../lib/automations";

interface Run {
  id: number;
  automationId: number;
  userId: string | null;
  status: "ok" | "skipped" | "failed" | "partial";
  reason: string | null;
  detail: { conditions?: { type: Condition["type"]; pass: boolean }[]; actions?: { type: ActionType; ok: boolean; skipped?: boolean; error?: string }[] };
  createdAt: string;
}

const statusTone = { ok: "ok", skipped: "neutral", failed: "bad", partial: "warn" } as const;

/* ------------------------------------------------------------------ page */

export function Automations() {
  const f = useModuleForm("automations");
  const g = useGuild();
  const { t } = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = useState<Rule | null>(null);
  const [picking, setPicking] = useState(false);
  const [logFor, setLogFor] = useState<number | null>(null);

  const list = useQuery({ queryKey: ["automations", g.id], queryFn: () => api<Rule[]>(`/guilds/${g.id}/automations`) });
  const inval = () => void qc.invalidateQueries({ queryKey: ["automations", g.id] });
  const save = useMutation({
    mutationFn: (r: Rule) => {
      const body = { ...r, id: undefined, runCount: undefined, lastRunAt: undefined, name: r.name || summarizeTrigger(r.trigger) };
      return r.id ? api<Rule>(`/guilds/${g.id}/automations/${r.id}`, { method: "PUT", json: body }) : api<Rule>(`/guilds/${g.id}/automations`, { method: "POST", json: body });
    },
    onSuccess: () => {
      toast(t("dash.auto.saved"));
      setDraft(null);
      inval();
    },
    onError: (e: Error) => toast(e.message, "bad"),
  });
  const toggle = useMutation({
    mutationFn: (r: Rule) => api(`/guilds/${g.id}/automations/${r.id}`, { method: "PUT", json: { ...r, id: undefined, runCount: undefined, lastRunAt: undefined, enabled: !r.enabled } }),
    onSuccess: inval,
    onError: (e: Error) => toast(e.message, "bad"),
  });
  const del = useMutation({ mutationFn: (id: number) => api(`/guilds/${g.id}/automations/${id}`, { method: "DELETE" }), onSuccess: inval });

  return (
    <ModuleShell
      title={t("dash.nav.automations")}
      icon={<Workflow className="size-5" />}
      description={t("dash.auto.description")}
      form={f}
      actions={
        <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setPicking(true)}>
          {t("dash.auto.new")}
        </Button>
      }
    >
      <Card padded={false}>
        {list.isLoading ? (
          <div className="grid h-32 place-items-center"><Spinner /></div>
        ) : !list.data?.length ? (
          <Empty icon={<Workflow className="size-5" />} title={t("dash.auto.emptyTitle")}>
            {t("dash.auto.emptyBody")}
            <div className="mt-4"><Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setPicking(true)}>{t("dash.auto.new")}</Button></div>
          </Empty>
        ) : (
          <ul className="divide-y divide-line">
            {list.data.map((r) => (
              <li key={r.id} className="flex items-center gap-4 px-5 py-3">
                <Toggle size="sm" checked={r.enabled} onChange={() => toggle.mutate(r)} />
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setDraft(r)}>
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{r.name || summarizeTrigger(r.trigger)}</span>
                    {!r.enabled && <Badge>{t("dash.auto.paused")}</Badge>}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-sm text-muted">
                    <Chip tone="when">{summarizeTrigger(r.trigger)}</Chip>
                    {r.conditions.length > 0 && <Chip tone="if">{t("dash.auto.conditionsCount", { count: r.conditions.length })}</Chip>}
                    <Chip tone="then">{r.actions.map((a) => t(`dash.auto.actions.${a.type}`)).join(" → ")}</Chip>
                  </div>
                </button>
                <div className="hidden text-right text-xs text-muted sm:block">
                  <div>{t("dash.auto.runs", { count: r.runCount ?? 0 })}</div>
                  <div>{r.lastRunAt ? timeAgo(r.lastRunAt) : "—"}</div>
                </div>
                <Button variant="ghost" size="sm" title={t("dash.auto.runLog")} onClick={() => setLogFor(r.id!)}><History className="size-4" /></Button>
                <Button variant="ghost" size="sm" title={t("dash.auto.duplicate")} onClick={() => setDraft({ ...r, id: undefined, name: `${r.name} (2)`, enabled: false })}><Copy className="size-4" /></Button>
                <Button variant="ghost" size="sm" onClick={() => setDraft(r)}><Pencil className="size-4" /></Button>
                <Button variant="ghost" size="sm" onClick={() => confirm(t("dash.auto.confirmDelete")) && del.mutate(r.id!)}><Trash2 className="size-4" /></Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <RunLog rules={list.data ?? []} filter={logFor} setFilter={setLogFor} />

      {picking && (
        <TemplatePicker
          onClose={() => setPicking(false)}
          onPick={(r) => {
            setPicking(false);
            setDraft(r);
          }}
        />
      )}
      {draft && <RuleEditor draft={draft} setDraft={setDraft} saving={save.isPending} onSave={() => save.mutate(draft)} />}
    </ModuleShell>
  );
}

function Chip({ tone, children }: { tone: "when" | "if" | "then"; children: ReactNode }) {
  return (
    <span
      className={clsx(
        "inline-flex max-w-full items-center truncate rounded px-1.5 py-0.5 text-xs",
        tone === "when" && "bg-accent/15 text-accent-2",
        tone === "if" && "bg-panel-2 text-muted ring-1 ring-line",
        tone === "then" && "bg-teal-500/10 text-teal-300",
      )}
    >
      {children}
    </span>
  );
}

/** One line in the current language, e.g. "Button clicked: verify" */
function summarizeTrigger(tg: Trigger): string {
  const base = tr(`dash.auto.triggers.${tg.type}`);
  switch (tg.type) {
    case "button_clicked":
    case "select_chosen":
      return tg.key ? `${base}: ${tg.key}` : base;
    case "level_reached":
      return tg.level ? `${base}: ${tg.level}` : base;
    case "command_used":
      return tg.command ? `${base}: /${tg.command}` : base;
    case "inactive":
      return `${base}: ${tr("dash.periods.days", { count: tg.days })}`;
    case "schedule":
      return `${base}: ${tg.cron}`;
    case "reaction_added":
    case "reaction_removed":
      return tg.emoji ? `${base}: ${tg.emoji}` : base;
    default:
      return base;
  }
}

/* -------------------------------------------------------------- templates */

function TemplatePicker({ onClose, onPick }: { onClose: () => void; onPick: (r: Rule) => void }) {
  const { t } = useT();
  return (
    <Modal open wide onClose={onClose} title={t("dash.auto.pickTemplate")}>
      <div className="grid gap-3 sm:grid-cols-2">
        <button type="button" onClick={() => onPick(blankRule())} className="rounded-lg border border-dashed border-line-2 p-4 text-left transition hover:border-accent hover:bg-accent/5">
          <div className="flex items-center gap-2 font-medium"><Plus className="size-4" /> {t("dash.auto.blank")}</div>
          <p className="mt-1 text-sm text-muted">{t("dash.auto.blankHint")}</p>
        </button>
        {templates.map((tpl) => (
          <button
            key={tpl.id}
            type="button"
            onClick={() => onPick({ ...tpl.rule(), name: tr(`dash.auto.templates.${tpl.id}.name` as never) })}
            className="rounded-lg border border-line p-4 text-left transition hover:border-accent hover:bg-accent/5"
          >
            <div className="flex items-center gap-2 font-medium"><Zap className="size-4 text-accent-2" /> {tr(`dash.auto.templates.${tpl.id}.name` as never)}</div>
            <p className="mt-1 text-sm text-muted">{tr(`dash.auto.templates.${tpl.id}.body` as never)}</p>
          </button>
        ))}
      </div>
    </Modal>
  );
}

/* ----------------------------------------------------------------- editor */

function RuleEditor({ draft, setDraft, onSave, saving }: { draft: Rule; setDraft: (r: Rule | null) => void; onSave: () => void; saving: boolean }) {
  const { t } = useT();
  const [tab, setTab] = useState<"build" | "test">("build");
  const set = <K extends keyof Rule>(k: K, v: Rule[K]) => setDraft({ ...draft, [k]: v });
  const problems = useMemo(() => validate(draft), [draft]);
  const noMember = memberless.includes(draft.trigger.type);

  return (
    <Modal
      open
      wide
      onClose={() => setDraft(null)}
      title={draft.id ? t("dash.auto.editTitle") : t("dash.auto.new")}
      footer={
        <>
          {problems.length > 0 && <span className="mr-auto text-sm text-amber-300">{problems[0]}</span>}
          <Button variant="ghost" onClick={() => setDraft(null)}>{t("dash.common.cancel")}</Button>
          <Button variant="primary" loading={saving} disabled={problems.length > 0} onClick={onSave}>{t("dash.common.save")}</Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <Field label={t("dash.common.name")}>
          <input className="input" value={draft.name} maxLength={100} placeholder={summarizeTrigger(draft.trigger)} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <Segmented value={tab} onChange={setTab} options={[{ value: "build", label: t("dash.auto.tabBuild") }, { value: "test", label: t("dash.auto.tabTest") }]} />
        <label className="flex h-9 items-center gap-2 text-sm"><Toggle size="sm" checked={draft.enabled} onChange={(v) => set("enabled", v)} /> {t("dash.common.active")}</label>
      </div>

      {tab === "test" ? (
        <Simulator rule={draft} />
      ) : (
        <>
          <Step n={1} tone="when" title={t("dash.auto.when")}>
            <select className="input" value={draft.trigger.type} onChange={(e) => set("trigger", defaultTrigger(e.target.value as Trigger["type"]))}>
              {triggerTypes.map((tt) => <option key={tt} value={tt}>{t(`dash.auto.triggers.${tt}`)}</option>)}
            </select>
            <p className="hint">{t(`dash.auto.triggerHints.${draft.trigger.type}`)}</p>
            <TriggerFields trigger={draft.trigger} onChange={(trigger) => set("trigger", trigger)} />
            {(draft.trigger.type === "button_clicked" || draft.trigger.type === "select_chosen") && <PanelComposer rule={draft} />}
          </Step>

          <Step
            n={2}
            tone="if"
            title={t("dash.auto.if")}
            aside={
              draft.conditions.length > 1 && (
                <Segmented value={draft.match} onChange={(match) => set("match", match)} options={[{ value: "all", label: t("dash.auto.matchAll") }, { value: "any", label: t("dash.auto.matchAny") }]} />
              )
            }
          >
            {draft.conditions.length === 0 && <p className="text-sm text-muted">{t("dash.auto.noConditions")}</p>}
            <div className="space-y-2">
              {draft.conditions.map((c, i) => (
                <Row key={i} onRemove={() => set("conditions", draft.conditions.filter((_, j) => j !== i))}>
                  <ConditionFields condition={c} onChange={(nc) => set("conditions", draft.conditions.map((x, j) => (j === i ? nc : x)))} />
                </Row>
              ))}
            </div>
            {draft.conditions.length < 20 && (
              <AddMenu
                label={t("dash.auto.addCondition")}
                options={conditionTypes.map((ct) => ({ value: ct, label: t(`dash.auto.conditions.${ct}`) }))}
                onPick={(ct) => set("conditions", [...draft.conditions, defaultCondition(ct)])}
              />
            )}
          </Step>

          <Step n={3} tone="then" title={t("dash.auto.then")}>
            {noMember && <p className="hint">{t("dash.auto.memberlessHint")}</p>}
            <div className="space-y-2">
              {draft.actions.map((a, i) => (
                <Row
                  key={i}
                  index={i + 1}
                  onRemove={draft.actions.length > 1 ? () => set("actions", draft.actions.filter((_, j) => j !== i)) : undefined}
                  onUp={i > 0 ? () => set("actions", move(draft.actions, i, i - 1)) : undefined}
                  onDown={i < draft.actions.length - 1 ? () => set("actions", move(draft.actions, i, i + 1)) : undefined}
                >
                  <ActionFields action={a} trigger={draft.trigger} onChange={(na) => set("actions", draft.actions.map((x, j) => (j === i ? na : x)))} />
                </Row>
              ))}
            </div>
            {draft.actions.length < 20 && (
              <AddMenu
                label={t("dash.auto.addAction")}
                options={actionTypes.map((at) => ({ value: at, label: t(`dash.auto.actions.${at}`) }))}
                onPick={(at) => set("actions", [...draft.actions, defaultAction(at)])}
              />
            )}
          </Step>

          <details className="rounded-lg border border-line px-4 py-3 text-sm">
            <summary className="cursor-pointer font-medium">{t("dash.auto.advanced")}</summary>
            <div className="mt-3 max-w-xs">
              <Field label={t("dash.auto.cooldown")} hint={t("dash.auto.cooldownHint")}>
                <NumberInput value={draft.cooldownSeconds} onChange={(v) => set("cooldownSeconds", v)} min={0} max={604800} suffix={t("dash.units.sec")} />
              </Field>
            </div>
            <p className="hint mt-2">{t("dash.auto.limitsHint")}</p>
          </details>
        </>
      )}
    </Modal>
  );
}

function move<T>(arr: T[], from: number, to: number) {
  const copy = [...arr];
  const [x] = copy.splice(from, 1);
  copy.splice(to, 0, x);
  return copy;
}

/** Client-side checks so the save button explains itself instead of a 400 */
function validate(r: Rule): string[] {
  const out: string[] = [];
  const tg = r.trigger;
  if ((tg.type === "button_clicked" || tg.type === "select_chosen") && !/^[a-z0-9_-]{1,40}$/i.test(tg.key)) out.push(tr("dash.auto.problems.key"));
  if (tg.type === "command_used" && !tg.command) out.push(tr("dash.auto.problems.command"));
  for (const a of r.actions) {
    if ("roleIds" in a && !a.roleIds.length) out.push(tr("dash.auto.problems.roles", { action: tr(`dash.auto.actions.${a.type}`) }));
    if ((a.type === "reply" || a.type === "send_dm") && !a.content.trim()) out.push(tr("dash.auto.problems.text", { action: tr(`dash.auto.actions.${a.type}`) }));
    if (a.type === "log" && (!a.channelId || !a.content.trim())) out.push(tr("dash.auto.problems.log"));
    if (a.type === "send_message" && !a.content.trim() && !a.embed?.title && !a.embed?.description) out.push(tr("dash.auto.problems.text", { action: tr("dash.auto.actions.send_message") }));
    if (a.type === "roles_from_select" && (!a.mapping.length || a.mapping.some((m) => !m.value || !m.roleId))) out.push(tr("dash.auto.problems.mapping"));
    if (a.type === "counter" && !a.key) out.push(tr("dash.auto.problems.counter"));
  }
  for (const c of r.conditions) {
    if ((c.type === "has_role" || c.type === "lacks_role") && !c.roleIds.length) out.push(tr("dash.auto.problems.condRoles"));
    if (c.type === "message_regex") {
      try {
        new RegExp(c.pattern);
      } catch {
        out.push(tr("dash.auto.problems.regex"));
      }
    }
  }
  return out;
}

function Step({ n, tone, title, aside, children }: { n: number; tone: "when" | "if" | "then"; title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="relative rounded-lg border border-line bg-panel-2/30 p-4">
      <div className="mb-3 flex items-center gap-3">
        <span
          className={clsx(
            "grid size-6 place-items-center rounded-full text-xs font-semibold",
            tone === "when" && "bg-accent text-white",
            tone === "if" && "bg-line-2 text-fg",
            tone === "then" && "bg-teal-600 text-white",
          )}
        >
          {n}
        </span>
        <h3 className="font-semibold">{title}</h3>
        <div className="ml-auto">{aside}</div>
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Row({ children, onRemove, onUp, onDown, index }: { children: ReactNode; onRemove?: () => void; onUp?: () => void; onDown?: () => void; index?: number }) {
  return (
    <div className="flex gap-2 rounded-md border border-line bg-panel p-3">
      {index !== undefined && <span className="mt-2 w-4 shrink-0 text-xs text-muted">{index}.</span>}
      <div className="min-w-0 flex-1 space-y-2">{children}</div>
      <div className="flex shrink-0 flex-col gap-0.5">
        {onUp && <button type="button" className="rounded p-1 text-muted hover:text-fg" onClick={onUp}><ArrowUp className="size-3.5" /></button>}
        {onDown && <button type="button" className="rounded p-1 text-muted hover:text-fg" onClick={onDown}><ArrowDown className="size-3.5" /></button>}
        {onRemove && <button type="button" className="rounded p-1 text-muted hover:text-red-300" onClick={onRemove}><X className="size-3.5" /></button>}
      </div>
    </div>
  );
}

function AddMenu<T extends string>({ label, options, onPick }: { label: string; options: { value: T; label: string }[]; onPick: (v: T) => void }) {
  return (
    <select
      className="input w-auto cursor-pointer text-accent-2"
      value=""
      onChange={(e) => {
        if (e.target.value) onPick(e.target.value as T);
      }}
    >
      <option value="">+ {label}</option>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function Inline({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2 text-sm">{children}</div>;
}

function OpSelect({ value, onChange }: { value: Op; onChange: (v: Op) => void }) {
  return (
    <select className="input w-auto" value={value} onChange={(e) => onChange(e.target.value as Op)}>
      <option value="gte">≥</option>
      <option value="lte">≤</option>
      <option value="eq">=</option>
    </select>
  );
}

function Duration({ minutes, onChange, max }: { minutes: number; onChange: (m: number) => void; max?: number }) {
  const { t } = useT();
  const { value, unit } = splitMinutes(minutes);
  const [u, setU] = useState(unit);
  return (
    <span className="inline-flex items-center gap-1">
      <input type="number" className="input w-24" min={1} value={value} onChange={(e) => onChange(Math.min(max ?? Infinity, toMinutes(Math.max(1, Number(e.target.value) || 1), u)))} />
      <select
        className="input w-auto"
        value={u}
        onChange={(e) => {
          const nu = e.target.value as typeof u;
          setU(nu);
          onChange(Math.min(max ?? Infinity, toMinutes(value, nu)));
        }}
      >
        <option value="min">{t("dash.auto.units.min")}</option>
        <option value="h">{t("dash.auto.units.h")}</option>
        <option value="d">{t("dash.auto.units.d")}</option>
      </select>
    </span>
  );
}

const keyClean = (v: string) => v.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40);

/* ---------------------------------------------------------------- trigger */

function TriggerFields({ trigger: tg, onChange }: { trigger: Trigger; onChange: (t: Trigger) => void }) {
  const { t } = useT();
  switch (tg.type) {
    case "message_sent":
      return <Field label={t("dash.auto.f.channelsAny")}><ChannelMultiSelect value={tg.channelIds} onChange={(channelIds) => onChange({ ...tg, channelIds })} types={["text", "category", "forum"]} /></Field>;
    case "voice_joined":
    case "voice_left":
      return <Field label={t("dash.auto.f.channelsAny")}><ChannelMultiSelect value={tg.channelIds} onChange={(channelIds) => onChange({ ...tg, channelIds })} types={["voice", "category"]} /></Field>;
    case "role_added":
    case "role_removed":
      return <Field label={t("dash.auto.f.rolesAny")}><RoleMultiSelect value={tg.roleIds} onChange={(roleIds) => onChange({ ...tg, roleIds })} /></Field>;
    case "reaction_added":
    case "reaction_removed":
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("dash.auto.f.emoji")} hint={t("dash.auto.f.emptyAny")}><input className="input" value={tg.emoji} onChange={(e) => onChange({ ...tg, emoji: e.target.value.trim() })} placeholder="✅" /></Field>
          <Field label={t("dash.auto.f.messageId")} hint={t("dash.auto.f.emptyAny")}><input className="input font-mono" value={tg.messageId ?? ""} onChange={(e) => onChange({ ...tg, messageId: e.target.value.trim() || null })} placeholder="123456789012345678" /></Field>
        </div>
      );
    case "button_clicked":
    case "select_chosen":
      return (
        <Field label={t("dash.auto.f.key")} hint={t("dash.auto.f.keyHint")}>
          <input className="input font-mono" value={tg.key} onChange={(e) => onChange({ ...tg, key: keyClean(e.target.value) })} placeholder="verify" />
        </Field>
      );
    case "level_reached":
      return (
        <Inline>
          <label className="flex items-center gap-2"><input type="checkbox" checked={tg.level === null} onChange={(e) => onChange({ ...tg, level: e.target.checked ? null : 10 })} /> {t("dash.auto.f.anyLevel")}</label>
          {tg.level !== null && <NumberInput value={tg.level} onChange={(level) => onChange({ ...tg, level })} min={1} max={500} />}
        </Inline>
      );
    case "command_used":
      return <CommandPicker value={tg.command} onChange={(command) => onChange({ ...tg, command })} />;
    case "schedule":
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("dash.auto.f.cron")} hint={t("dash.auto.f.cronHint")}><input className="input font-mono" value={tg.cron} onChange={(e) => onChange({ ...tg, cron: e.target.value })} /></Field>
          <Field label={t("dash.auto.f.timezone")}><input className="input" value={tg.timezone} onChange={(e) => onChange({ ...tg, timezone: e.target.value })} /></Field>
        </div>
      );
    case "inactive":
      return (
        <Inline>
          {t("dash.auto.f.inactiveFor")} <NumberInput value={tg.days} onChange={(days) => onChange({ ...tg, days })} min={1} max={365} suffix={t("dash.units.days")} />
        </Inline>
      );
    default:
      return null;
  }
}

function CommandPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const g = useGuild();
  const { t } = useT();
  const cmds = useQuery({ queryKey: ["commands", g.id], queryFn: () => api<{ name: string }[]>(`/guilds/${g.id}/commands`) });
  return (
    <Field label={t("dash.auto.f.command")} hint={t("dash.auto.f.commandHint")}>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {cmds.data?.map((c) => <option key={c.name} value={c.name}>/{c.name}</option>)}
      </select>
    </Field>
  );
}

/* ------------------------------------------------------------- conditions */

function ConditionFields({ condition: c, onChange }: { condition: Condition; onChange: (c: Condition) => void }) {
  const { t } = useT();
  const label = <div className="text-xs font-medium uppercase tracking-wide text-muted">{t(`dash.auto.conditions.${c.type}`)}</div>;
  switch (c.type) {
    case "has_role":
      return (
        <>
          {label}
          <Inline>
            <Segmented value={c.mode} onChange={(mode) => onChange({ ...c, mode })} options={[{ value: "any", label: t("dash.auto.f.anyOf") }, { value: "all", label: t("dash.auto.f.allOf") }]} />
          </Inline>
          <RoleMultiSelect value={c.roleIds} onChange={(roleIds) => onChange({ ...c, roleIds })} />
        </>
      );
    case "lacks_role":
      return <>{label}<RoleMultiSelect value={c.roleIds} onChange={(roleIds) => onChange({ ...c, roleIds })} /></>;
    case "in_channel":
      return <>{label}<ChannelMultiSelect value={c.channelIds} onChange={(channelIds) => onChange({ ...c, channelIds })} types={["text", "voice", "category", "forum"]} /></>;
    case "message_contains":
      return (
        <>
          {label}
          <TagInput value={c.words} onChange={(words) => onChange({ ...c, words })} placeholder={t("dash.auto.f.addWord")} />
          <Inline>
            <Segmented value={c.mode} onChange={(mode) => onChange({ ...c, mode })} options={[{ value: "any", label: t("dash.auto.f.anyWord") }, { value: "all", label: t("dash.auto.f.allWords") }]} />
            <label className="flex items-center gap-2"><input type="checkbox" checked={c.wholeWord} onChange={(e) => onChange({ ...c, wholeWord: e.target.checked })} /> {t("dash.auto.f.wholeWord")}</label>
          </Inline>
        </>
      );
    case "message_regex":
      return <>{label}<input className="input font-mono" value={c.pattern} onChange={(e) => onChange({ ...c, pattern: e.target.value })} placeholder="^!apply" /></>;
    case "level":
    case "member_days":
    case "account_days":
      return (
        <Inline>
          <span className="font-medium">{t(`dash.auto.conditions.${c.type}`)}</span>
          <OpSelect value={c.op} onChange={(op) => onChange({ ...c, op })} />
          <NumberInput value={c.value} onChange={(value) => onChange({ ...c, value })} min={0} max={c.type === "level" ? 500 : 10000} suffix={c.type === "level" ? undefined : t("dash.units.days")} />
        </Inline>
      );
    case "counter":
      return (
        <Inline>
          <span className="font-medium">{t("dash.auto.conditions.counter")}</span>
          <input className="input w-36 font-mono" value={c.key} onChange={(e) => onChange({ ...c, key: keyClean(e.target.value) })} placeholder="strikes" />
          <OpSelect value={c.op} onChange={(op) => onChange({ ...c, op })} />
          <NumberInput value={c.value} onChange={(value) => onChange({ ...c, value })} />
        </Inline>
      );
    case "selected":
      return <>{label}<TagInput value={c.values} onChange={(values) => onChange({ ...c, values })} placeholder={t("dash.auto.f.addValue")} /></>;
    case "chance":
      return (
        <Inline>
          <span className="font-medium">{t("dash.auto.conditions.chance")}</span>
          <NumberInput value={c.percent} onChange={(percent) => onChange({ ...c, percent })} min={1} max={100} suffix="%" />
        </Inline>
      );
  }
}

/* ---------------------------------------------------------------- actions */

function textVars(trigger: Trigger) {
  const v = [
    { key: "user", label: tr("dash.vars.user") },
    { key: "username", label: tr("dash.vars.username") },
    { key: "displayname", label: tr("dash.vars.displayname") },
    { key: "server", label: tr("dash.vars.server") },
    { key: "membercount", label: tr("dash.vars.membercount") },
    { key: "channel", label: tr("dash.vars.channel") },
  ];
  if (trigger.type === "level_reached") v.push({ key: "level", label: tr("dash.vars.level") });
  if (trigger.type === "role_added" || trigger.type === "role_removed") v.push({ key: "role", label: tr("dash.auto.vars.role") });
  if (trigger.type === "select_chosen") v.push({ key: "selected", label: tr("dash.auto.vars.selected") });
  return v;
}

function ActionFields({ action: a, trigger, onChange }: { action: Action; trigger: Trigger; onChange: (a: Action) => void }) {
  const { t } = useT();
  const vars = textVars(trigger);
  const label = <div className="text-xs font-medium uppercase tracking-wide text-muted">{t(`dash.auto.actions.${a.type}`)}</div>;
  switch (a.type) {
    case "add_roles":
    case "remove_roles":
    case "toggle_roles":
      return <>{label}<RoleMultiSelect value={a.roleIds} onChange={(roleIds) => onChange({ ...a, roleIds })} assignableOnly /></>;
    case "temp_role":
      return (
        <>
          {label}
          <RoleMultiSelect value={a.roleIds} onChange={(roleIds) => onChange({ ...a, roleIds })} assignableOnly />
          <Inline>{t("dash.auto.f.removeAfter")} <Duration minutes={a.minutes} onChange={(minutes) => onChange({ ...a, minutes })} max={60 * 24 * 90} /></Inline>
        </>
      );
    case "roles_from_select":
      return (
        <>
          {label}
          <p className="hint">{t("dash.auto.f.mappingHint")}</p>
          {a.mapping.map((m, i) => (
            <div key={i} className="flex items-center gap-2">
              <input className="input w-36 font-mono" value={m.value} placeholder="tank" onChange={(e) => onChange({ ...a, mapping: a.mapping.map((x, j) => (j === i ? { ...x, value: e.target.value.slice(0, 100) } : x)) })} />
              <span className="text-muted">→</span>
              <div className="flex-1"><RoleSelect value={m.roleId || null} onChange={(roleId) => onChange({ ...a, mapping: a.mapping.map((x, j) => (j === i ? { ...x, roleId } : x)) })} /></div>
              <button type="button" className="p-1 text-muted hover:text-red-300" onClick={() => onChange({ ...a, mapping: a.mapping.filter((_, j) => j !== i) })}><X className="size-3.5" /></button>
            </div>
          ))}
          {a.mapping.length < 25 && <Button size="sm" icon={<Plus className="size-4" />} onClick={() => onChange({ ...a, mapping: [...a.mapping, { value: "", roleId: "" }] })}>{t("dash.common.add")}</Button>}
        </>
      );
    case "send_message":
      return <>{label}<MessageFields action={a} vars={vars} onChange={onChange} /></>;
    case "reply":
      return (
        <>
          {label}
          <TemplateInput value={a.content} onChange={(content) => onChange({ ...a, content })} variables={vars} rows={2} />
          <label className="flex items-center gap-2 text-sm"><Toggle size="sm" checked={a.private} onChange={(v) => onChange({ ...a, private: v })} /> {t("dash.auto.f.private")}</label>
          <p className="hint">{t("dash.auto.f.replyHint")}</p>
        </>
      );
    case "send_dm":
      return <>{label}<TemplateInput value={a.content} onChange={(content) => onChange({ ...a, content })} variables={vars} rows={2} /></>;
    case "log":
      return (
        <>
          {label}
          <ChannelSelect value={a.channelId || null} onChange={(v) => onChange({ ...a, channelId: v ?? "" })} clearable={false} />
          <TemplateInput value={a.content} onChange={(content) => onChange({ ...a, content })} variables={vars} rows={2} />
        </>
      );
    case "wait":
      return (
        <Inline>
          <span className="font-medium">{t("dash.auto.actions.wait")}</span>
          <Duration minutes={a.minutes} onChange={(minutes) => onChange({ ...a, minutes })} max={60 * 24 * 30} />
          <span className="hint">{t("dash.auto.f.waitHint")}</span>
        </Inline>
      );
    case "delete_message":
      return <>{label}<p className="hint">{t("dash.auto.f.deleteHint")}</p></>;
    case "add_reaction":
      return <Inline><span className="font-medium">{t("dash.auto.actions.add_reaction")}</span><input className="input w-40" value={a.emoji} onChange={(e) => onChange({ ...a, emoji: e.target.value.trim() })} /></Inline>;
    case "timeout":
      return (
        <>
          <Inline><span className="font-medium">{t("dash.auto.actions.timeout")}</span><Duration minutes={a.minutes} onChange={(minutes) => onChange({ ...a, minutes })} max={60 * 24 * 28} /></Inline>
          <input className="input" value={a.reason} maxLength={400} onChange={(e) => onChange({ ...a, reason: e.target.value })} placeholder={t("dash.auto.f.reason")} />
        </>
      );
    case "warn":
      return <>{label}<input className="input" value={a.reason} maxLength={400} onChange={(e) => onChange({ ...a, reason: e.target.value })} placeholder={t("dash.auto.f.reason")} /></>;
    case "give_xp":
      return <Inline><span className="font-medium">{t("dash.auto.actions.give_xp")}</span><NumberInput value={a.amount} onChange={(amount) => onChange({ ...a, amount })} min={-100000} max={100000} suffix="XP" /></Inline>;
    case "set_nickname":
      return (
        <>
          {label}
          <TemplateInput value={a.template} onChange={(template) => onChange({ ...a, template })} variables={vars} rows={1} placeholder="[Trial] {displayname}" />
          <p className="hint">{t("dash.auto.f.nicknameHint")}</p>
        </>
      );
    case "counter":
      return (
        <Inline>
          <span className="font-medium">{t("dash.auto.actions.counter")}</span>
          <input className="input w-36 font-mono" value={a.key} onChange={(e) => onChange({ ...a, key: keyClean(e.target.value) })} placeholder="strikes" />
          <select className="input w-auto" value={a.op} onChange={(e) => onChange({ ...a, op: e.target.value as typeof a.op })}>
            <option value="inc">+</option>
            <option value="dec">−</option>
            <option value="set">=</option>
          </select>
          <NumberInput value={a.value} onChange={(value) => onChange({ ...a, value })} />
        </Inline>
      );
  }
}

function MessageFields({ action: a, vars, onChange }: { action: SendMessage; vars: { key: string; label: string }[]; onChange: (a: SendMessage) => void }) {
  const { t } = useT();
  const g = useGuild();
  return (
    <>
      <ChannelSelect value={a.channelId} onChange={(channelId) => onChange({ ...a, channelId })} placeholder={t("dash.auto.f.sameChannel")} />
      <TemplateInput value={a.content} onChange={(content) => onChange({ ...a, content })} variables={vars} rows={2} />
      <label className="flex items-center gap-2 text-sm">
        <Toggle size="sm" checked={!!a.embed} onChange={(v) => onChange({ ...a, embed: v ? { title: "", description: "", color: g.modules.branding.config.color } : null })} /> {t("dash.auto.f.embed")}
      </label>
      {a.embed && (
        <div className="space-y-2 border-l-2 pl-3" style={{ borderColor: a.embed.color ?? undefined }}>
          <div className="flex gap-2">
            <input className="input" value={a.embed.title} maxLength={256} placeholder={t("dash.rr.titleLabel")} onChange={(e) => onChange({ ...a, embed: { ...a.embed!, title: e.target.value } })} />
            <input type="color" className="h-9 w-12 shrink-0 cursor-pointer rounded-md border border-line bg-panel-2 p-1" value={a.embed.color ?? "#8b5cf6"} onChange={(e) => onChange({ ...a, embed: { ...a.embed!, color: e.target.value } })} />
          </div>
          <textarea className="input" rows={3} value={a.embed.description} placeholder={t("dash.common.description")} onChange={(e) => onChange({ ...a, embed: { ...a.embed!, description: e.target.value } })} />
        </div>
      )}
      <ButtonsEditor value={a.buttons} onChange={(buttons) => onChange({ ...a, buttons })} />
    </>
  );
}

function ButtonsEditor({ value, onChange }: { value: SendMessage["buttons"]; onChange: (b: SendMessage["buttons"]) => void }) {
  const { t } = useT();
  return (
    <div className="space-y-2">
      {value.map((b, i) => {
        const up = (p: Partial<typeof b>) => onChange(value.map((x, j) => (j === i ? { ...x, ...p } : x)));
        return (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <input className="input w-16" value={b.emoji} placeholder="✅" onChange={(e) => up({ emoji: e.target.value.trim() })} />
            <input className="input w-40" value={b.label} maxLength={80} placeholder={t("dash.auto.f.buttonLabel")} onChange={(e) => up({ label: e.target.value })} />
            <input className="input w-32 font-mono" value={b.key} placeholder={t("dash.auto.f.key")} onChange={(e) => up({ key: keyClean(e.target.value) })} />
            <select className="input w-auto" value={b.style} onChange={(e) => up({ style: e.target.value as typeof b.style })}>
              {(["primary", "secondary", "success", "danger"] as const).map((s) => <option key={s} value={s}>{t(`dash.buttonStyles.${s}`)}</option>)}
            </select>
            <button type="button" className="p-1 text-muted hover:text-red-300" onClick={() => onChange(value.filter((_, j) => j !== i))}><X className="size-3.5" /></button>
          </div>
        );
      })}
      {value.length < 5 && (
        <Button size="sm" icon={<Plus className="size-4" />} onClick={() => onChange([...value, { key: "", label: "", style: "primary", emoji: "" }])}>
          {t("dash.auto.f.addButton")}
        </Button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ panel post */

/**
 * For button/menu rules: compose and post the message that carries the button or menu.
 * The key is taken from the trigger so it always matches.
 */
function PanelComposer({ rule }: { rule: Rule }) {
  const g = useGuild();
  const { t } = useT();
  const toast = useToast();
  const isSelect = rule.trigger.type === "select_chosen";
  const key = rule.trigger.type === "button_clicked" || rule.trigger.type === "select_chosen" ? rule.trigger.key : "";
  const mappingValues = rule.actions.flatMap((a) => (a.type === "roles_from_select" ? a.mapping.map((m) => m.value).filter(Boolean) : []));
  const [open, setOpen] = useState(false);
  const [channelId, setChannelId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [button, setButton] = useState({ label: "", emoji: "", style: "success" as const as "primary" | "secondary" | "success" | "danger" });
  const [options, setOptions] = useState<{ label: string; value: string; emoji: string }[]>([]);
  const [maxPick, setMaxPick] = useState(1);
  const opts = options.length ? options : mappingValues.map((v) => ({ label: v, value: v, emoji: "" }));
  const post = useMutation({
    mutationFn: () =>
      api<{ url: string }>(`/guilds/${g.id}/automations/panel`, {
        method: "POST",
        json: {
          channelId,
          content: title || text ? "" : "​",
          embed: title || text ? { title, description: text, color: g.modules.branding.config.color } : null,
          buttons: isSelect ? [] : [{ key, label: button.label || key, style: button.style, emoji: button.emoji }],
          select: isSelect ? { key, placeholder: "", min: 0, max: Math.min(maxPick, opts.length), options: opts.map((o) => ({ ...o, description: "" })) } : null,
        },
      }),
    onSuccess: () => toast(t("dash.auto.panel.posted")),
    onError: (e: Error) => toast(e.message, "bad"),
  });
  const ready = !!channelId && !!key && (isSelect ? opts.length > 0 && opts.every((o) => o.label && o.value) : true);

  if (!open)
    return (
      <button type="button" className="flex items-center gap-2 text-sm text-accent-2 hover:underline" onClick={() => setOpen(true)}>
        <Send className="size-4" /> {t(isSelect ? "dash.auto.panel.openSelect" : "dash.auto.panel.openButton")}
      </button>
    );
  return (
    <div className="space-y-2 rounded-md border border-accent/30 bg-accent/5 p-3">
      <div className="text-sm font-medium">{t(isSelect ? "dash.auto.panel.openSelect" : "dash.auto.panel.openButton")}</div>
      <p className="hint">{t("dash.auto.panel.hint")}</p>
      <ChannelSelect value={channelId} onChange={setChannelId} clearable={false} />
      <input className="input" value={title} maxLength={256} placeholder={t("dash.rr.titleLabel")} onChange={(e) => setTitle(e.target.value)} />
      <textarea className="input" rows={2} value={text} placeholder={t("dash.common.description")} onChange={(e) => setText(e.target.value)} />
      {isSelect ? (
        <>
          {opts.map((o, i) => (
            <div key={i} className="flex items-center gap-2">
              <input className="input w-16" value={o.emoji} placeholder="🛡️" onChange={(e) => setOptions(opts.map((x, j) => (j === i ? { ...x, emoji: e.target.value.trim() } : x)))} />
              <input className="input flex-1" value={o.label} placeholder={t("dash.auto.panel.optionLabel")} onChange={(e) => setOptions(opts.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
              <input className="input w-32 font-mono" value={o.value} placeholder={t("dash.auto.panel.optionValue")} onChange={(e) => setOptions(opts.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
              <button type="button" className="p-1 text-muted hover:text-red-300" onClick={() => setOptions(opts.filter((_, j) => j !== i))}><X className="size-3.5" /></button>
            </div>
          ))}
          <Inline>
            {opts.length < 25 && <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setOptions([...opts, { label: "", value: "", emoji: "" }])}>{t("dash.common.add")}</Button>}
            <span className="ml-auto">{t("dash.auto.panel.maxPick")}</span>
            <NumberInput value={maxPick} onChange={setMaxPick} min={1} max={25} />
          </Inline>
          {mappingValues.length > 0 && <p className="hint">{t("dash.auto.panel.fromMapping")}</p>}
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <input className="input w-16" value={button.emoji} placeholder="✅" onChange={(e) => setButton({ ...button, emoji: e.target.value.trim() })} />
          <input className="input w-48" value={button.label} maxLength={80} placeholder={t("dash.auto.f.buttonLabel")} onChange={(e) => setButton({ ...button, label: e.target.value })} />
          <select className="input w-auto" value={button.style} onChange={(e) => setButton({ ...button, style: e.target.value as typeof button.style })}>
            {(["primary", "secondary", "success", "danger"] as const).map((s) => <option key={s} value={s}>{t(`dash.buttonStyles.${s}`)}</option>)}
          </select>
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>{t("dash.common.cancel")}</Button>
        <Button variant="primary" size="sm" icon={<Send className="size-4" />} disabled={!ready} loading={post.isPending} onClick={() => post.mutate()}>{t("dash.auto.panel.post")}</Button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- simulator */

function Simulator({ rule }: { rule: Rule }) {
  const g = useGuild();
  const { t } = useT();
  const [userId, setUserId] = useState("");
  const [content, setContent] = useState("");
  const [values, setValues] = useState<string[]>([]);
  const sim = useMutation({
    mutationFn: () =>
      api<{ pass: boolean; conditions: { type: Condition["type"]; pass: boolean }[]; warnings: { index: number; code: string; params?: Record<string, string> }[] }>(
        `/guilds/${g.id}/automations/simulate`,
        { method: "POST", json: { rule: { ...rule, id: undefined, runCount: undefined, lastRunAt: undefined, name: rule.name || "x" }, userId: userId.trim(), content, values } },
      ),
  });
  const needsText = rule.conditions.some((c) => c.type === "message_contains" || c.type === "message_regex");
  const needsValues = rule.conditions.some((c) => c.type === "selected");
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">{t("dash.auto.sim.intro")}</p>
      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <Field label={t("dash.auto.sim.userId")} hint={t("dash.auto.sim.userIdHint")}>
          <input className="input font-mono" value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="123456789012345678" />
        </Field>
        <Button variant="primary" icon={<FlaskConical className="size-4" />} disabled={!/^\d{15,22}$/.test(userId.trim())} loading={sim.isPending} onClick={() => sim.mutate()}>
          {t("dash.auto.sim.run")}
        </Button>
      </div>
      {needsText && <Field label={t("dash.auto.sim.message")}><input className="input" value={content} onChange={(e) => setContent(e.target.value)} /></Field>}
      {needsValues && <Field label={t("dash.auto.sim.values")}><TagInput value={values} onChange={setValues} /></Field>}
      {sim.error && <p className="text-sm text-red-300">{(sim.error as Error).message}</p>}
      {sim.data && (
        <div className="space-y-3 rounded-lg border border-line p-4">
          <div className={clsx("flex items-center gap-2 font-medium", sim.data.pass ? "text-emerald-300" : "text-amber-300")}>
            {sim.data.pass ? <Check className="size-4" /> : <X className="size-4" />}
            {sim.data.pass ? t("dash.auto.sim.wouldRun") : t("dash.auto.sim.wouldSkip")}
          </div>
          {sim.data.conditions.length > 0 && (
            <ul className="space-y-1 text-sm">
              {sim.data.conditions.map((c, i) => (
                <li key={i} className="flex items-center gap-2">
                  {c.pass ? <Check className="size-3.5 text-emerald-300" /> : <X className="size-3.5 text-red-300" />}
                  {t(`dash.auto.conditions.${c.type}`)}
                </li>
              ))}
            </ul>
          )}
          {sim.data.pass && (
            <ol className="list-decimal space-y-1 pl-5 text-sm">
              {rule.actions.map((a, i) => {
                const w = sim.data!.warnings.filter((x) => x.index === i);
                return (
                  <li key={i}>
                    {t(`dash.auto.actions.${a.type}`)}
                    {w.map((x, k) => <span key={k} className="ml-2 text-amber-300">⚠ {tr(x.code as never, x.params)}</span>)}
                  </li>
                );
              })}
            </ol>
          )}
          <p className="hint">{t("dash.auto.sim.nothingDone")}</p>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- run log */

function RunLog({ rules, filter, setFilter }: { rules: Rule[]; filter: number | null; setFilter: (v: number | null) => void }) {
  const g = useGuild();
  const { t } = useT();
  const runs = useQuery({
    queryKey: ["automation-runs", g.id, filter],
    queryFn: () => api<Run[]>(`/guilds/${g.id}/automation-runs${filter ? `?automationId=${filter}` : ""}`),
    refetchInterval: 15000,
  });
  const name = (id: number) => {
    const r = rules.find((x) => x.id === id);
    return r ? r.name || summarizeTrigger(r.trigger) : `#${id}`;
  };
  const member = (id: string | null) => (id ? `…${id.slice(-5)}` : "—");
  return (
    <Card
      padded={false}
      title={t("dash.auto.runLog")}
      description={t("dash.auto.runLogHint")}
      actions={
        <select className="input w-auto" value={filter ?? ""} onChange={(e) => setFilter(e.target.value ? Number(e.target.value) : null)}>
          <option value="">{t("dash.auto.allRules")}</option>
          {rules.map((r) => <option key={r.id} value={r.id}>{r.name || summarizeTrigger(r.trigger)}</option>)}
        </select>
      }
    >
      {runs.isLoading ? (
        <div className="grid h-24 place-items-center"><Spinner /></div>
      ) : !runs.data?.length ? (
        <Empty icon={<History className="size-5" />} title={t("dash.auto.noRuns")} />
      ) : (
        <ul className="divide-y divide-line text-sm">
          {runs.data.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2">
              <Badge tone={statusTone[r.status]}>{t(`dash.auto.status.${r.status}`)}</Badge>
              <span className="font-medium">{name(r.automationId)}</span>
              <span className="font-mono text-xs text-muted" title={r.userId ?? undefined}>{member(r.userId)}</span>
              <span className="min-w-0 flex-1 truncate text-muted">{runDetail(r)}</span>
              <span className="text-xs text-muted" title={fmtDateTime(r.createdAt)}>{timeAgo(r.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function runDetail(r: Run): string {
  if (r.reason === "conditions") {
    const failed = r.detail.conditions?.filter((c) => !c.pass).map((c) => tr(`dash.auto.conditions.${c.type}`)) ?? [];
    return tr("dash.auto.reasons.conditions", { list: failed.join(", ") });
  }
  if (r.reason === "loop" || r.reason === "rate") return tr(`dash.auto.reasons.${r.reason}`);
  if (r.reason) return r.reason;
  const bad = r.detail.actions?.filter((a) => !a.ok && !a.skipped) ?? [];
  if (bad.length) return bad.map((a) => `${tr(`dash.auto.actions.${a.type}`)}: ${a.error ? tr(a.error as never) : "?"}`).join(" · ");
  return r.detail.actions?.map((a) => tr(`dash.auto.actions.${a.type}`)).join(" → ") ?? "";
}
