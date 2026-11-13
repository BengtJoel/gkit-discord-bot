import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ReactNode } from "react";
import { fmtNum } from "../lib/api";

/* Validated pair (dark surface #111115): violet #8b5cf6 + teal #0d9488 — CVD ΔE 18.9 */
export const SERIES = ["#8b5cf6", "#0d9488"] as const;
const GRID = "#24242c";
const AXIS = "#5d5d68";

const shortDay = (d: string) => {
  const [, m, day] = d.split("-");
  return `${Number(day)}/${Number(m)}`;
};
const longDay = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("sv-SE", { weekday: "short", day: "numeric", month: "short" });

function TooltipBox({ label, rows }: { label: string; rows: { name: string; value: string; color: string }[] }) {
  return (
    <div className="rounded-lg border border-line-2 bg-panel-2 px-3 py-2 text-xs shadow-xl">
      <div className="mb-1 font-medium text-fg">{label}</div>
      {rows.map((r) => (
        <div key={r.name} className="flex items-center gap-2 text-muted">
          <span className="size-2 rounded-full" style={{ background: r.color }} />
          {r.name}
          <span className="ml-auto pl-4 font-medium text-fg tabular-nums">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

/** Single series over time. Title on the card names it, so no legend. */
export function TrendChart<T extends { day: string }>({
  data,
  dataKey,
  name,
  format = fmtNum,
  height = 220,
}: {
  data: T[];
  dataKey: keyof T & string;
  name: string;
  format?: (v: number) => string;
  height?: number;
}) {
  const id = `g-${dataKey}`;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={SERIES[0]} stopOpacity={0.35} />
            <stop offset="100%" stopColor={SERIES[0]} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="day" tickFormatter={shortDay} tick={{ fill: AXIS, fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={24} />
        <YAxis tick={{ fill: AXIS, fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(v) => format(Number(v))} width={56} allowDecimals={false} />
        <Tooltip
          cursor={{ stroke: AXIS, strokeDasharray: "3 3" }}
          content={({ active, payload, label }) =>
            active && payload?.length ? (
              <TooltipBox label={longDay(String(label))} rows={[{ name, value: format(Number(payload[0].value)), color: SERIES[0] }]} />
            ) : null
          }
        />
        <Area type="monotone" dataKey={dataKey as string} stroke={SERIES[0]} strokeWidth={2} fill={`url(#${id})`} activeDot={{ r: 4, strokeWidth: 2, stroke: "#111115" }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Two series as grouped bars (e.g. joins vs leaves). Legend always shown. */
export function PairBars<T extends { day: string }>({ data, a, b, height = 220 }: { data: T[]; a: { key: keyof T & string; name: string }; b: { key: keyof T & string; name: string }; height?: number }) {
  return (
    <div>
      <div className="mb-2 flex gap-4 text-xs text-muted">
        <Legend color={SERIES[0]}>{a.name}</Legend>
        <Legend color={SERIES[1]}>{b.name}</Legend>
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -20 }} barGap={2} barCategoryGap="25%">
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="day" tickFormatter={shortDay} tick={{ fill: AXIS, fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={24} />
          <YAxis tick={{ fill: AXIS, fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} width={44} />
          <Tooltip
            cursor={{ fill: "rgba(255,255,255,.04)" }}
            content={({ active, payload, label }) =>
              active && payload?.length ? (
                <TooltipBox
                  label={longDay(String(label))}
                  rows={[
                    { name: a.name, value: fmtNum(Number(payload[0]?.value)), color: SERIES[0] },
                    { name: b.name, value: fmtNum(Number(payload[1]?.value)), color: SERIES[1] },
                  ]}
                />
              ) : null
            }
          />
          <Bar dataKey={a.key as string} fill={SERIES[0]} radius={[4, 4, 0, 0]} maxBarSize={14} />
          <Bar dataKey={b.key as string} fill={SERIES[1]} radius={[4, 4, 0, 0]} maxBarSize={14} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function Legend({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="size-2.5 rounded-sm" style={{ background: color }} />
      {children}
    </span>
  );
}

const DOW = ["Mån", "Tis", "Ons", "Tor", "Fre", "Lör", "Sön"];

/** Weekday × hour heatmap, sequential single hue (violet), with per-cell hover title */
export function Heatmap({ cells, metric }: { cells: { dow: number; hour: number; messages: number; voice_seconds: number }[]; metric: "messages" | "voice_seconds" }) {
  const grid = new Map(cells.map((c) => [`${c.dow}-${c.hour}`, Number(c[metric])]));
  const max = Math.max(1, ...grid.values());
  const fmt = (v: number) => (metric === "messages" ? `${fmtNum(v)} meddelanden` : `${(v / 3600).toLocaleString("sv-SE", { maximumFractionDigits: 1 })} h röst`);
  return (
    <div className="overflow-x-auto">
      <div className="inline-grid min-w-full gap-[2px]" style={{ gridTemplateColumns: "36px repeat(24, minmax(16px, 1fr))" }}>
        <div />
        {Array.from({ length: 24 }, (_, h) => (
          <div key={h} className="pb-1 text-center text-[10px] text-faint">
            {h % 3 === 0 ? String(h).padStart(2, "0") : ""}
          </div>
        ))}
        {DOW.map((d, i) => (
          <div key={d} className="contents">
            <div className="pr-2 text-right text-[11px] leading-5 text-muted">{d}</div>
            {Array.from({ length: 24 }, (_, h) => {
              const v = grid.get(`${i + 1}-${h}`) ?? 0;
              const t = v / max;
              return (
                <div
                  key={h}
                  title={`${d} ${String(h).padStart(2, "0")}:00 — ${fmt(v)}`}
                  className="h-5 rounded-[3px] transition hover:ring-2 hover:ring-fg/60"
                  style={{ background: v === 0 ? "#17171c" : `color-mix(in oklab, #8b5cf6 ${Math.round(18 + t * 82)}%, #17171c)` }}
                />
              );
            })}
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-end gap-2 text-[11px] text-muted">
        Mindre
        {[0.18, 0.4, 0.6, 0.8, 1].map((p) => (
          <span key={p} className="size-3 rounded-[3px]" style={{ background: `color-mix(in oklab, #8b5cf6 ${p * 100}%, #17171c)` }} />
        ))}
        Mer
      </div>
    </div>
  );
}

/** Stat tile — a headline number is not a chart */
export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="card p-4">
      <div className="text-[13px] text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
      {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
    </div>
  );
}
