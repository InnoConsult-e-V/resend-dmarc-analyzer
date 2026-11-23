'use client';

import { useEffect, useRef, useState } from 'react';
import type { DayBucket } from '@/lib/dashboard/aggregate';
import {
  formatDate,
  formatDayMonth,
  formatWeekdayDate,
} from '@/lib/format-date';
import { OUTCOMES, OutcomeLegend, passRate } from './outcomes';

// Dark-surface chrome from the reference palette.
const GRID = '#2c2c2a';
const AXIS = '#383835';
const MUTED = '#898781';

const HEIGHT = 280;
const MARGIN = { top: 12, right: 12, bottom: 32, left: 52 };
const BAR_MAX = 24;
const GAP = 2;
const RADIUS = 4;

/** Round, human tick values for a 0..max axis. */
function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) {
    return [0, 1];
  }
  const raw = max / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 5, 10].find((m) => m * pow >= raw) ?? 10) * pow;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step; v += step) {
    ticks.push(v);
    if (v >= max) {
      break;
    }
  }
  return ticks;
}

function formatTick(v: number): string {
  return v >= 10_000
    ? new Intl.NumberFormat('en-US', { notation: 'compact' }).format(v)
    : v.toLocaleString('en-US');
}

/** Rectangle with only the top corners rounded (the data end of a column). */
function topRounded(x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h));
  return `M${x},${y + rr}a${rr},${rr} 0 0 1 ${rr},${-rr}h${w - 2 * rr}a${rr},${rr} 0 0 1 ${rr},${rr}v${h - rr}h${-w}z`;
}

interface Props {
  daily: DayBucket[];
  title: string;
  subtitle: string;
}

