export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public issues?: { path: string; message: string }[],
  ) {
    super(message);
  }
}

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(`/api${path}`, {
    credentials: "include",
    ...rest,
    headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...rest.headers },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok && res.status !== 207) {
    const msg = data?.issues?.length
      ? `${data.error}: ${data.issues.map((i: { path: string; message: string }) => `${i.path} – ${i.message}`).join(", ")}`
      : (data?.error ?? `Fel ${res.status}`);
    throw new ApiError(res.status, msg, data?.issues);
  }
  return data as T;
}

/** Postgres returns "2026-11-11 18:29:10.94+00" from raw queries — normalise to a Date */
export function toDate(v: string | Date | null | undefined): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  const iso = v.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00");
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

const rtf = new Intl.RelativeTimeFormat("sv", { numeric: "auto" });
export function timeAgo(v: string | Date | null | undefined) {
  const d = toDate(v);
  if (!d) return "—";
  const s = (d.getTime() - Date.now()) / 1000;
  const abs = Math.abs(s);
  if (abs < 60) return rtf.format(Math.round(s), "second");
  if (abs < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(s / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(s / 86400), "day");
  if (abs < 86400 * 365) return rtf.format(Math.round(s / (86400 * 30)), "month");
  return rtf.format(Math.round(s / (86400 * 365)), "year");
}

export const fmtDate = (v: string | Date | null | undefined) =>
  toDate(v)?.toLocaleDateString("sv-SE", { year: "numeric", month: "short", day: "numeric" }) ?? "—";
export const fmtDateTime = (v: string | Date | null | undefined) =>
  toDate(v)?.toLocaleString("sv-SE", { dateStyle: "medium", timeStyle: "short" }) ?? "—";
export const fmtNum = (n: number | string | null | undefined) => Number(n ?? 0).toLocaleString("sv-SE");
export function fmtHours(seconds: number | string) {
  const s = Number(seconds);
  if (s < 3600) return `${Math.round(s / 60)} min`;
  return `${(s / 3600).toLocaleString("sv-SE", { maximumFractionDigits: 1 })} h`;
}

export const avatarUrl = (userId: string, avatar: string | null | undefined, size = 64) =>
  avatar
    ? `https://cdn.discordapp.com/avatars/${userId}/${avatar}.${avatar.startsWith("a_") ? "gif" : "webp"}?size=${size}`
    : `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(userId) >> 22n) % 6n)}.png`;

export const guildIconUrl = (id: string, icon: string | null, size = 64) =>
  icon ? `https://cdn.discordapp.com/icons/${id}/${icon}.webp?size=${size}` : null;
