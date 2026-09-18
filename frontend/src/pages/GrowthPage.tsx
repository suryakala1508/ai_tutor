import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { ErrorBanner, EmptyState, LoadingBlock } from "../components/Feedback";

interface TrendPoint {
  concept_id: string;
  concept_name: string;
  mastery: number;
  created_at: string;
}

interface GrowthConcept {
  concept_id: string;
  concept_name: string;
  current_mastery: number;
  previous_mastery: number | null;
  change: number | null;
  status: string;
  status_label: string;
  attempts: number;
  last_practiced_at: string | null;
}

interface GrowthSummary {
  tracked_concepts: number;
  improving: number;
  stable: number;
  requiring_attention: number;
  average_mastery: number | null;
}

interface ProjectGrowth {
  summary: GrowthSummary;
  concepts: GrowthConcept[];
}

interface AnalyticsData {
  mastery_trend_chart: TrendPoint[];
}

interface RecommendationItem {
  title: string;
  reason: string;
  suggested_action: string;
  action_type: string;
  concept_id: string | null;
  concept_name: string | null;
  priority: string;
  priority_score: number;
}

interface ProjectRecommendations {
  insufficient_data: boolean;
  message: string | null;
  recommendations: RecommendationItem[];
}

const ACTION_LABEL: Record<string, string> = {
  use_tutor: "🎓 Use the Tutor",
  review_material: "📖 Review material",
  take_quiz: "📝 Take a quiz",
};

const ACTION_ICON: Record<string, string> = {
  use_tutor: "🎓",
  review_material: "📖",
  take_quiz: "📝",
};

const COLORS = ["#6D4AFF", "#FF4D8D", "#0FC5C0", "#FF9F1C", "#16C784", "#8A6BFF", "#FF7A9C", "#4C7BFF"];

