import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Hash, LayoutTemplate, Pencil, Plus, Trash2 } from "lucide-react";
import { api, timeAgo } from "../lib/api";
import { useGuild, useModuleForm } from "../lib/guild";
import { ModuleShell } from "../components/ModuleShell";
import { Badge, Button, Card, ChannelSelect, Empty, Field, Modal, Spinner, useToast } from "../components/ui";
import { MessageDesigner, blankDesign, mediaUrl, type Design } from "../components/MessageDesigner";
import { useT } from "../lib/i18n";

interface EmbedMsg {
  id?: number;
  name: string;
  channelId: string;
  messageId?: string | null;
  design: Design;
  updatedAt?: string;
}

export function Embeds() {
  const f = useModuleForm("embeds");
  const g = useGuild();
  const { t } = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = useState<EmbedMsg | null>(null);
  const list = useQuery({ queryKey: ["embeds", g.id], queryFn: () => api<EmbedMsg[]>(`/guilds/${g.id}/embeds`) });
  const inval = () => void qc.invalidateQueries({ queryKey: ["embeds", g.id] });
  const save = useMutation({
    mutationFn: (m: EmbedMsg) => {
      const body = { name: m.name, channelId: m.channelId, design: m.design };
      return m.id ? api(`/guilds/${g.id}/embeds/${m.id}`, { method: "PUT", json: body }) : api(`/guilds/${g.id}/embeds`, { method: "POST", json: body });
    },
    onSuccess: (_r, m) => {
      toast(t(m.id ? "dash.embeds.updated" : "dash.embeds.posted"));
      setDraft(null);
      inval();
    },
    onError: (e: Error) => toast(e.message, "bad"),
  });
  const del = useMutation({
    mutationFn: ({ id, keep }: { id: number; keep: boolean }) => api(`/guilds/${g.id}/embeds/${id}${keep ? "?keepMessage=1" : ""}`, { method: "DELETE" }),
    onSuccess: inval,
  });
  const chan = (id: string) => g.channels.find((c) => c.id === id)?.name ?? t("dash.common.unknownChannel");
  const vars = [
    { key: "server", label: t("dash.vars.server") },
    { key: "membercount", label: t("dash.vars.membercount") },
  ];

  return (
    <ModuleShell
      title={t("dash.nav.embeds")}
      icon={<LayoutTemplate className="size-5" />}
      description={t("dash.embeds.description")}
      form={f}
      actions={
        <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setDraft({ name: "", channelId: "", design: { ...blankDesign(), embed: { ...blankDesign().embed, enabled: true } } })}>
          {t("dash.embeds.new")}
        </Button>
      }
    >
      <Card padded={false}>
        {list.isLoading ? (
          <div className="grid h-32 place-items-center"><Spinner /></div>
        ) : !list.data?.length ? (
          <Empty icon={<LayoutTemplate className="size-5" />} title={t("dash.embeds.emptyTitle")}>{t("dash.embeds.emptyBody")}</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {list.data.map((m) => {
              const e = m.design.embed;
              return (
                <li key={m.id} className="flex items-center gap-4 px-5 py-3">
                  <div className="h-10 w-1 shrink-0 rounded" style={{ background: e.enabled ? (e.color ?? g.modules.branding.config.color) : "transparent" }} />
                  {m.design.image.mediaId && <img src={mediaUrl(g.id, m.design.image.mediaId)} alt="" className="h-10 w-16 shrink-0 rounded object-cover" />}
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setDraft(m)}>
                    <div className="truncate font-medium">{m.name || e.title || m.design.message.slice(0, 60) || t("dash.embeds.untitled")}</div>
                    <div className="flex items-center gap-1 text-sm text-muted">
                      <Hash className="size-3" /> {chan(m.channelId)}
                      {!m.messageId && <Badge tone="warn">{t("dash.rr.notPublished")}</Badge>}
                    </div>
                  </button>
                  <span className="hidden text-xs text-muted sm:block">{timeAgo(m.updatedAt)}</span>
                  <Button variant="ghost" size="sm" title={t("dash.auto.duplicate")} onClick={() => setDraft({ ...m, id: undefined, messageId: null, name: m.name ? `${m.name} (2)` : "" })}><Copy className="size-4" /></Button>
                  <Button variant="ghost" size="sm" onClick={() => setDraft(m)}><Pencil className="size-4" /></Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      if (!confirm(t("dash.embeds.confirmDelete"))) return;
                      del.mutate({ id: m.id!, keep: !confirm(t("dash.embeds.alsoDeleteMessage")) });
                    }}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {draft && (
        <Modal
          open
          wide="xl"
          onClose={() => setDraft(null)}
          title={draft.id ? t("dash.embeds.editTitle") : t("dash.embeds.new")}
          footer={
            <>
              <Button variant="ghost" onClick={() => setDraft(null)}>{t("dash.common.cancel")}</Button>
              <Button variant="primary" loading={save.isPending} disabled={!draft.channelId} onClick={() => save.mutate(draft)}>
                {draft.id ? t("dash.rr.saveUpdate") : t("dash.embeds.post")}
              </Button>
            </>
          }
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("dash.embeds.name")} hint={t("dash.embeds.nameHint")}>
              <input className="input" value={draft.name} maxLength={100} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </Field>
            <Field label={t("dash.common.channel")} hint={draft.id ? t("dash.embeds.moveHint") : undefined}>
              <ChannelSelect value={draft.channelId || null} onChange={(v) => setDraft({ ...draft, channelId: v ?? "" })} clearable={false} />
            </Field>
          </div>
          <MessageDesigner value={draft.design} onChange={(design) => setDraft({ ...draft, design })} vars={vars} withMember={false} />
        </Modal>
      )}
    </ModuleShell>
  );
}
