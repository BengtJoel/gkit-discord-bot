import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import type { GuildData, ModuleName, ModuleState, ModuleConfigs } from "./types";
import { GuildDataContext, useToast } from "../components/ui";

const Ctx = createContext<GuildData | null>(null);

export function useGuild() {
  const g = useContext(Ctx);
  if (!g) throw new Error("useGuild outside provider");
  return g;
}

export function useGuildQuery(guildId: string) {
  return useQuery({ queryKey: ["guild", guildId], queryFn: () => api<GuildData>(`/guilds/${guildId}`), staleTime: 30_000 });
}

export function GuildProvider({ guild, children }: { guild: GuildData; children: ReactNode }) {
  const pickers = useMemo(() => ({ channels: guild.channels, roles: guild.roles }), [guild.channels, guild.roles]);
  return (
    <Ctx.Provider value={guild}>
      <GuildDataContext.Provider value={pickers}>{children}</GuildDataContext.Provider>
    </Ctx.Provider>
  );
}

/** Draft/save state for a module's settings. The SaveBar reads `dirty` and calls save/reset. */
export function useModuleForm<M extends ModuleName>(module: M) {
  const guild = useGuild();
  const qc = useQueryClient();
  const toast = useToast();
  const saved = guild.modules[module] as ModuleState<M>;
  const [draft, setDraft] = useState<ModuleConfigs[M]>(saved.config);

  // When the server state changes (after save/refetch) reset the draft
  const savedJson = JSON.stringify(saved.config);
  useEffect(() => setDraft(JSON.parse(savedJson)), [savedJson]);

  const dirty = JSON.stringify(draft) !== savedJson;

  const mutation = useMutation({
    mutationFn: (body: { enabled?: boolean; config?: unknown }) =>
      api<ModuleState<M>>(`/guilds/${guild.id}/modules/${module}`, { method: "PUT", json: body }),
    onSuccess: (state) => {
      qc.setQueryData<GuildData>(["guild", guild.id], (g) => (g ? { ...g, modules: { ...g.modules, [module]: state } } : g));
    },
    onError: (e: Error) => toast(e.message, "bad"),
  });

  const update = <K extends keyof ModuleConfigs[M]>(key: K, value: ModuleConfigs[M][K]) => setDraft((d) => ({ ...d, [key]: value }));

  return {
    enabled: saved.enabled,
    draft,
    setDraft,
    update,
    dirty,
    saving: mutation.isPending,
    save: () => mutation.mutateAsync({ config: draft }).then(() => toast("Ändringarna är sparade")),
    reset: () => setDraft(JSON.parse(savedJson)),
    setEnabled: (enabled: boolean) =>
      mutation.mutateAsync({ enabled }).then(() => toast(enabled ? "Modulen är på" : "Modulen är avstängd")),
  };
}
