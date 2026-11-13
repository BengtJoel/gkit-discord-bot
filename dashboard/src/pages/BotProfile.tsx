import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ImagePlus, Palette, RotateCcw, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { useGuild } from "../lib/guild";
import { Button, Card, Field, PageHeader, Spinner, useToast } from "../components/ui";
import { useT } from "../lib/i18n";
import type { GuildData } from "../lib/types";

interface Profile {
  username: string;
  globalAvatarUrl: string | null;
  nickname: string | null;
  avatarUrl: string | null;
  bannerUrl: string | null;
}
interface BrandingResponse {
  config: { nickname: string | null; bio: string; color: string };
  profile: Profile | null;
}

const PRESETS = ["#8b5cf6", "#3b82f6", "#14b8a6", "#22c55e", "#f59e0b", "#ef4444", "#ec4899", "#e5e7eb"];
const MAX_MB = 8;

function readFile(file: File) {
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export function BotProfile() {
  const { t } = useT();
  const g = useGuild();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["branding", g.id], queryFn: () => api<BrandingResponse>(`/guilds/${g.id}/branding`) });

  const [nickname, setNickname] = useState("");
  const [bio, setBio] = useState("");
  const [color, setColor] = useState("#8b5cf6");
  useEffect(() => {
    if (!q.data) return;
    setNickname(q.data.config.nickname ?? "");
    setBio(q.data.config.bio);
    setColor(q.data.config.color);
  }, [q.data]);

  const onSaved = (data: Partial<BrandingResponse>) => {
    qc.setQueryData<BrandingResponse>(["branding", g.id], (old) => (old ? { ...old, ...data } : old));
    if (data.config)
      qc.setQueryData<GuildData>(["guild", g.id], (old) =>
        old ? { ...old, modules: { ...old.modules, branding: { enabled: true, config: data.config! } } } : old,
      );
  };

  const save = useMutation({
    mutationFn: () => api<BrandingResponse>(`/guilds/${g.id}/branding`, { method: "PUT", json: { nickname: nickname.trim() || null, bio, color } }),
    onSuccess: (d) => {
      onSaved(d);
      toast(t("dash.common.saved"));
    },
    onError: (e: Error) => toast(e.message, "bad"),
  });

  const upload = useMutation({
    mutationFn: ({ kind, image }: { kind: "avatar" | "banner"; image: string | null }) =>
      api<{ profile: Profile }>(`/guilds/${g.id}/branding/${kind}`, { method: "PUT", json: { image } }),
    onSuccess: (d) => {
      onSaved({ profile: d.profile });
      toast(t("dash.profile.imageSaved"));
    },
    onError: (e: Error) => toast(e.message, "bad"),
  });

  const pick = async (kind: "avatar" | "banner", file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_MB * 1024 * 1024) return toast(t("errors.imageTooLarge", { mb: MAX_MB }), "bad");
    upload.mutate({ kind, image: await readFile(file) });
  };

  const saved = q.data?.config;
  const dirty = !!saved && ((saved.nickname ?? "") !== nickname || saved.bio !== bio || saved.color !== color);
  const p = q.data?.profile;

  return (
    <div className="pb-16">
      <PageHeader title={t("dash.nav.profile")} icon={<Palette className="size-5" />} description={t("dash.profile.description")} />
      {q.isLoading ? (
        <div className="grid h-60 place-items-center"><Spinner /></div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
          <div className="space-y-5">
            <Card title={t("dash.profile.identity")}>
              <div className="space-y-4">
                <Field label={t("dash.profile.nickname")} hint={t("dash.profile.nicknameHint")}>
                  <input className="input" maxLength={32} value={nickname} placeholder={p?.username ?? "GuildKit Bot"} onChange={(e) => setNickname(e.target.value)} />
                </Field>
                <Field label={t("dash.profile.bio")} hint={t("dash.profile.bioHint", { n: 190 - bio.length })}>
                  <textarea className="input" rows={3} maxLength={190} value={bio} onChange={(e) => setBio(e.target.value)} />
                </Field>
                <Field label={t("dash.profile.color")} hint={t("dash.profile.colorHint")}>
                  <div className="flex flex-wrap items-center gap-2">
                    {PRESETS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        aria-label={c}
                        onClick={() => setColor(c)}
                        className={`size-8 rounded-full border-2 transition ${color.toLowerCase() === c ? "border-fg" : "border-transparent hover:border-line-2"}`}
                        style={{ background: c }}
                      />
                    ))}
                    <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-8 w-12 cursor-pointer rounded-md border border-line bg-panel-2 p-1" />
                    <span className="font-mono text-xs text-muted">{color}</span>
                  </div>
                </Field>
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" disabled={!dirty} onClick={() => saved && (setNickname(saved.nickname ?? ""), setBio(saved.bio), setColor(saved.color))}>
                    {t("dash.common.undo")}
                  </Button>
                  <Button variant="primary" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>
                    {t("dash.common.save")}
                  </Button>
                </div>
              </div>
            </Card>

            <Card title={t("dash.profile.images")} description={t("dash.profile.imagesHint", { mb: MAX_MB })}>
              <div className="grid gap-5 sm:grid-cols-2">
                <ImageSlot
                  label={t("dash.profile.avatar")}
                  hint={t("dash.profile.avatarHint")}
                  current={p?.avatarUrl ?? null}
                  busy={upload.isPending && upload.variables?.kind === "avatar"}
                  onPick={(f) => void pick("avatar", f)}
                  onClear={() => upload.mutate({ kind: "avatar", image: null })}
                  clearLabel={t("dash.profile.resetAvatar")}
                  clearIcon={<RotateCcw className="size-4" />}
                  round
                />
                <ImageSlot
                  label={t("dash.profile.banner")}
                  hint={t("dash.profile.bannerHint")}
                  current={p?.bannerUrl ?? null}
                  busy={upload.isPending && upload.variables?.kind === "banner"}
                  onPick={(f) => void pick("banner", f)}
                  onClear={() => upload.mutate({ kind: "banner", image: null })}
                  clearLabel={t("dash.profile.removeBanner")}
                  clearIcon={<Trash2 className="size-4" />}
                />
              </div>
            </Card>
          </div>

          <div className="lg:sticky lg:top-8 lg:self-start">
            <div className="mb-2 text-[11px] font-semibold tracking-wider text-faint uppercase">{t("dash.profile.preview")}</div>
            <Preview profile={p ?? null} nickname={nickname} bio={bio} color={color} guildName={g.name ?? ""} />
          </div>
        </div>
      )}
    </div>
  );
}