export function StackedDailyChart({ daily, title, subtitle }: Props) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const [active, setActive] = useState<number | null>(null);
  const [width, setWidth] = useState(640);
  const wrapRef = useRef<HTMLDivElement>(null);
  const n = daily.length;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) {
      return;
    }
    const ro = new ResizeObserver(([entry]) =>
      setWidth(Math.max(320, Math.floor(entry.contentRect.width))),
    );
    ro.observe(el);
    return () => ro.disconnect();
    // The chart element only exists in chart view (and when there is data).
  }, [view, n]);

  const spansYears =
    n > 0 && daily[0].date.slice(0, 4) !== daily[n - 1].date.slice(0, 4);
  const plotW = width - MARGIN.left - MARGIN.right;
  const plotH = HEIGHT - MARGIN.top - MARGIN.bottom;
  const stackTotal = (d: DayBucket) =>
    d.passedBoth + d.passedOne + d.failedBoth;
  const max = Math.max(0, ...daily.map(stackTotal));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1];
  const y = (v: number) => MARGIN.top + plotH - (v / top) * plotH;
  const band = n > 0 ? plotW / n : plotW;
  const barW = Math.min(BAR_MAX, Math.max(2, band * 0.7));
  const labelEvery = Math.max(
    1,
    Math.ceil(n / Math.max(2, Math.floor(plotW / 80))),
  );

  const activeDay = active === null ? null : daily[active];

  function onKeyDown(e: React.KeyboardEvent) {
    if (n === 0) {
      return;
    }
    const last = n - 1;
    const move = (i: number) => {
      e.preventDefault();
      setActive(Math.min(last, Math.max(0, i)));
    };
    if (e.key === 'ArrowLeft') {
      move((active ?? last + 1) - 1);
    } else if (e.key === 'ArrowRight') {
      move((active ?? -1) + 1);
    } else if (e.key === 'Home') {
      move(0);
    } else if (e.key === 'End') {
      move(last);
    } else if (e.key === 'Escape') {
      setActive(null);
    }
  }

  // Tooltip position: centred on the column, clamped inside the chart.
  const tipW = 210;
  const tipLeft =
    active === null
      ? 0
      : Math.min(
          width - tipW - 4,
          Math.max(4, MARGIN.left + active * band + band / 2 - tipW / 2),
        );

  return (
    <section className="rounded-xl border border-gray-3 bg-gray-2 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-medium text-gray-10">{title}</h2>
          <p className="text-sm text-gray-6">{subtitle}</p>
        </div>
        <div
          role="group"
          aria-label="Chart or table view"
          className="flex rounded-lg border border-gray-3 p-0.5 text-xs"
        >
          {(['chart', 'table'] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className={`rounded-md px-3 py-1 capitalize transition-colors ${
                view === v
                  ? 'bg-gray-3 text-gray-10'
                  : 'text-gray-6 hover:text-gray-9'
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3">
        <OutcomeLegend />
      </div>

      {n === 0 ? (
        <p className="py-16 text-center text-sm text-gray-6">
          No reports in this range.
        </p>
      ) : view === 'table' ? (
        <div className="mt-4 max-h-[280px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-gray-2 text-left text-gray-6">
              <tr>
                <th className="py-2 pr-4 font-normal">Day (UTC)</th>
                {OUTCOMES.map((o) => (
                  <th key={o.key} className="py-2 pr-4 text-right font-normal">
                    {o.short}
                  </th>
                ))}
                <th className="py-2 pr-4 text-right font-normal">Total</th>
                <th className="py-2 text-right font-normal">Passed both</th>
              </tr>
            </thead>
            <tbody className="text-gray-9 tabular-nums">
              {[...daily].reverse().map((d) => (
                <tr key={d.date} className="border-t border-gray-3">
                  <td className="py-1.5 pr-4">
                    {formatDate(`${d.date}T00:00:00Z`, { utc: true })}
                  </td>
                  {OUTCOMES.map((o) => (
                    <td key={o.key} className="py-1.5 pr-4 text-right">
                      {d[o.key].toLocaleString()}
                    </td>
                  ))}
                  <td className="py-1.5 pr-4 text-right">
                    {d.messages.toLocaleString()}
                  </td>
                  <td className="py-1.5 text-right">
                    {d.messages > 0 ? `${passRate(d).toFixed(1)}%` : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div
          ref={wrapRef}
          className="relative mt-4 outline-none focus-visible:ring-1 focus-visible:ring-gray-5 rounded-lg"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: keyboard access to the per-day readout
          tabIndex={0}
          role="group"
          aria-label="Daily messages by authentication result. Use the left and right arrow keys to read each day."
          onKeyDown={onKeyDown}
          onFocus={() => setActive((a) => a ?? n - 1)}
          onBlur={() => setActive(null)}
          onPointerLeave={() => setActive(null)}
        >
          <svg
            width={width}
            height={HEIGHT}
            role="img"
            aria-label={`Stacked columns of daily messages, ${n} days`}
          >
            {/* gridlines + y axis */}
            {ticks.map((t) => (
              <g key={t}>
                <line
                  x1={MARGIN.left}
                  x2={width - MARGIN.right}
                  y1={y(t)}
                  y2={y(t)}
                  stroke={t === 0 ? AXIS : GRID}
                  strokeWidth="1"
                />
                <text
                  x={MARGIN.left - 8}
                  y={y(t)}
                  dy="0.32em"
                  textAnchor="end"
                  fontSize="11"
                  fill={MUTED}
                >
                  {formatTick(t)}
                </text>
              </g>
            ))}

            {/* x axis labels */}
            {daily.map((d, i) =>
              i % labelEvery === 0 ? (
                <text
                  key={d.date}
                  x={MARGIN.left + i * band + band / 2}
                  y={HEIGHT - 10}
                  textAnchor="middle"
                  fontSize="11"
                  fill={MUTED}
                >
                  {formatDayMonth(`${d.date}T00:00:00Z`, {
                    utc: true,
                    withYear: spansYears,
                  })}
                </text>
              ) : null,
            )}

            {/* hovered column wash */}
            {active !== null && (
              <rect
                x={MARGIN.left + active * band}
                y={MARGIN.top}
                width={band}
                height={plotH}
                fill="rgba(255,255,255,0.05)"
              />
            )}

            {/* columns: stacked bottom-up, 2px surface gaps, rounded data end */}
            {daily.map((d, i) => {
              const x = MARGIN.left + i * band + (band - barW) / 2;
              const present = OUTCOMES.filter((o) => d[o.key] > 0);
              let cursor = MARGIN.top + plotH;
              return (
                <g
                  key={d.date}
                  style={
                    active === i ? { filter: 'brightness(1.2)' } : undefined
                  }
                >
                  {present.map((o, idx) => {
                    const h = Math.max(2, (d[o.key] / top) * plotH);
                    const segTop = cursor - h;
                    const gap = idx === 0 ? 0 : GAP;
                    cursor = segTop;
                    const isTop = idx === present.length - 1;
                    const segH = Math.max(1, h - gap);
                    return isTop ? (
                      <path
                        key={o.key}
                        d={topRounded(x, segTop, barW, segH, RADIUS)}
                        fill={o.color}
                      />
                    ) : (
                      <rect
                        key={o.key}
                        x={x}
                        y={segTop + gap}
                        width={barW}
                        height={segH}
                        fill={o.color}
                      />
                    );
                  })}
                </g>
              );
            })}

            {/* hit targets: each whole column, larger than the mark */}
            {daily.map((d, i) => (
              <rect
                key={d.date}
                x={MARGIN.left + i * band}
                y={MARGIN.top}
                width={band}
                height={plotH}
                fill="transparent"
                onPointerEnter={() => setActive(i)}
                onPointerMove={() => setActive(i)}
              />
            ))}
          </svg>

          {activeDay && (
            <div
              className="pointer-events-none absolute z-10 rounded-lg border border-gray-4 bg-gray-1 px-3 py-2 text-xs shadow-xl"
              style={{ left: tipLeft, top: 4, width: tipW }}
            >
              <div className="mb-1.5 text-gray-7">
                {formatWeekdayDate(`${activeDay.date}T00:00:00Z`, {
                  utc: true,
                })}
              </div>
              {OUTCOMES.map((o) => (
                <div key={o.key} className="flex items-center gap-2 py-0.5">
                  <span
                    className="inline-block h-[3px] w-3 rounded-full"
                    style={{ background: o.color }}
                  />
                  <span className="font-medium tabular-nums text-gray-10">
                    {activeDay[o.key].toLocaleString()}
                  </span>
                  <span className="text-gray-7">{o.short}</span>
                </div>
              ))}
              <div className="mt-1.5 flex items-center justify-between border-t border-gray-3 pt-1.5">
                <span className="text-gray-7">
                  {activeDay.messages.toLocaleString()} total
                </span>
                <span className="font-medium tabular-nums text-gray-10">
                  {activeDay.messages > 0
                    ? `${passRate(activeDay).toFixed(1)}% passed both`
                    : 'no data'}
                </span>
              </div>
            </div>
          )}
          <p className="sr-only" aria-live="polite">
            {activeDay
              ? `${formatDate(`${activeDay.date}T00:00:00Z`, { utc: true })}: ${OUTCOMES.map((o) => `${o.short} ${activeDay[o.key]}`).join(', ')}, ${activeDay.messages} total`
              : ''}
          </p>
        </div>
      )}
    </section>
  );
}
