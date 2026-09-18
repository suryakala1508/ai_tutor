import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { ErrorBanner, EmptyState, LoadingBlock } from "../components/Feedback";
import { Donut, CallBars } from "../components/Charts";

interface ActivitySummary {
  total_events: number;
  materials_uploaded: number;
  materials_processed: number;
  quiz_questions_answered: number;
  tutor_messages: number;
  assessments_completed: number;
  recommendations_generated: number;
}

interface QuizPerformance {
  total_answers: number;
  correct_or_strong: number;
  accuracy: number | null;
}

interface MasterySummary {
  tracked_concepts: number;
  average_mastery: number | null;
}

interface ConceptTrends {
  improving: number;
  stable: number;
  requiring_attention: number;
  insufficient_data: number;
}

interface RecentActivityItem {
  type: string;
  description: string;
  created_at: string;
}

interface AISummaryRow {
  feature: string;
  calls: number;
  prompt_tokens: number;
  completion_tokens: number;
}

interface ProjectOverviewRow {
  project_id: string;
  project_name: string;
  space_name: string;
  tracked_concepts: number;
  average_mastery: number | null;
  quiz_accuracy: number | null;
  total_events: number;
}

interface GlobalAnalyticsData {
  totals: { total_spaces: number; total_projects: number };
  summary: ActivitySummary;
  quiz_performance: QuizPerformance;
  mastery_summary: MasterySummary;
  concept_trends: ConceptTrends;
  recent_activity: RecentActivityItem[];
  ai_activity_summary: AISummaryRow[];
  projects_overview: ProjectOverviewRow[];
}

const KPI_ICON = ["📄", "📝", "💬", "💡"];
const KPI_CLASS = ["ic-p", "ic-a", "ic-v", "ic-g"];

function pct(value: number | null): string {
  return value !== null ? `${Math.round(value * 100)}%` : "—";
}