function ImageSlot(props: {
  label: string;
  hint: string;
  current: string | null;
  busy: boolean;
  onPick: (f: File | undefined) => void;
  onClear: () => void;
  clearLabel: string;
  clearIcon: React.ReactNode;
  round?: boolean;
}) {
  const { t } = useT();
  const input = useRef<HTMLInputElement>(null);
  return (
    <div>
      <div className="label">{props.label}</div>
      <div className={`mb-2 grid place-items-center overflow-hidden border border-dashed border-line-2 bg-panel-2 ${props.round ? "size-24 rounded-full" : "h-24 w-full rounded-lg"}`}>
        {props.current ? <img src={props.current} alt="" className="size-full object-cover" /> : <ImagePlus className="size-6 text-faint" />}
      </div>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="hidden" onChange={(e) => (props.onPick(e.target.files?.[0]), (e.target.value = ""))} />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" loading={props.busy} icon={<ImagePlus className="size-4" />} onClick={() => input.current?.click()}>
          {t("dash.profile.upload")}
        </Button>
        {props.current && (
          <Button size="sm" variant="ghost" icon={props.clearIcon} onClick={props.onClear}>
            {props.clearLabel}
          </Button>
        )}
      </div>
      <p className="hint">{props.hint}</p>
    </div>
  );
}

/** Rough mock of Discord's profile card + an embed, so changes can be judged before saving */
function Preview({ profile, nickname, bio, color, guildName }: { profile: Profile | null; nickname: string; bio: string; color: string; guildName: string }) {
  const { t } = useT();
  const name = nickname.trim() || profile?.username || "GuildKit Bot";
  const avatar = profile?.avatarUrl ?? profile?.globalAvatarUrl;
  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-xl border border-line bg-[#232428]">
        <div className="h-24" style={profile?.bannerUrl ? { background: `center/cover url(${profile.bannerUrl})` } : { background: color }} />
        <div className="px-4 pb-4">
          <div className="-mt-10 mb-2 size-20 overflow-hidden rounded-full border-[6px] border-[#232428] bg-panel-2">
            {avatar && <img src={avatar} alt="" className="size-full object-cover" />}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-lg font-semibold text-white">{name}</span>
            <span className="rounded bg-[#5865f2] px-1.5 py-0.5 text-[10px] font-semibold text-white">APP</span>
          </div>
          <div className="text-sm text-[#b5bac1]">{profile?.username}</div>
          {bio && <p className="mt-3 border-t border-white/10 pt-3 text-sm whitespace-pre-wrap text-[#dbdee1]">{bio}</p>}
          {guildName && <p className="mt-3 text-[11px] text-[#949ba4]">{t("dash.profile.onlyOn", { server: guildName })}</p>}
        </div>
      </div>
      <div className="rounded-xl border border-line bg-[#313338] p-3">
        <div className="flex gap-3">
          <div className="size-9 shrink-0 overflow-hidden rounded-full bg-panel-2">{avatar && <img src={avatar} alt="" className="size-full object-cover" />}</div>
          <div className="min-w-0 flex-1">
            <div className="text-sm">
              <span className="font-medium" style={{ color }}>{name}</span>{" "}
              <span className="rounded bg-[#5865f2] px-1 py-px text-[9px] font-semibold text-white">APP</span>
            </div>
            <div className="mt-1 rounded border-l-4 bg-[#2b2d31] px-3 py-2" style={{ borderColor: color }}>
              <div className="text-sm font-semibold text-white">{t("dash.profile.sampleEmbedTitle")}</div>
              <div className="mt-1 text-xs text-[#dbdee1]">#1 · Level 12 · 4 210 / 5 330 XP</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
