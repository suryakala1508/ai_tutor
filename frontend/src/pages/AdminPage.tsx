import { useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";
import { ErrorBanner, EmptyState } from "../components/Feedback";
import { useAuth } from "../lib/auth";

function truncate(text: string | null, max = 160): string {
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

interface AdminUser {
  id: string;
  email: string;
  is_admin: boolean;
  created_at: string;
}

interface AIUsageByFeature {
  feature: string;
  calls: number;
  avg_latency_ms: number;
  prompt_tokens: number;
  completion_tokens: number;
}

interface AIUsagePanel {
  by_feature: AIUsageByFeature[];
  success_rate: number | null;
  total_calls_30d: number;
  estimated_cost_usd_30d: number;
}

interface EvalRow {
  suite: string;
  passed: number;
  failed: number;
  created_at: string;
}

interface RecentFailure {
  source: string;
  label: string;
  error_message: string | null;
  created_at: string;
}

interface Health {
  database_reachable: boolean;
  queue_depth: number;
  recent_error_count_1h: number;
  recent_failures: RecentFailure[];
}

interface Overview {
  total_users: number;
  total_spaces: number;
  total_projects: number;
  total_materials: number;
  materials_by_status: { queued: number; processing: number; ready: number; failed: number };
  quiz_answers_total: number;
  assessments_completed_total: number;
  tutor_messages_total: number;
}

interface UserJourney {
  user: { id: string; email: string; is_admin: boolean };
  spaces: { id: string; name: string }[];
  projects: { id: string; name: string; space_id: string }[];
  recent_activity: { type: string; created_at: string }[];
  recent_ai_usage: { feature: string; model: string | null; success: boolean; created_at: string }[];
}

interface ActivityRow {
  id: string;
  type: string;
  project_id: string;
  owner_id: string;
  created_at: string;
}

export default function AdminPage() {
  const { user, refreshUser } = useAuth();
  const [checkedAdmin, setCheckedAdmin] = useState(false);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [aiUsage, setAiUsage] = useState<AIUsagePanel | null>(null);
  const [evals, setEvals] = useState<EvalRow[] | null>(null);
  const [jobs, setJobs] = useState<Record<string, number> | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [journey, setJourney] = useState<UserJourney | null>(null);
  const [journeyLoading, setJourneyLoading] = useState(false);

  const [activity, setActivity] = useState<ActivityRow[] | null>(null);
  const [activityFilters, setActivityFilters] = useState({ user_id: "", project_id: "", event_type: "" });

  function loadActivity() {
    const params = new URLSearchParams();
    if (activityFilters.user_id) params.set("user_id", activityFilters.user_id);
    if (activityFilters.project_id) params.set("project_id", activityFilters.project_id);
    if (activityFilters.event_type) params.set("event_type", activityFilters.event_type);
    params.set("limit", "50");
    api
      .get<ActivityRow[]>(`/api/admin/activity?${params.toString()}`)
      .then(setActivity)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load activity feed."));
  }

  useEffect(() => {
    // Always re-verify against the server rather than trusting whatever
    // `is_admin` this browser tab's session happened to cache at login —
    // a role change on the backend (e.g. being promoted to admin) must be
    // recognized here even if this tab logged in before that happened.
    refreshUser().finally(() => setCheckedAdmin(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!checkedAdmin || !user?.is_admin) return;
    Promise.all([
      api.get<Overview>("/api/admin/overview"),
      api.get<AdminUser[]>("/api/admin/users"),
      api.get<AIUsagePanel>("/api/admin/ai-usage"),
      api.get<EvalRow[]>("/api/admin/evals"),
      api.get<Record<string, number>>("/api/admin/jobs"),
      api.get<Health>("/api/admin/health"),
    ])
      .then(([o, u, a, e, j, h]) => {
        setOverview(o);
        setUsers(u);
        setAiUsage(a);
        setEvals(e);
        setJobs(j);
        setHealth(h);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load admin data."));
    loadActivity();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkedAdmin, user?.is_admin]);

  function openUserJourney(userId: string) {
    setSelectedUserId(userId);
    setJourney(null);
    setJourneyLoading(true);
    api
      .get<UserJourney>(`/api/admin/users/${userId}`)
      .then(setJourney)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load this user's journey."))
      .finally(() => setJourneyLoading(false));
  }

  if (!checkedAdmin) {
    return <div className="page">Loading…</div>;
  }

  if (!user?.is_admin) {
    return (
      <div className="page">
        <EmptyState title="Admin access required" hint="This dashboard is restricted to admin users." />
      </div>
    );
  }

  return (
    <div className="page">
      <h1 className="h-disp" style={{ fontSize: 26, marginBottom: 20 }}>Admin Dashboard</h1>
      {error && <ErrorBanner message={error} />}

      <div className="stack-g">
        {overview && (
          <div className="kpis c6">
            <div className="kpi grad v">
              <div className="k-ico"><span className="material-symbols-outlined">group</span></div>
              <div className="k-label">Total users</div>
              <div className="k-val">{overview.total_users}</div>
            </div>
            <div className="kpi">
              <div className="k-ico ic-v"><span className="material-symbols-outlined">workspaces</span></div>
              <div className="k-label">Total Spaces</div>
              <div className="k-val">{overview.total_spaces}</div>
            </div>
            <div className="kpi">
              <div className="k-ico ic-c"><span className="material-symbols-outlined">folder</span></div>
              <div className="k-label">Total Projects</div>
              <div className="k-val">{overview.total_projects}</div>
            </div>
            <div className="kpi">
              <div className="k-ico ic-p"><span className="material-symbols-outlined">description</span></div>
              <div className="k-label">Materials</div>
              <div className="k-val">{overview.total_materials}</div>
            </div>
            <div className="kpi">
              <div className="k-ico ic-a"><span className="material-symbols-outlined">quiz</span></div>
              <div className="k-label">Quiz answers</div>
              <div className="k-val">{overview.quiz_answers_total}</div>
            </div>
            <div className="kpi">
              <div className="k-ico ic-g"><span className="material-symbols-outlined">forum</span></div>
              <div className="k-label">Tutor messages</div>
              <div className="k-val">{overview.tutor_messages_total}</div>
            </div>
          </div>
        )}

        {overview && (
          <div className="block">
            <div className="section-label" style={{ padding: "22px 24px 4px" }}>Materials by Status</div>
            <div className="kpis c4" style={{ padding: 24 }}>
              <div className="kpi">
                <div className="k-ico ic-m"><span className="material-symbols-outlined">hourglass_empty</span></div>
                <div className="k-label">Queued</div>
                <div className="k-val">{overview.materials_by_status.queued}</div>
              </div>
              <div className="kpi">
                <div className="k-ico ic-a"><span className="material-symbols-outlined">autorenew</span></div>
                <div className="k-label">Processing</div>
                <div className="k-val">{overview.materials_by_status.processing}</div>
              </div>
              <div className="kpi">
                <div className="k-ico ic-g"><span className="material-symbols-outlined">check_circle</span></div>
                <div className="k-label" style={{ color: "var(--green)" }}>Ready</div>
                <div className="k-val" style={{ color: "var(--green)" }}>{overview.materials_by_status.ready}</div>
              </div>
              <div className="kpi">
                <div className="k-ico ic-p"><span className="material-symbols-outlined">cancel</span></div>
                <div className="k-label" style={{ color: "var(--red)" }}>Failed</div>
                <div className="k-val" style={{ color: "var(--red)" }}>{overview.materials_by_status.failed}</div>
              </div>
            </div>
          </div>
        )}

        <div className="kpis c3">
          <div className="kpi">
            <div className="k-label">DB reachable</div>
            <div className="k-val" style={{ color: health?.database_reachable ? "var(--green)" : "var(--red)", fontSize: 24 }}>
              {health ? (health.database_reachable ? "Yes" : "No") : "—"}
            </div>
          </div>
          <div className="kpi">
            <div className="k-label">Queue depth</div>
            <div className="k-val">{health?.queue_depth ?? "—"}</div>
          </div>
          <div className="kpi">
            <div className="k-label">Errors (1h)</div>
            <div className="k-val">{health?.recent_error_count_1h ?? "—"}</div>
          </div>
        </div>

        <div className="block">
          <div className="section-label" style={{ padding: "22px 24px 4px" }}>Recent Failures</div>
          {health && health.recent_failures.length === 0 && <div style={{ padding: "0 24px 24px" }}><EmptyState title="No failures recorded" /></div>}
          {health && health.recent_failures.length > 0 && (
            <div style={{ padding: "8px 24px 22px", display: "flex", flexDirection: "column", gap: 8 }}>
              {health.recent_failures.map((f, i) => (
                <div
                  key={i}
                  style={{
                    fontSize: 12.5,
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                    padding: "10px 14px",
                    borderRadius: "var(--radius-sm)",
                    background: "var(--red-tint)",
                    borderLeft: "3px solid var(--red)",
                  }}
                >
                  <span title={f.error_message || undefined}>
                    <span style={{ color: "var(--muted)" }}>[{f.source === "ai_usage" ? "AI" : "job"}]</span> {f.label}
                    {f.error_message ? ` — ${truncate(f.error_message)}` : ""}
                  </span>
                  <span style={{ color: "var(--muted)", flexShrink: 0 }}>{new Date(f.created_at).toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="block">
          <div className="section-label" style={{ padding: "22px 24px 4px" }}>AI Usage (30 days)</div>
          {aiUsage && (
            <div style={{ padding: "0 24px 12px", color: "var(--muted)", fontSize: 13.5 }}>
              {aiUsage.total_calls_30d} calls · {aiUsage.success_rate !== null ? `${Math.round(aiUsage.success_rate * 100)}% success` : "—"} ·
              {" "}est. ${aiUsage.estimated_cost_usd_30d.toFixed(2)}
            </div>
          )}
          {aiUsage && aiUsage.by_feature.length > 0 && (
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ paddingLeft: 24 }}>Feature</th><th className="r">Calls</th><th className="r">Avg latency (ms)</th><th className="r">Prompt tok</th><th className="r" style={{ paddingRight: 24 }}>Completion tok</th>
                </tr>
              </thead>
              <tbody>
                {aiUsage.by_feature.map((row) => (
                  <tr key={row.feature}>
                    <td style={{ paddingLeft: 24 }}>{row.feature}</td>
                    <td className="r">{row.calls}</td>
                    <td className="r">{row.avg_latency_ms}</td>
                    <td className="r">{row.prompt_tokens}</td>
                    <td className="r" style={{ paddingRight: 24 }}>{row.completion_tokens}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="two">
          <div className="block">
            <div className="section-label" style={{ padding: "22px 24px 4px" }}>Eval Results</div>
            <div style={{ padding: "4px 24px 20px" }}>
              {evals && evals.length === 0 && <EmptyState title="No eval runs yet" hint="Run app/evals/*.py to populate this." />}
              {evals && evals.map((e, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5, padding: "6px 0" }}>
                  <span>{e.suite}</span>
                  <span>
                    <span style={{ color: "var(--green)", fontWeight: 700 }}>{e.passed} pass</span>{" / "}
                    <span style={{ color: "var(--red)", fontWeight: 700 }}>{e.failed} fail</span>
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="block">
            <div className="section-label" style={{ padding: "22px 24px 4px" }}>Background Jobs</div>
            <div style={{ padding: "4px 24px 20px" }}>
              {jobs && Object.entries(jobs).map(([status, count]) => (
                <div key={status} style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5, padding: "6px 0" }}>
                  <span style={{ textTransform: "capitalize" }}>{status}</span>
                  <span style={{ fontWeight: 700 }}>{count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="block">
          <div className="section-label" style={{ padding: "22px 24px 4px" }}>Platform Activity</div>
          <div style={{ display: "flex", gap: 8, padding: "10px 24px", flexWrap: "wrap" }}>
            <input
              placeholder="Filter by user id"
              value={activityFilters.user_id}
              onChange={(e) => setActivityFilters((f) => ({ ...f, user_id: e.target.value }))}
              style={{ fontSize: 12.5, padding: "8px 11px" }}
            />
            <input
              placeholder="Filter by project id"
              value={activityFilters.project_id}
              onChange={(e) => setActivityFilters((f) => ({ ...f, project_id: e.target.value }))}
              style={{ fontSize: 12.5, padding: "8px 11px" }}
            />
            <input
              placeholder="Filter by event type"
              value={activityFilters.event_type}
              onChange={(e) => setActivityFilters((f) => ({ ...f, event_type: e.target.value }))}
              style={{ fontSize: 12.5, padding: "8px 11px" }}
            />
            <button className="btn btn-primary btn-sm" onClick={loadActivity}>
              Apply filters
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setActivityFilters({ user_id: "", project_id: "", event_type: "" });
                setTimeout(loadActivity, 0);
              }}
            >
              Clear
            </button>
          </div>
          {activity && activity.length === 0 && <div style={{ padding: "0 24px 22px" }}><EmptyState title="No activity matches these filters" /></div>}
          {activity && activity.length > 0 && (
            <div style={{ padding: "4px 24px 22px", display: "flex", flexDirection: "column", gap: 2, maxHeight: 260, overflowY: "auto" }}>
              {activity.map((a) => (
                <div key={a.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "6px 0", borderBottom: "1px solid var(--line)" }}>
                  <span>{a.type.replace(/_/g, " ")}</span>
                  <span style={{ color: "var(--faint)" }}>
                    {a.owner_id.slice(0, 8)}… · {a.project_id.slice(0, 8)}… · {new Date(a.created_at).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="block">
          <div className="section-label" style={{ padding: "22px 24px 4px" }}>Users (click a row to inspect their journey)</div>
          {users && (
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ paddingLeft: 24 }}>Email</th><th>Admin</th><th style={{ paddingRight: 24 }}>Joined</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr
                    key={u.id}
                    onClick={() => openUserJourney(u.id)}
                    style={{
                      cursor: "pointer",
                      background: selectedUserId === u.id ? "var(--violet-tint)" : "transparent",
                    }}
                  >
                    <td style={{ paddingLeft: 24 }}>{u.email}</td>
                    <td>{u.is_admin ? "Yes" : "No"}</td>
                    <td style={{ paddingRight: 24 }}>{new Date(u.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {selectedUserId && (
          <div className="block">
            <div className="section-label" style={{ padding: "22px 24px 4px" }}>
              User Journey {journey ? `— ${journey.user.email}` : ""}
            </div>
            {journeyLoading && <div style={{ padding: "0 24px 22px", color: "var(--muted)" }}>Loading…</div>}
            {journey && (
              <div className="two" style={{ padding: "8px 24px 22px", marginTop: 0 }}>
                <div>
                  <div style={{ fontWeight: 700, marginBottom: 8, fontSize: 13.5, color: "var(--muted)" }}>Spaces &amp; Projects</div>
                  {journey.spaces.length === 0 && <div style={{ color: "var(--faint)" }}>No Spaces yet.</div>}
                  {journey.spaces.map((s) => (
                    <div key={s.id} style={{ marginBottom: 8 }}>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{s.name}</div>
                      {journey.projects
                        .filter((p) => p.space_id === s.id)
                        .map((p) => (
                          <div key={p.id} style={{ color: "var(--muted)", paddingLeft: 12, fontSize: 13.5 }}>
                            {p.name}
                          </div>
                        ))}
                    </div>
                  ))}
                </div>
                <div>
                  <div style={{ fontWeight: 700, marginBottom: 8, fontSize: 13.5, color: "var(--muted)" }}>Recent Activity</div>
                  {journey.recent_activity.length === 0 && <div style={{ color: "var(--faint)" }}>No activity yet.</div>}
                  <div style={{ maxHeight: 200, overflowY: "auto" }}>
                    {journey.recent_activity.map((a, i) => (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "3px 0" }}>
                        <span>{a.type.replace(/_/g, " ")}</span>
                        <span style={{ color: "var(--faint)" }}>{new Date(a.created_at).toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{ margin: "12px 0 6px", fontWeight: 700, fontSize: 13.5, color: "var(--muted)" }}>Recent AI Usage</div>
                  <div style={{ maxHeight: 150, overflowY: "auto" }}>
                    {journey.recent_ai_usage.map((a, i) => (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "3px 0" }}>
                        <span>{a.feature} {a.model ? `(${a.model})` : ""}</span>
                        <span style={{ color: a.success ? "var(--green)" : "var(--red)", fontWeight: 700 }}>
                          {a.success ? "ok" : "failed"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
