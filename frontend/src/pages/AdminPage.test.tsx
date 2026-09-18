import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AdminPage from "./AdminPage";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return { ...actual, api: { ...actual.api, get: vi.fn() } };
});

vi.mock("../lib/auth", async () => {
  const actual = await vi.importActual<typeof import("../lib/auth")>("../lib/auth");
  return { ...actual, useAuth: vi.fn() };
});

const overview = {
  total_users: 3,
  total_spaces: 2,
  total_projects: 4,
  total_materials: 5,
  materials_by_status: { queued: 1, processing: 0, ready: 3, failed: 1 },
  quiz_answers_total: 10,
  assessments_completed_total: 2,
  tutor_messages_total: 6,
};

const aiUsage = { by_feature: [], success_rate: null, total_calls_30d: 0, estimated_cost_usd_30d: 0 };
const health = { database_reachable: true, queue_depth: 0, recent_error_count_1h: 0, recent_failures: [] };

function mockAdminEndpoints(overrides: Partial<Record<string, unknown>> = {}) {
  (api.get as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
    if (path.includes("/overview")) return Promise.resolve(overrides.overview ?? overview);
    if (path.includes("/ai-usage")) return Promise.resolve(overrides.aiUsage ?? aiUsage);
    if (path.includes("/health")) return Promise.resolve(overrides.health ?? health);
    if (path.includes("/evals")) return Promise.resolve([]);
    if (path.includes("/jobs")) return Promise.resolve({});
    if (path.includes("/users")) return Promise.resolve([]);
    if (path.includes("/activity")) return Promise.resolve([]);
    return Promise.resolve([]);
  });
}

describe("AdminPage", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows a restricted message for a non-admin user without calling any admin API", async () => {
    const nonAdminUser = { id: "u1", name: "Reg", email: "reg@test.com", is_admin: false };
    (useAuth as ReturnType<typeof vi.fn>).mockReturnValue({
      user: nonAdminUser,
      refreshUser: vi.fn().mockResolvedValue(nonAdminUser),
    });
    mockAdminEndpoints();

    render(<AdminPage />);

    expect(await screen.findByText("Admin access required")).toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
  });

  it("re-verifies admin status against the live server on mount, not just the cached session", async () => {
    // A browser tab's cached session can predate a role change (e.g. being
    // promoted to admin after this tab already logged in). AdminPage must
    // re-check via a live /api/auth/me call (refreshUser) rather than
    // trusting the cached `user` object indefinitely.
    const adminUser = { id: "u1", name: "Admin", email: "admin@test.com", is_admin: true };
    const refreshUserMock = vi.fn().mockResolvedValue(adminUser);
    (useAuth as ReturnType<typeof vi.fn>).mockReturnValue({ user: adminUser, refreshUser: refreshUserMock });
    mockAdminEndpoints();

    render(<AdminPage />);

    await screen.findByText("Total users");
    expect(refreshUserMock).toHaveBeenCalledTimes(1);
  });

  it("shows real system totals, materials-by-status, and recent failures for an admin", async () => {
    const adminUser = { id: "u1", name: "Admin", email: "admin@test.com", is_admin: true };
    (useAuth as ReturnType<typeof vi.fn>).mockReturnValue({
      user: adminUser,
      refreshUser: vi.fn().mockResolvedValue(adminUser),
    });
    mockAdminEndpoints({
      health: {
        database_reachable: true,
        queue_depth: 0,
        recent_error_count_1h: 1,
        recent_failures: [
          { source: "ai_usage", label: "quiz_generation", error_message: "LLM provider unavailable", created_at: "2026-01-01T00:00:00Z" },
        ],
      },
    });

    render(<AdminPage />);

    expect(await screen.findByText("Total users")).toBeInTheDocument();
    expect(screen.getAllByText("3").length).toBeGreaterThan(0);
    expect(screen.getByText("Materials by Status")).toBeInTheDocument();
    expect(screen.getByText("Recent Failures")).toBeInTheDocument();
    expect(screen.getByText(/quiz_generation/)).toBeInTheDocument();
    expect(screen.getByText(/LLM provider unavailable/)).toBeInTheDocument();
  });
});
