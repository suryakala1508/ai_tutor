import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { ErrorBanner, EmptyState, LoadingBlock } from "../components/Feedback";
import { CallBars } from "../components/Charts";

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

interface AnalyticsData {
  summary: ActivitySummary;
  quiz_performance: QuizPerformance;
  mastery_summary: MasterySummary;
  recent_activity: RecentActivityItem[];
  ai_activity_summary: AISummaryRow[];
}

const KPI_ICON = ["📊", "📄", "⚙️", "📝", "💬", "✅", "💡"];
const KPI_CLASS = ["ic-v", "ic-p", "ic-c", "ic-a", "ic-g", "ic-m", "ic-v"];

export default function AnalyticsPage() {
  const { projectId } = useParams();
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    api
      .get<AnalyticsData>(`/api/projects/${projectId}/analytics`)
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load analytics."));
  }, [projectId]);

  return (
    <div className="page">
      <div className="crumb">
        <Link to={`/projects/${projectId}`} style={{ color: "inherit" }}>← Project</Link>
      </div>
      <h1 className="h-disp" style={{ fontSize: 26, marginBottom: 20 }}>Analytics</h1>

      {error && <ErrorBanner message={error} />}

      {!data && !error && (
        <div className="card">
          <LoadingBlock />
        </div>
      )}

      {data && data.summary.total_events === 0 && (
        <EmptyState
          title="No learning activity yet"
          hint="Upload a material, ask the Tutor a question, or take a quiz to start seeing analytics for this Project."
        />
      )}

      {data && data.summary.total_events > 0 && (
        <div className="stack-g">
          <div className="kpis c3">
            <div className="kpi grad v">
              <div className="k-ico">🎯</div>
              <div className="k-label">Quiz accuracy</div>
              <div className="k-val">
                {data.quiz_performance.accuracy !== null ? `${Math.round(data.quiz_performance.accuracy * 100)}%` : "—"}
              </div>
              <div className="k-sub">{data.quiz_performance.total_answers} questions answered</div>
            </div>
            <div className="kpi grad c">
              <div className="k-ico">🧠</div>
              <div className="k-label">Average mastery</div>
              <div className="k-val">
                {data.mastery_summary.average_mastery !== null ? `${Math.round(data.mastery_summary.average_mastery * 100)}%` : "—"}
              </div>
              <div className="k-sub">{data.mastery_summary.tracked_concepts} concepts tracked</div>
            </div>
            <div className="kpi">
              <div className="k-ico ic-v">⚡</div>
              <div className="k-label">Total activity</div>
              <div className="k-val">{data.summary.total_events}</div>
              <div className="k-sub">events recorded</div>
            </div>
          </div>

          <div className="kpis c6">
            {[
              ["Materials uploaded", data.summary.materials_uploaded],
              ["Materials processed", data.summary.materials_processed],
              ["Quiz questions", data.summary.quiz_questions_answered],
              ["Tutor messages", data.summary.tutor_messages],
              ["Assessments done", data.summary.assessments_completed],
              ["Recommendations", data.summary.recommendations_generated],
            ].map(([label, value], i) => (
              <div className="kpi" key={label as string}>
                <div className={`k-ico ${KPI_CLASS[i]}`}>{KPI_ICON[i]}</div>
                <div className="k-label">{label}</div>
                <div className="k-val">{value}</div>
              </div>
            ))}
          </div>

          <div className="block">
            <div className="section-label" style={{ padding: "22px 24px 6px" }}>AI Activity by Feature</div>
            {data.ai_activity_summary.length === 0 ? (
              <div style={{ padding: "0 24px 24px" }}><EmptyState title="No AI activity yet" /></div>
            ) : (
              <div style={{ padding: "10px 24px 24px" }}>
                <CallBars rows={data.ai_activity_summary.map((r) => ({ label: r.feature, value: r.calls }))} />
              </div>
            )}
            {data.ai_activity_summary.length > 0 && (
              <table className="tbl" style={{ padding: "0 4px" }}>
                <thead>
                  <tr>
                    <th style={{ paddingLeft: 24 }}>Feature</th>
                    <th className="r">Calls</th>
                    <th className="r">Prompt tokens</th>
                    <th className="r" style={{ paddingRight: 24 }}>Completion tokens</th>
                  </tr>
                </thead>
                <tbody>
                  {data.ai_activity_summary.map((row) => (
                    <tr key={row.feature}>
                      <td style={{ paddingLeft: 24 }}>
                        <span className="feat-dot">
                          <span style={{ background: "var(--violet)" }} />
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
            )}
          </div>

          <div className="block">
            <div className="section-label" style={{ padding: "22px 24px 4px" }}>Recent Activity</div>
            {data.recent_activity.length === 0 ? (
              <div style={{ padding: "0 24px 24px" }}><EmptyState title="No activity yet" /></div>
            ) : (
              <div>
                {data.recent_activity.map((item, i) => (
                  <div key={i} className="act-row">
                    <span className="what">{item.description}</span>
                    <span className="when">{new Date(item.created_at).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