export default function GlobalAnalyticsPage() {
  const [data, setData] = useState<GlobalAnalyticsData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<GlobalAnalyticsData>("/api/analytics/global")
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load your analytics."));
  }, []);

  return (
    <div className="page">
      <div className="page-head" style={{ padding: "0 0 4px" }}>
        <span className="kicker">📈 Analytics</span>
        <h1 className="title" style={{ fontSize: "clamp(28px,4vw,40px)", marginTop: 12 }}>Analytics</h1>
        <p className="subtitle">Your learning activity across every Space and Project.</p>
      </div>

      {error && <ErrorBanner message={error} />}

      {!data && !error && (
        <div className="card" style={{ marginTop: 20 }}>
          <LoadingBlock />
        </div>
      )}

      {data && data.totals.total_projects === 0 && (
        <EmptyState
          title="No Spaces or Projects yet"
          hint="Create a Space and Project, then upload material and start learning to see your analytics here."
        />
      )}

      {data && data.totals.total_projects > 0 && data.summary.total_events === 0 && (
        <EmptyState
          title="No learning activity yet"
          hint="Upload a material, ask the Tutor a question, or take a quiz in one of your Projects to start seeing analytics here."
        />
      )}

      {data && data.summary.total_events > 0 && (
        <div className="stack-g" style={{ marginTop: 24 }}>
          <div className="kpis c4">
            <div className="kpi grad v">
              <div className="k-ico">🎯</div>
              <div className="k-label">Quiz accuracy</div>
              <div className="k-val">{pct(data.quiz_performance.accuracy)}</div>
              <div className="k-sub">{data.quiz_performance.total_answers} questions answered</div>
            </div>
            <div className="kpi grad c">
              <div className="k-ico">🧠</div>
              <div className="k-label">Average mastery</div>
              <div className="k-val">{pct(data.mastery_summary.average_mastery)}</div>
              <div className="k-sub">{data.mastery_summary.tracked_concepts} concepts tracked</div>
            </div>
            <div className="kpi">
              <div className="k-ico ic-v">🗂</div>
              <div className="k-label">Spaces</div>
              <div className="k-val">{data.totals.total_spaces}</div>
            </div>
            <div className="kpi">
              <div className="k-ico ic-c">📁</div>
              <div className="k-label">Projects</div>
              <div className="k-val">{data.totals.total_projects}</div>
            </div>
          </div>

          <div className="kpis c4">
            {[
              ["Materials uploaded", data.summary.materials_uploaded],
              ["Quiz questions", data.summary.quiz_questions_answered],
              ["Tutor messages", data.summary.tutor_messages],
              ["Recommendations", data.summary.recommendations_generated],
            ].map(([label, value], i) => (
              <div className="kpi" key={label as string}>
                <div className={`k-ico ${KPI_CLASS[i]}`}>{KPI_ICON[i]}</div>
                <div className="k-label">{label}</div>
                <div className="k-val">{value}</div>
              </div>
            ))}
          </div>

          <div className="two">
            <div className="card">
              <div className="section-label" style={{ marginBottom: 8 }}>Concept Trends</div>
              <Donut
                centerLabel="concepts"
                data={[
                  { label: "Improving", value: data.concept_trends.improving, color: "#16C784" },
                  { label: "Stable", value: data.concept_trends.stable, color: "#0FC5C0" },
                  { label: "Requiring attention", value: data.concept_trends.requiring_attention, color: "#FF4D6D" },
                  { label: "Insufficient data", value: data.concept_trends.insufficient_data, color: "#9497B8" },
                ]}
              />
            </div>
            <div className="card">
              <div className="section-label" style={{ marginBottom: 8 }}>AI Calls by Feature</div>
              {data.ai_activity_summary.length === 0 ? (
                <EmptyState title="No AI activity yet" />
              ) : (
                <CallBars rows={data.ai_activity_summary.map((r) => ({ label: r.feature, value: r.calls }))} />
              )}
            </div>
          </div>

          <div className="block">
            <div className="section-label" style={{ padding: "22px 24px 4px" }}>Projects Overview</div>
            {data.projects_overview.length === 0 ? (
              <div style={{ padding: "0 24px 24px" }}><EmptyState title="No Projects yet" /></div>
            ) : (
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th style={{ paddingLeft: 24 }}>Project</th>
                      <th>Space</th>
                      <th className="r">Concepts</th>
                      <th className="r">Mastery</th>
                      <th className="r">Quiz accuracy</th>
                      <th className="r" style={{ paddingRight: 24 }}>Activity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.projects_overview.map((row) => (
                      <tr key={row.project_id}>
                        <td style={{ paddingLeft: 24 }}>
                          <Link to={`/projects/${row.project_id}`} className="lead">{row.project_name}</Link>
                        </td>
                        <td style={{ color: "var(--muted)" }}>{row.space_name}</td>
                        <td className="r">{row.tracked_concepts}</td>
                        <td className="r">
                          <span className={`badge ${
                            row.average_mastery === null ? "b-muted" : row.average_mastery >= 0.7 ? "b-green" : row.average_mastery >= 0.4 ? "b-amber" : "b-red"
                          }`}>
                            {pct(row.average_mastery)}
                          </span>
                        </td>
                        <td className="r">{pct(row.quiz_accuracy)}</td>
                        <td className="r" style={{ paddingRight: 24 }}>{row.total_events}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="two">
            <div className="block">
              <div className="section-label" style={{ padding: "22px 24px 4px" }}>AI Activity Summary</div>
              {data.ai_activity_summary.length === 0 ? (
                <div style={{ padding: "0 24px 24px" }}><EmptyState title="No AI activity yet" /></div>
              ) : (
                <div className="tbl-wrap">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th style={{ paddingLeft: 24 }}>Feature</th>
                        <th className="r">Calls</th>
                        <th className="r">Prompt tok</th>
                        <th className="r" style={{ paddingRight: 24 }}>Completion tok</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.ai_activity_summary.map((row, i) => (
                        <tr key={row.feature}>
                          <td style={{ paddingLeft: 24 }}>
                            <span className="feat-dot">
                              <span style={{ background: ["#6D4AFF", "#FF4D8D", "#0FC5C0", "#FF9F1C", "#16C784", "#8A6BFF"][i % 6] }} />
                              {row.feature}
                            </span>
                          </td>
                          <td className="r">{row.calls}</td>
                          <td className="r">{row.prompt_tokens}</td>
                          <td className="r" style={{ paddingRight: 24 }}>{row.completion_tokens}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="block">
              <div className="section-label" style={{ padding: "22px 24px 4px" }}>Recent Activity</div>
              {data.recent_activity.length === 0 ? (
                <div style={{ padding: "0 24px 24px" }}><EmptyState title="No activity yet" /></div>
              ) : (
                <div>
                  {data.recent_activity.map((item, i) => (
                    <div key={i} className="act-row" style={{ padding: "12px 24px" }}>
                      <span className="what">{item.description}</span>
                      <span className="when">{new Date(item.created_at).toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
