import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import GrowthPage from "./GrowthPage";
import { api } from "../lib/api";

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return { ...actual, api: { ...actual.api, get: vi.fn() } };
});

function renderAt(projectId: string) {
  return render(
    <MemoryRouter initialEntries={[`/projects/${projectId}/growth`]}>
      <Routes>
        <Route path="/projects/:projectId/growth" element={<GrowthPage />} />
      </Routes>
    </MemoryRouter>
  );
}

const baseGrowth = {
  summary: { tracked_concepts: 1, improving: 0, stable: 1, requiring_attention: 0, average_mastery: 0.5 },
  concepts: [
    {
      concept_id: "c1",
      concept_name: "RAG",
      current_mastery: 0.5,
      previous_mastery: 0.4,
      change: 0.1,
      status: "stable",
      status_label: "Stable",
      attempts: 3,
      last_practiced_at: "2026-01-01T00:00:00Z",
    },
  ],
};

describe("GrowthPage — Recommended Next", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows ranked recommendations with reason, action, and priority", async () => {
    (api.get as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
      if (path.includes("/recommendations")) {
        return Promise.resolve({
          insufficient_data: false,
          message: null,
          recommendations: [
            {
              title: "Clear up confusion on RAG",
              reason: "3 of your last 5 answers on RAG were incorrect or showed weak understanding (current mastery: 50%).",
              suggested_action: "Ask the AI Tutor to re-explain RAG, then retake a quiz on it to confirm it clicked.",
              action_type: "use_tutor",
              concept_id: "c1",
              concept_name: "RAG",
              priority: "high",
              priority_score: 0.7,
            },
          ],
        });
      }
      if (path.includes("/growth")) return Promise.resolve(baseGrowth);
      return Promise.resolve({ mastery_trend_chart: [] });
    });

    renderAt("p1");

    expect(await screen.findByText("Recommended Next")).toBeInTheDocument();
    expect(await screen.findByText("Clear up confusion on RAG")).toBeInTheDocument();
    expect(screen.getByText(/3 of your last 5 answers on RAG/)).toBeInTheDocument();
    expect(screen.getByText(/Ask the AI Tutor to re-explain RAG/)).toBeInTheDocument();
    expect(screen.getByText("high")).toBeInTheDocument();
    expect(screen.getByText(/Use the Tutor/)).toBeInTheDocument();
  });

  it("shows a positive empty state when there are no recommendations but data exists", async () => {
    (api.get as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
      if (path.includes("/recommendations")) {
        return Promise.resolve({
          insufficient_data: false,
          message: "You're doing well across every tracked concept right now — no concept needs urgent attention. Keep practicing to maintain your mastery.",
          recommendations: [],
        });
      }
      if (path.includes("/growth")) return Promise.resolve(baseGrowth);
      return Promise.resolve({ mastery_trend_chart: [] });
    });

    renderAt("p2");

    expect(await screen.findByText("Nothing urgent right now")).toBeInTheDocument();
    expect(screen.getByText(/no concept needs urgent attention/)).toBeInTheDocument();
  });

  it("does not render the recommendations card when the Project has no mastery data at all", async () => {
    (api.get as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
      if (path.includes("/recommendations")) {
        return Promise.resolve({ insufficient_data: true, message: "Complete a quiz first.", recommendations: [] });
      }
      if (path.includes("/growth")) {
        return Promise.resolve({
          summary: { tracked_concepts: 0, improving: 0, stable: 0, requiring_attention: 0, average_mastery: null },
          concepts: [],
        });
      }
      return Promise.resolve({ mastery_trend_chart: [] });
    });

    renderAt("p3");

    expect(await screen.findByText("No mastery data yet.")).toBeInTheDocument();
    expect(screen.queryByText("Recommended Next")).not.toBeInTheDocument();
  });
});

describe("GrowthPage — Mastery Over Time chart", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  const trendChartData = {
    mastery_trend_chart: [
      // Two snapshots for RAG on the SAME calendar day -- must collapse to
      // one point on the chart rather than overlapping.
      { concept_id: "c1", concept_name: "RAG", mastery: 0.3, created_at: "2026-01-05T09:00:00Z" },
      { concept_id: "c1", concept_name: "RAG", mastery: 0.4, created_at: "2026-01-05T18:00:00Z" },
      { concept_id: "c1", concept_name: "RAG", mastery: 0.7, created_at: "2026-01-12T09:00:00Z" },
      // A second concept with a single data point.
      { concept_id: "c2", concept_name: "Embeddings", mastery: 0.5, created_at: "2026-01-05T09:00:00Z" },
    ],
  };

  function mockChartEndpoints() {
    (api.get as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
      if (path.includes("/recommendations")) return Promise.resolve({ insufficient_data: true, message: "x", recommendations: [] });
      if (path.includes("/growth")) return Promise.resolve(baseGrowth);
      return Promise.resolve(trendChartData);
    });
  }

  it("renders the chart and collapses same-day points instead of duplicating them", async () => {
    mockChartEndpoints();

    const { container } = renderAt("p4");

    const svg = await screen.findByRole("img", { name: /mastery over time/i });
    expect(svg).toBeInTheDocument();

    // RAG has 3 raw snapshots but only 2 distinct calendar days -- the same
    // day's two snapshots must render as a single point, not two.
    const circles = container.querySelectorAll("circle");
    expect(circles.length).toBe(3); // RAG x2 days + Embeddings x1 day
  });

  it("shows a hover tooltip with concept, date, and mastery percent", async () => {
    mockChartEndpoints();

    const { container } = renderAt("p5");
    await screen.findByRole("img", { name: /mastery over time/i });

    const firstCircle = container.querySelector("circle")!;
    fireEvent.mouseEnter(firstCircle);

    // The first circle is RAG's aggregated point for Jan 5 (last of its two
    // same-day snapshots: mastery 0.4) -- the tooltip must show the concept,
    // that date, and that mastery percentage together.
    const tooltip = await screen.findByText(/40% mastery/);
    expect(tooltip).toBeInTheDocument();
    expect(tooltip.parentElement).toHaveTextContent("RAG");
  });
});
