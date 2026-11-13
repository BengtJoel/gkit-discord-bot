import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Hash, Pencil, Plus, SmilePlus, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { useGuild, useModuleForm } from "../lib/guild";
import { ModuleShell } from "../components/ModuleShell";
import { Badge, Button, Card, ChannelSelect, Empty, Field, Modal, RoleSelect, Segmented, Spinner, useToast } from "../components/ui";
import { useT, tr } from "../lib/i18n";

interface Entry {
  emoji: string;
  roleId: string;
  label?: string;
}
interface RR {
  id: number;
  channelId: string;
  messageId: string | null;
  title: string;
  description: string;
  color: string;
  mode: "normal" | "unique" | "verify";
  entries: Entry[];
}
type Draft = Omit<RR, "id"> & { id?: number };


export function ReactionRoles() {
  const f = useModuleForm("reactionRoles");
  const g = useGuild();
  const { t } = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = useState<Draft | null>(null);
  const list = useQuery({ queryKey: ["rr", g.id], queryFn: () => api<RR[]>(`/guilds/${g.id}/reaction-roles`) });

  const save = useMutation({
    mutationFn: (d: Draft) =>
      d.id
        ? api<RR & { warning?: string }>(`/guilds/${g.id}/reaction-roles/${d.id}`, { method: "PUT", json: d })
        : api<RR & { warning?: string }>(`/guilds/${g.id}/reaction-roles`, { method: "POST", json: d }),
    onSuccess: (r) => {
      if (r.warning) toast(t("dash.rr.savedBut", { problem: tr(r.warning) }), "bad");
      else toast(t("dash.rr.published"));
      setDraft(null);
      void qc.invalidateQueries({ queryKey: ["rr", g.id] });
    },
    onError: (e: Error) => toast(e.message, "bad"),
  });
  const del = useMutation({
    mutationFn: (id: number) => api(`/guilds/${g.id}/reaction-roles/${id}`, { method: "DELETE" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["rr", g.id] }),
  });

  const chan = (id: string) => g.channels.find((c) => c.id === id)?.name ?? t("dash.common.unknownChannel");
  const role = (id: string) => g.roles.find((r) => r.id === id);

  return (
    <ModuleShell
      title={t("dash.nav.reactionRoles")}
      icon={<SmilePlus className="size-5" />}
      description={t("dash.rr.description")}
      form={f}
      actions={
        <Button
          variant="primary"
          icon={<Plus className="size-4" />}
          onClick={() => setDraft({ channelId: "", messageId: null, title: "", description: "", color: "#8b5cf6", mode: "normal", entries: [{ emoji: "", roleId: "" }] })}
        >
          {t("dash.rr.new")}
        </Button>
      }
    >
      {list.isLoading ? (
        <div className="grid h-40 place-items-center"><Spinner /></div>
      ) : !list.data?.length ? (
        <Card>
          <Empty icon={<SmilePlus className="size-5" />} title={t("dash.rr.emptyTitle")}>{t("dash.rr.emptyBody")}</Empty>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {list.data.map((r) => (
            <div key={r.id} className="card overflow-hidden">
              <div className="flex">
                <div className="w-1 shrink-0" style={{ background: r.color }} />
                <div className="flex-1 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold">{r.title || t("defaults.reactionRolesTitle")}</div>
                      <div className="mt-0.5 flex items-center gap-1 text-xs text-muted">
                        <Hash className="size-3" />
                        {chan(r.channelId)} · {t(`dash.rr.modes.${r.mode}`)}
                        {!r.messageId && <Badge tone="warn">{t("dash.rr.notPublished")}</Badge>}
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setDraft(r)}>
                        <Pencil className="size-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => confirm(t("dash.rr.confirmDelete")) && del.mutate(r.id)}>
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {r.entries.map((e) => (
                      <span key={e.roleId + e.emoji} className="inline-flex items-center gap-1.5 rounded-md border border-line-2 bg-panel-2 px-2 py-1 text-xs">
                        <EmojiView emoji={e.emoji} />
                        <span style={{ color: role(e.roleId)?.color !== "#000000" ? role(e.roleId)?.color : undefined }}>{role(e.roleId)?.name ?? t("dash.common.unknownRole")}</span>
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {draft && <Editor draft={draft} setDraft={setDraft} onSave={() => save.mutate(draft)} saving={save.isPending} />}
    </ModuleShell>
  );
}

function EmojiView({ emoji }: { emoji: string }) {
  const m = emoji.match(/<(a?):\w+:(\d+)>/);
  if (m) return <img src={`https://cdn.discordapp.com/emojis/${m[2]}.${m[1] ? "gif" : "webp"}?size=32`} className="size-4" alt="" />;
  return <span>{emoji || "?"}</span>;
}

function Editor({ draft, setDraft, onSave, saving }: { draft: Draft; setDraft: (d: Draft | null) => void; onSave: () => void; saving: boolean }) {
  const g = useGuild();
  const { t } = useT();
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft({ ...draft, [k]: v });
  const setEntry = (i: number, e: Partial<Entry>) => set("entries", draft.entries.map((x, j) => (j === i ? { ...x, ...e } : x)));
  const valid = draft.channelId && draft.entries.length > 0 && draft.entries.every((e) => e.emoji && e.roleId);

  return (
    <Modal
      open
      wide
      onClose={() => setDraft(null)}
      title={draft.id ? t("dash.rr.editTitle") : t("dash.rr.newTitle")}
      footer={
        <>
          <Button variant="ghost" onClick={() => setDraft(null)}>{t("dash.common.cancel")}</Button>
          <Button variant="primary" disabled={!valid} loading={saving} onClick={onSave}>
            {draft.id ? t("dash.rr.saveUpdate") : t("dash.rr.publish")}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("dash.common.channel")}>
          <ChannelSelect value={draft.channelId || null} onChange={(v) => set("channelId", v ?? "")} clearable={false} />
        </Field>
        <Field label={t("dash.rr.mode")}>
          <Segmented
            value={draft.mode}
            onChange={(v) => set("mode", v)}
            options={[
              { value: "normal", label: t("dash.rr.modes.normal") },
              { value: "unique", label: t("dash.rr.modes.unique") },
              { value: "verify", label: t("dash.rr.modes.verify") },
            ]}
          />
          <p className="hint">{t(`dash.rr.modeHints.${draft.mode}`)}</p>
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
        <Field label={t("dash.rr.titleLabel")}>
          <input className="input" value={draft.title} placeholder={t("defaults.reactionRolesTitle")} onChange={(e) => set("title", e.target.value)} maxLength={256} />
        </Field>
        <Field label={t("dash.rr.color")}>
          <input type="color" className="h-9 w-14 cursor-pointer rounded-md border border-line bg-panel-2 p-1" value={draft.color} onChange={(e) => set("color", e.target.value)} />
        </Field>
      </div>
      <Field label={t("dash.common.description")} hint={t("dash.rr.descriptionHint")}>
        <textarea className="input" rows={3} value={draft.description} onChange={(e) => set("description", e.target.value)} />
      </Field>

      <div>
        <div className="label">{t("dash.rr.entries")}</div>
        <div className="space-y-2">
          {draft.entries.map((e, i) => (
            <div key={i} className="flex items-center gap-2">
              <EmojiInput value={e.emoji} onChange={(emoji) => setEntry(i, { emoji })} />
              <div className="flex-1">
                <RoleSelect value={e.roleId || null} onChange={(roleId) => setEntry(i, { roleId })} />
              </div>
              <input className="input w-40" placeholder={t("dash.rr.labelOptional")} value={e.label ?? ""} onChange={(ev) => setEntry(i, { label: ev.target.value || undefined })} />
              <Button variant="ghost" size="sm" onClick={() => set("entries", draft.entries.filter((_, j) => j !== i))}>
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
        </div>
        {draft.entries.length < 20 && (
          <Button size="sm" className="mt-2" icon={<Plus className="size-4" />} onClick={() => set("entries", [...draft.entries, { emoji: "", roleId: "" }])}>
            {t("dash.rr.addRow")}
          </Button>
        )}
      </div>

      <details className="rounded-lg border border-line px-4 py-3 text-sm">
        <summary className="cursor-pointer font-medium">{t("dash.rr.attachTitle")}</summary>
        <p className="mt-2 text-muted">
          {t("dash.rr.attachBody")}
        </p>
        <input className="input mt-2 font-mono" placeholder="123456789012345678" value={draft.messageId ?? ""} onChange={(e) => set("messageId", e.target.value.trim() || null)} />
      </details>
      {g.emojis.length === 0 && <p className="text-xs text-muted">{t("dash.rr.emojiTip")}</p>}
    </Modal>
  );
}

function EmojiInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const g = useGuild();
  const { t } = useT();
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen(!open)} className="grid size-9 place-items-center rounded-md border border-line bg-panel-2 text-lg hover:border-line-2">
        {value ? <EmojiView emoji={value} /> : <SmilePlus className="size-4 text-muted" />}
      </button>
      {open && (
        <div className="absolute z-40 mt-1 w-72 rounded-lg border border-line-2 bg-panel p-3 shadow-2xl">
          <input
            autoFocus
            className="input"
            placeholder={t("dash.rr.emojiPlaceholder")}
            defaultValue={value.startsWith("<") ? "" : value}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                onChange((e.target as HTMLInputElement).value.trim());
                setOpen(false);
              }
            }}
            onBlur={(e) => e.target.value.trim() && onChange(e.target.value.trim())}
          />
          <div className="mt-2 flex flex-wrap gap-1">
            {["✅", "🔥", "⚔️", "🛡️", "❤️", "🎮", "🎉", "📢", "🧙", "🏹"].map((em) => (
              <button key={em} type="button" className="grid size-8 place-items-center rounded hover:bg-panel-2" onClick={() => { onChange(em); setOpen(false); }}>
                {em}
              </button>
            ))}
          </div>
          {g.emojis.length > 0 && (
            <>
              <div className="mt-2 mb-1 text-[11px] font-semibold text-faint uppercase">{t("dash.rr.serverEmojis")}</div>
              <div className="flex max-h-40 flex-wrap gap-1 overflow-y-auto">
                {g.emojis.map((em) => (
                  <button key={em.id} type="button" title={em.name} className="grid size-8 place-items-center rounded hover:bg-panel-2" onClick={() => { onChange(em.tag); setOpen(false); }}>
                    <EmojiView emoji={em.tag} />
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
