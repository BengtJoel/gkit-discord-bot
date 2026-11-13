import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Gavel, Plus, Search, Trash2 } from "lucide-react";
import { api, fmtDateTime } from "../lib/api";
import { useGuild, useModuleForm } from "../lib/guild";
import { ModuleShell } from "../components/ModuleShell";
import { Badge, Button, Card, ChannelSelect, Empty, Field, NumberInput, Select, Spinner, Toggle } from "../components/ui";

interface Case {
  id: number;
  caseNumber: number;
  userId: string;
  userTag: string;
  moderatorTag: string;
  action: string;
  reason: string;
  durationSeconds: number | null;
  createdAt: string;
}
const ACTION: Record<string, { label: string; tone: "warn" | "bad" | "ok" | "accent" | "neutral" }> = {
  warn: { label: "Varning", tone: "warn" },
  automod: { label: "Automod", tone: "accent" },
  timeout: { label: "Timeout", tone: "warn" },
  kick: { label: "Kick", tone: "bad" },
  ban: { label: "Ban", tone: "bad" },
  unban: { label: "Unban", tone: "ok" },
};

export function Moderation() {
  const f = useModuleForm("moderation");
  const d = f.draft;
  return (
    <ModuleShell
      title="Moderering"
      icon={<Gavel className="size-5" />}
      description={
        <>
          Kommandon: <span className="kbd">/warn</span> <span className="kbd">/timeout</span> <span className="kbd">/kick</span> <span className="kbd">/ban</span>{" "}
          <span className="kbd">/unban</span> <span className="kbd">/purge</span> <span className="kbd">/cases</span>. Alla åtgärder loggas som ärenden.
        </>
      }
      form={f}
    >
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Logg och notiser">
          <div className="space-y-4">
            <Field label="Moderationslogg" hint="Alla ärenden (även automod) postas här.">
              <ChannelSelect value={d.logChannelId} onChange={(v) => f.update("logChannelId", v)} />
            </Field>
            <div className="flex items-center justify-between rounded-lg border border-line px-4 py-3">
              <div>
                <div className="text-sm font-medium">Skicka DM till användaren</div>
                <div className="text-[13px] text-muted">Berätta vad som hände och varför.</div>
              </div>
              <Toggle checked={d.dmOnAction} onChange={(v) => f.update("dmOnAction", v)} />
            </div>
          </div>
        </Card>
        <Card
          title="Automatisk eskalering"
          description="Vad som händer när någon når ett visst antal varningar."
          actions={
            <Button size="sm" icon={<Plus className="size-4" />} onClick={() => f.update("warnThresholds", [...d.warnThresholds, { count: (d.warnThresholds.at(-1)?.count ?? 0) + 3, action: "timeout", durationMinutes: 60 }])}>
              Lägg till
            </Button>
          }
        >
          {d.warnThresholds.length === 0 ? (
            <p className="text-sm text-muted">Ingen eskalering.</p>
          ) : (
            <div className="space-y-2">
              {d.warnThresholds.map((t, i) => {
                const upd = (p: Partial<typeof t>) => f.update("warnThresholds", d.warnThresholds.map((x, j) => (j === i ? { ...x, ...p } : x)));
                return (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <span className="text-muted">Vid</span>
                    <div className="w-20"><NumberInput value={t.count} min={1} onChange={(count) => upd({ count })} /></div>
                    <span className="text-muted">varningar →</span>
                    <div className="w-32">
                      <Select value={t.action} onChange={(action) => upd({ action })} options={[{ value: "timeout", label: "Timeout" }, { value: "kick", label: "Kick" }, { value: "ban", label: "Ban" }]} />
                    </div>
                    {t.action === "timeout" && <div className="w-28"><NumberInput value={t.durationMinutes} min={1} onChange={(durationMinutes) => upd({ durationMinutes })} suffix="min" /></div>}
                    <Button variant="ghost" size="sm" onClick={() => f.update("warnThresholds", d.warnThresholds.filter((_, j) => j !== i))}>
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>
      <Cases />
    </ModuleShell>
  );
}

function Cases() {
  const g = useGuild();
  const qc = useQueryClient();
  const [user, setUser] = useState("");
  const [action, setAction] = useState("");
  const q = useQuery({
    queryKey: ["cases", g.id, user, action],
    queryFn: () => api<{ rows: Case[] }>(`/guilds/${g.id}/cases?userId=${encodeURIComponent(user)}&action=${action}`),
  });
  const del = useMutation({
    mutationFn: (id: number) => api(`/guilds/${g.id}/cases/${id}`, { method: "DELETE" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["cases", g.id] }),
  });
  return (
    <Card
      title="Ärenden"
      padded={false}
      actions={
        <div className="flex gap-2">
          <div className="relative w-48">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
            <input className="input h-8 pl-9" placeholder="Användare…" value={user} onChange={(e) => setUser(e.target.value)} />
          </div>
          <div className="w-36">
            <Select value={action} onChange={setAction} options={[{ value: "", label: "Alla typer" }, ...Object.entries(ACTION).map(([value, a]) => ({ value, label: a.label }))]} />
          </div>
        </div>
      }
    >
      {q.isLoading ? (
        <div className="grid h-32 place-items-center"><Spinner /></div>
      ) : !q.data?.rows.length ? (
        <Empty icon={<Gavel className="size-5" />} title="Inga ärenden" />
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted">
              <th className="px-5 py-2 font-medium">#</th>
              <th className="px-3 py-2 font-medium">Typ</th>
              <th className="px-3 py-2 font-medium">Användare</th>
              <th className="px-3 py-2 font-medium">Anledning</th>
              <th className="px-3 py-2 font-medium">Moderator</th>
              <th className="px-3 py-2 font-medium">Datum</th>
              <th />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {q.data.rows.map((c) => (
              <tr key={c.id} className="group">
                <td className="px-5 py-2.5 text-muted tabular-nums">{c.caseNumber}</td>
                <td className="px-3 py-2.5"><Badge tone={ACTION[c.action]?.tone ?? "neutral"}>{ACTION[c.action]?.label ?? c.action}</Badge></td>
                <td className="px-3 py-2.5">{c.userTag || c.userId}</td>
                <td className="max-w-xs truncate px-3 py-2.5 text-muted" title={c.reason}>{c.reason || "—"}</td>
                <td className="px-3 py-2.5 text-muted">{c.moderatorTag}</td>
                <td className="px-3 py-2.5 whitespace-nowrap text-muted">{fmtDateTime(c.createdAt)}</td>
                <td className="px-3 py-2.5 text-right">
                  <Button variant="ghost" size="sm" className="opacity-0 group-hover:opacity-100" title="Ta bort ärendet (räknas inte längre som varning)" onClick={() => del.mutate(c.id)}>
                    <Trash2 className="size-4" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
