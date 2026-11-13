import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Pencil, Plus, Search, Trash2, TrendingUp, Download } from "lucide-react";
import { api, avatarUrl, fmtNum } from "../lib/api";
import { useGuild, useModuleForm } from "../lib/guild";
import { ModuleShell } from "../components/ModuleShell";
import {
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
  TemplateInput,
  Toggle,
  useToast,
} from "../components/ui";

interface LbRow {
  userId: string;
  username: string;
  avatar: string | null;
  xp: number;
  rank: number;
  level: number;
  current: number;
  needed: number;
  messageCount: number;
}

export function Levels() {
  const f = useModuleForm("levels");
  const d = f.draft;
  return (
    <ModuleShell
      title="Levels"
      icon={<TrendingUp className="size-5" />}
      description="Medlemmar får XP när de skriver och går upp i level. Samma kurva som MEE6, så importerad XP ger exakt samma levels."
      form={f}
      actions={
        <Link to="../import">
          <Button icon={<Download className="size-4" />}>Importera från MEE6</Button>
        </Link>
      }
    >
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="XP per meddelande" description="Slumpas mellan min och max, max en gång per cooldown.">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Min XP">
              <NumberInput value={d.xpMin} onChange={(v) => f.update("xpMin", v)} min={0} max={1000} />
            </Field>
            <Field label="Max XP">
              <NumberInput value={d.xpMax} onChange={(v) => f.update("xpMax", v)} min={0} max={1000} />
            </Field>
            <Field label="Cooldown">
              <NumberInput value={d.cooldownSeconds} onChange={(v) => f.update("cooldownSeconds", v)} min={0} max={3600} suffix="sek" />
            </Field>
            <Field label="Multiplikator" hint="1 = normalt, 2 = dubbel XP">
              <NumberInput value={d.multiplier} onChange={(v) => f.update("multiplier", v)} min={0} max={10} step={0.1} suffix="×" />
            </Field>
          </div>
        </Card>

        <Card title="Level up-meddelande">
          <div className="space-y-4">
            <Segmented
              value={d.announce.mode}
              onChange={(mode) => f.update("announce", { ...d.announce, mode })}
              options={[
                { value: "current", label: "Samma kanal" },
                { value: "channel", label: "Egen kanal" },
                { value: "dm", label: "DM" },
                { value: "off", label: "Av" },
              ]}
            />
            {d.announce.mode === "channel" && (
              <ChannelSelect value={d.announce.channelId} onChange={(channelId) => f.update("announce", { ...d.announce, channelId })} />
            )}
            {d.announce.mode !== "off" && (
              <TemplateInput
                value={d.announce.message}
                onChange={(message) => f.update("announce", { ...d.announce, message })}
                variables={[
                  { key: "user", label: "Nämner användaren" },
                  { key: "username", label: "Användarnamn" },
                  { key: "level", label: "Ny level" },
                  { key: "server", label: "Servernamn" },
                ]}
              />
            )}
          </div>
        </Card>
      </div>

      <Card
        title="Rollbelöningar"
        description="Roller som delas ut automatiskt vid en viss level."
        actions={
          <Button size="sm" icon={<Plus className="size-4" />} onClick={() => f.update("roleRewards", [...d.roleRewards, { level: (d.roleRewards.at(-1)?.level ?? 0) + 5, roleId: "" }])}>
            Lägg till
          </Button>
        }
      >
        {d.roleRewards.length === 0 ? (
          <p className="text-sm text-muted">Inga belöningar ännu.</p>
        ) : (
          <div className="space-y-2">
            {d.roleRewards.map((r, i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="text-sm text-muted">Level</span>
                <div className="w-24">
                  <NumberInput value={r.level} min={1} onChange={(level) => f.update("roleRewards", d.roleRewards.map((x, j) => (j === i ? { ...x, level } : x)))} />
                </div>
                <span className="text-sm text-muted">→</span>
                <div className="flex-1">
                  <RoleSelect value={r.roleId || null} onChange={(roleId) => f.update("roleRewards", d.roleRewards.map((x, j) => (j === i ? { ...x, roleId } : x)))} />
                </div>
                <Button variant="ghost" size="sm" onClick={() => f.update("roleRewards", d.roleRewards.filter((_, j) => j !== i))}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
        <div className="mt-5 flex items-center justify-between rounded-lg border border-line px-4 py-3">
          <div>
            <div className="text-sm font-medium">Behåll tidigare belöningar</div>
            <div className="text-[13px] text-muted">Av = medlemmen har bara den högsta belöningsrollen.</div>
          </div>
          <Toggle checked={d.stackRewards} onChange={(v) => f.update("stackRewards", v)} />
        </div>
      </Card>

      <Card title="Undantag" description="Ingen XP i dessa kanaler eller för dessa roller.">
        <div className="grid gap-4 lg:grid-cols-2">
          <Field label="Kanaler utan XP">
            <ChannelMultiSelect value={d.noXpChannelIds} onChange={(v) => f.update("noXpChannelIds", v)} />
          </Field>
          <Field label="Roller utan XP">
            <RoleMultiSelect value={d.noXpRoleIds} onChange={(v) => f.update("noXpRoleIds", v)} />
          </Field>
        </div>
      </Card>

      <Leaderboard />
    </ModuleShell>
  );
}

function Leaderboard() {
  const g = useGuild();
  const qc = useQueryClient();
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [edit, setEdit] = useState<LbRow | null>(null);
  const [editLevel, setEditLevel] = useState(0);
  const [confirmReset, setConfirmReset] = useState(false);
  const q = useQuery({
    queryKey: ["levels", g.id, search, page],
    queryFn: () => api<{ total: number; rows: LbRow[] }>(`/guilds/${g.id}/levels?page=${page}&search=${encodeURIComponent(search)}`),
    placeholderData: (p) => p,
  });
  const save = useMutation({
    mutationFn: () => api(`/guilds/${g.id}/levels/${edit!.userId}`, { method: "PATCH", json: { level: editLevel } }),
    onSuccess: () => {
      toast("Level uppdaterad");
      setEdit(null);
      void qc.invalidateQueries({ queryKey: ["levels", g.id] });
    },
    onError: (e: Error) => toast(e.message, "bad"),
  });
  const reset = useMutation({
    mutationFn: () => api(`/guilds/${g.id}/levels`, { method: "DELETE" }),
    onSuccess: () => {
      toast("All XP är nollställd");
      setConfirmReset(false);
      void qc.invalidateQueries({ queryKey: ["levels", g.id] });
    },
  });

  return (
    <Card
      title="Topplista"
      description={q.data ? `${fmtNum(q.data.total)} medlemmar med XP` : undefined}
      padded={false}
      actions={
        <div className="flex gap-2">
          <div className="relative w-52">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
            <input className="input h-8 pl-9" placeholder="Sök…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} />
          </div>
          <Button size="sm" variant="danger" onClick={() => setConfirmReset(true)}>Nollställ</Button>
        </div>
      }
    >
      {q.isLoading ? (
        <div className="grid h-32 place-items-center"><Spinner /></div>
      ) : !q.data?.rows.length ? (
        <Empty icon={<TrendingUp className="size-5" />} title="Ingen har XP än">Importera från MEE6 eller vänta tills folk börjar skriva.</Empty>
      ) : (
        <ul className="divide-y divide-line">
          {q.data.rows.map((r) => (
            <li key={r.userId} className="group flex items-center gap-4 px-5 py-2.5">
              <span className="w-8 text-right text-sm font-semibold text-muted tabular-nums">#{r.rank}</span>
              <img src={avatarUrl(r.userId, r.avatar)} className="size-8 rounded-full" alt="" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{r.username || r.userId}</div>
                <div className="mt-1 h-1.5 w-full max-w-60 overflow-hidden rounded-full bg-line">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${(r.current / r.needed) * 100}%` }} />
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm font-semibold">Level {r.level}</div>
                <div className="text-xs text-muted tabular-nums">{fmtNum(r.xp)} XP</div>
              </div>
              <Button variant="ghost" size="sm" className="opacity-0 group-hover:opacity-100" onClick={() => { setEdit(r); setEditLevel(r.level); }}>
                <Pencil className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {q.data && q.data.total > 50 && !search && (
        <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
          <Button size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Föregående</Button>
          <Button size="sm" disabled={(page + 1) * 50 >= q.data.total} onClick={() => setPage(page + 1)}>Nästa</Button>
        </div>
      )}

      <Modal
        open={!!edit}
        onClose={() => setEdit(null)}
        title={`Ändra level för ${edit?.username}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEdit(null)}>Avbryt</Button>
            <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Spara</Button>
          </>
        }
      >
        <Field label="Ny level" hint="XP sätts till början av den leveln. Rollbelöningar synkas direkt.">
          <NumberInput value={editLevel} onChange={setEditLevel} min={0} max={1000} />
        </Field>
      </Modal>
      <Modal
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        title="Nollställ all XP?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmReset(false)}>Avbryt</Button>
            <Button variant="danger" loading={reset.isPending} onClick={() => reset.mutate()}>Ja, nollställ allt</Button>
          </>
        }
      >
        <p className="text-sm text-muted">All XP och alla levels på servern raderas. Det går inte att ångra (men du kan importera från MEE6 igen).</p>
      </Modal>
    </Card>
  );
}
