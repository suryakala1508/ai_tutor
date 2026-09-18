// Hand-drawn SVG chart primitives for the Aurora design system.
// No charting library — plain SVG driven by real data passed in as props.

export const PAL = ["#6D4AFF", "#FF4D8D", "#0FC5C0", "#FF9F1C", "#16C784", "#8A6BFF", "#FF7A9C", "#4C7BFF"];

export interface DonutSlice {
  label: string;
  value: number;
  color: string;
}

export function Donut({ data, centerLabel = "total" }: { data: DonutSlice[]; centerLabel?: string }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const R = 46;
  const C = 2 * Math.PI * R;
  let off = 0;

  return (
    <div className="donut-wrap">
      <div className="donut">
        <svg viewBox="0 0 120 120" className="chart-svg" role="img" aria-label="Distribution chart">
          <circle cx="60" cy="60" r={R} fill="none" stroke="#EEEFF8" strokeWidth="15" />
          {data.map((d, i) => {
            if (d.value <= 0 || total <= 0) return null;
            const len = (d.value / total) * C;
            const dashoffset = -off;
            off += len;
            return (
              <circle
                key={i}
                cx="60"
                cy="60"
                r={R}
                fill="none"
                stroke={d.color}
                strokeWidth="15"
                strokeLinecap="round"
                strokeDasharray={`${len} ${C - len}`}
                strokeDashoffset={dashoffset}
                transform="rotate(-90 60 60)"
              />
            );
          })}
        </svg>
        <div className="center">
          <div>
            <b className="tnum" style={{ display: "block" }}>{total}</b>
            <span style={{ display: "block" }}>{centerLabel}</span>
          </div>
        </div>
      </div>
      <div className="dlegend">
        {data.map((d, i) => (
          <div className="row" key={i}>
            <span className="sw" style={{ background: d.color }} />
            {d.label}
            <b className="tnum">{d.value}</b>
          </div>
        ))}
      </div>
    </div>
  );
}

export interface BarRow {
  label: string;
  value: number;
}

export function CallBars({ rows }: { rows: BarRow[] }) {
  const barH = 20;
  const gap = 8;
  const padL = 140;
  const padR = 40;
  const top = 6;
  const max = Math.max(1, ...rows.map((r) => r.value));
  const plotW = 480 - padL - padR;
  const height = rows.length > 0 ? top * 2 + rows.length * (barH + gap) - gap : top * 2;

  return (
    <svg viewBox={`0 0 480 ${height}`} className="chart-svg" role="img" aria-label="Calls by feature">
      {rows.map((r, i) => {
        const y = top + i * (barH + gap);
        const w = Math.max(3, (r.value / max) * plotW);
        const col = PAL[i % PAL.length];
        return (
          <g key={r.label}>
            <text x={padL - 10} y={y + 14} textAnchor="end" fontSize={11.5} fontWeight={600} fill="#63668A">
              {r.label}
            </text>
            <rect x={padL} y={y} width={plotW} height={barH} rx={6} fill="#F2F3FB" />
            <rect x={padL} y={y} width={w} height={barH} rx={6} fill={col}>
              <animate attributeName="width" from="0" to={w} dur="0.8s" fill="freeze" />
            </rect>
            <text x={padL + w + 8} y={y + 14} fontSize={11.5} fontWeight={700} fill="#151633">
              {r.value}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export interface LineSeries {
  color: string;
  points: number[];
}

/** Simple evenly-spaced 0-100 multi-line chart (used where points already represent equal steps). */
export function LineChart({ series }: { series: LineSeries[] }) {
  const W = 720;
  const H = 300;
  const pad = 42;
  const plotW = W - pad * 2;
  const plotH = H - pad * 1.5;
  const N = Math.max(2, ...series.map((s) => s.points.length));
  const xAt = (i: number) => pad + (i / (N - 1)) * plotW;
  const yAt = (v: number) => pad + plotH - (v / 100) * plotH;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" role="img" aria-label="Mastery over time">
      {[0, 25, 50, 75, 100].map((v) => (
        <g key={v}>
          <line x1={pad} y1={yAt(v)} x2={W - pad} y2={yAt(v)} stroke="#E7E8F4" />
          <text x={pad - 10} y={yAt(v) + 4} textAnchor="end" fontSize={11} fill="#9497B8">
            {v}%
          </text>
        </g>
      ))}
      {series.map((s, si) => {
        if (s.points.length === 0) return null;
        let d = "";
        s.points.forEach((v, i) => {
          d += (i ? "L" : "M") + xAt(i) + "," + yAt(v);
        });
        const last = s.points[s.points.length - 1];
        return (
          <g key={si}>
            {s.points.length > 1 && (
              <path d={d} fill="none" stroke={s.color} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
            )}
            <circle cx={xAt(s.points.length - 1)} cy={yAt(last)} r={5} fill={s.color} />
          </g>
        );
      })}
    </svg>
  );
}

/** Circular progress ring for a single 0..1 value. */
export function Ring({ value, size = 110, id = "ring-grad" }: { value: number; size?: number; id?: string }) {
  const r = size / 2 - 8;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(1, value));
  const offset = c * (1 - clamped);

  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#6D4AFF" />
            <stop offset="100%" stopColor="#FF4D8D" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#EEEFF8" strokeWidth={10} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={`url(#${id})`}
          strokeWidth={10}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="num">{Math.round(clamped * 100)}%</div>
    </div>
  );
}