export default function GrowthPage() {
  const { projectId } = useParams();
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [growth, setGrowth] = useState<ProjectGrowth | null>(null);
  const [recommendations, setRecommendations] = useState<ProjectRecommendations | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    api
      .get<AnalyticsData>(`/api/projects/${projectId}/analytics`)
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load growth data."));
    api
      .get<ProjectGrowth>(`/api/projects/${projectId}/growth`)
      .then(setGrowth)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load growth data."));
    api
      .get<ProjectRecommendations>(`/api/projects/${projectId}/recommendations`)
      .then(setRecommendations)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load recommendations."));
  }, [projectId]);

  const byConceptSeries = useMemo(() => {
    if (!data) return [];
    const map = new Map<string, TrendPoint[]>();
    for (const p of data.mastery_trend_chart) {
      if (!map.has(p.concept_name)) map.set(p.concept_name, []);
      map.get(p.concept_name)!.push(p);
    }
    return Array.from(map.entries());
  }, [data]);

  return (
    <div className="page">
      <div className="crumb">
        <Link to={`/projects/${projectId}`} style={{ color: "inherit" }}>← Project</Link>
      </div>
      <h1 className="h-disp" style={{ fontSize: 26, marginBottom: 20 }}>Growth</h1>

      {error && <ErrorBanner message={error} />}

      {!data && !growth && !recommendations && !error && (
        <div className="card">
          <LoadingBlock />
        </div>
      )}

      {growth && growth.concepts.length === 0 && (
        <EmptyState
          title="No mastery data yet."
          hint="Complete a quiz or assessment to start tracking your progress."
        />
      )}

      {growth && growth.concepts.length > 0 && (
        <div className="stack-g">
          <div className="kpis c4">
            <div className="kpi grad v">
              <div className="k-ico">📊</div>
              <div className="k-label">Average mastery</div>
              <div className="k-val">
                {growth.summary.average_mastery !== null ? `${Math.round(growth.summary.average_mastery * 100)}%` : "—"}
              </div>
            </div>
            <div className="kpi">
              <div className="k-ico ic-g">📈</div>
              <div className="k-label">Improving</div>
              <div className="k-val">{growth.summary.improving}</div>
            </div>
            <div className="kpi">
              <div className="k-ico ic-m">➖</div>
              <div className="k-label">Stable</div>
              <div className="k-val">{growth.summary.stable}</div>
            </div>
            <div className="kpi">
              <div className="k-ico ic-p">⚠️</div>
              <div className="k-label">Requiring attention</div>
              <div className="k-val">{growth.summary.requiring_attention}</div>
            </div>
          </div>

          {recommendations && (
            <div className="block">
              <div className="section-label" style={{ padding: "22px 24px 4px" }}>Recommended Next</div>
              {recommendations.recommendations.length === 0 ? (
                <div style={{ padding: "0 24px" }}>
                  <EmptyState
                    title="Nothing urgent right now"
                    hint={recommendations.message || undefined}
                  />
                </div>
              ) : (
                <div>
                  {recommendations.recommendations.map((r, i) => (
                    <div key={i} className={`rec ${r.priority === "high" ? "hi" : "lo"}`}>
                      <div className="rec-ico">{ACTION_ICON[r.action_type] || "💡"}</div>
                      <div className="rec-body">
                        <div className="rec-top">
                          <div className="rec-title">{r.title}</div>
                          <span className={`badge badge-priority-${r.priority}`}>{r.priority}</span>
                        </div>
                        <div className="rec-desc">{r.reason}</div>
                        <div className="rec-act">
                          <span className="action-pill">{ACTION_LABEL[r.action_type] || "Next step"}</span>
                          <span className="lil">{r.suggested_action}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="block">
            <div className="section-label" style={{ padding: "22px 24px 0" }}>Mastery Over Time</div>
            {byConceptSeries.length > 0 ? (
              <div className="chart-wrap">
                <Chart series={byConceptSeries} />
                <div className="chart-legend">
                  {byConceptSeries.map(([name], i) => (
                    <span key={name}>
                      <span className="dot" style={{ background: COLORS[i % COLORS.length] }} />
                      {name}
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ padding: "0 24px 24px" }}>
                <EmptyState
                  title="Not enough history yet"
                  hint="Answer a few more quiz questions and this chart will show how your mastery changes over time."
                />
              </div>
            )}
          </div>

          <div className="block">
            <div className="section-label" style={{ padding: "22px 24px 4px" }}>Concept Mastery</div>
            <div>
              {growth.concepts.map((c) => {
                const pct = Math.round(c.current_mastery * 100);
                return (
                  <div key={c.concept_id} className="cm-row">
                    <div className="spread">
                      <div className="cm-name">{c.concept_name}</div>
                      <span className={`badge badge-${c.status}`}>{c.status_label}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <div className="cm-track" style={{ flex: 1 }}>
                        <div
                          className="cm-fill"
                          style={{ width: `${pct}%`, background: pct < 40 ? "var(--grad-amber)" : pct < 70 ? "var(--grad-cyan)" : "var(--grad-green)" }}
                        />
                      </div>
                      <div className="cm-pct">{pct}%</div>
                    </div>
                    <div className="cm-sub" style={{ marginTop: 8 }}>
                      {c.change !== null && c.previous_mastery !== null ? (
                        <>
                          {c.change >= 0 ? "+" : ""}
                          {Math.round(c.change * 100)}% since you started (was {Math.round(c.previous_mastery * 100)}%) ·{" "}
                        </>
                      ) : (
                        "Not enough history yet to show change · "
                      )}
                      {c.attempts} attempt{c.attempts === 1 ? "" : "s"}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface ChartPoint {
  name: string;
  color: string;
  mastery: number;
  dayKey: string;
  dateLabel: string;
}

interface HoverInfo {
  x: number;
  y: number;
  name: string;
  color: string;
  mastery: number;
  dayKey: string;
  dateLabel: string;
}

function dayKeyOf(iso: string): string {
  return new Date(iso).toDateString();
}

function formatDayLabel(dayKey: string): string {
  return new Date(dayKey).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Smooth cubic-bezier path through a series of points using symmetric
 * horizontal-midpoint control points — enough to turn straight segments
 * into a gentle curve without pulling in a charting library. */
function smoothPath(points: { x: number; y: number }[]): string {
  if (points.length < 2) return "";
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const midX = (prev.x + curr.x) / 2;
    d += ` C ${midX} ${prev.y}, ${midX} ${curr.y}, ${curr.x} ${curr.y}`;
  }
  return d;
}

function Chart({ series }: { series: [string, TrendPoint[]][] }) {
  const [hover, setHover] = useState<HoverInfo | null>(null);

  const width = 640;
  const height = 240;
  const paddingLeft = 38;
  const paddingRight = 16;
  const paddingTop = 14;
  const bottomAxis = 24;
  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - bottomAxis;

  if (series.length === 0) return null;

  // A continuous time axis stretches sparse, unevenly-spaced snapshots
  // across the full width — a handful of early points end up crushed
  // together while one recent point sits stranded far to the right. Instead,
  // every DISTINCT calendar day that appears anywhere in the data gets its
  // own evenly-spaced slot, and each series is reduced to at most one point
  // per day (its last snapshot that day) so points never stack on top of
  // each other within a line.
  const perSeriesByDay: [string, string, Map<string, TrendPoint>][] = series.map(([name, points], i) => {
    const byDay = new Map<string, TrendPoint>();
    const sorted = [...points].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    for (const p of sorted) byDay.set(dayKeyOf(p.created_at), p);
    return [name, COLORS[i % COLORS.length], byDay];
  });

  const allDayKeys = Array.from(new Set(perSeriesByDay.flatMap(([, , byDay]) => Array.from(byDay.keys()))));
  allDayKeys.sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
  const dayIndex = new Map(allDayKeys.map((d, i) => [d, i]));
  const n = allDayKeys.length;

  function xForDay(dayKey: string): number {
    if (n <= 1) return paddingLeft + chartWidth / 2;
    return paddingLeft + (dayIndex.get(dayKey)! / (n - 1)) * chartWidth;
  }
  function yFor(mastery: number): number {
    return paddingTop + chartHeight - mastery * chartHeight;
  }

  // Thin out X-axis labels so they never overlap when there are many
  // distinct days — always keep the first and last.
  const maxLabels = 6;
  const labelStep = Math.max(1, Math.ceil(n / maxLabels));
  const labeledDays = allDayKeys.filter((_, i) => i % labelStep === 0 || i === n - 1);

  const seriesPoints: [string, string, ChartPoint[]][] = perSeriesByDay.map(([name, color, byDay]) => {
    const pts = allDayKeys
      .filter((d) => byDay.has(d))
      .map((d) => {
        const p = byDay.get(d)!;
        return { name, color, mastery: p.mastery, dayKey: d, dateLabel: formatDayLabel(d) };
      });
    return [name, color, pts];
  });

  return (
    <div style={{ position: "relative" }}>
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Mastery over time chart">
        {[0, 0.25, 0.5, 0.75, 1].map((v) => (
          <g key={v}>
            <line
              x1={paddingLeft}
              x2={width - paddingRight}
              y1={yFor(v)}
              y2={yFor(v)}
              stroke="var(--line)"
              strokeWidth={1}
            />
            <text x={paddingLeft - 8} y={yFor(v) + 3} fontSize={10} fill="var(--faint)" textAnchor="end">
              {Math.round(v * 100)}%
            </text>
          </g>
        ))}

        {allDayKeys.map((d) => (
          <line
            key={d}
            x1={xForDay(d)}
            x2={xForDay(d)}
            y1={paddingTop}
            y2={paddingTop + chartHeight}
            stroke="var(--line)"
            strokeWidth={1}
            opacity={0.6}
          />
        ))}
        {labeledDays.map((d) => (
          <text
            key={d}
            x={xForDay(d)}
            y={height - 6}
            fontSize={10}
            fill="var(--faint)"
            textAnchor="middle"
          >
            {formatDayLabel(d)}
          </text>
        ))}

        {seriesPoints.map(([name, color, pts]) => {
          const coords = pts.map((p) => ({ x: xForDay(p.dayKey), y: yFor(p.mastery) }));
          return (
            <g key={name}>
              {coords.length > 1 && (
                <path d={smoothPath(coords)} fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
              )}
              {pts.map((p, idx) => {
                const isHovered = hover?.name === name && hover.dayKey === p.dayKey;
                return (
                  <circle
                    key={idx}
                    cx={coords[idx].x}
                    cy={coords[idx].y}
                    r={isHovered ? 5.5 : 4}
                    fill={color}
                    stroke="#fff"
                    strokeWidth={1.5}
                    style={{ cursor: "pointer" }}
                    onMouseEnter={() =>
                      setHover({ x: coords[idx].x, y: coords[idx].y, name, color, mastery: p.mastery, dayKey: p.dayKey, dateLabel: p.dateLabel })
                    }
                    onMouseLeave={() => setHover(null)}
                  />
                );
              })}
            </g>
          );
        })}
      </svg>

      {hover && (
        <div
          style={{
            position: "absolute",
            left: `${(hover.x / width) * 100}%`,
            top: `${(hover.y / height) * 100}%`,
            transform: "translate(-50%, -120%)",
            pointerEvents: "none",
            background: "var(--ink)",
            color: "#fff",
            borderRadius: 8,
            padding: "7px 11px",
            fontSize: 12,
            whiteSpace: "nowrap",
            boxShadow: "var(--shadow-lift)",
            zIndex: 1,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700, marginBottom: 2 }}>
            <span style={{ width: 7, height: 7, borderRadius: 4, background: hover.color, display: "inline-block" }} />
            {hover.name}
          </div>
          <div style={{ opacity: 0.8 }}>{hover.dateLabel} · {Math.round(hover.mastery * 100)}% mastery</div>
        </div>
      )}
    </div>
  );
}
