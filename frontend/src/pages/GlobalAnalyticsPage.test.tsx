import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import GlobalAnalyticsPage from "./GlobalAnalyticsPage";
import { api } from "../lib/api";

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return { ...actual, api: { ...actual.api, get: vi.fn() } };
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/analytics"]}>
      <GlobalAnalyticsPage />
    </MemoryRouter>
  );
}

const noProjectsData = {
  totals: { total_spaces: 0, total_projects: 0 },
  summary: {
    total_events: 0,
    materials_uploaded: 0,
    materials_processed: 0,
    quiz_questions_answered: 0,
    tutor_messages: 0,
    assessments_completed: 0,
    recommendations_generated: 0,
  },
  quiz_performance: { total_answers: 0, correct_or_strong: 0, accuracy: null },
  mastery_summary: { tracked_concepts: 0, average_mastery: null },
  concept_trends: { improving: 0, stable: 0, requiring_attention: 0, insufficient_data: 0 },
  recent_activity: [],
  ai_activity_summary: [],
  projects_overview: [],
};

const populatedData = {
  totals: { total_spaces: 2, total_projects: 2 },
  summary: {
    total_events: 4,
    materials_uploaded: 1,
    materials_processed: 1,
    quiz_questions_answered: 1,
    tutor_messages: 1,
    assessments_completed: 0,
    recommendations_generated: 0,
  },
  quiz_performance: { total_answers: 2, correct_or_strong: 1, accuracy: 0.5 },
  mastery_summary: { tracked_concepts: 2, average_mastery: 0.6 },
  concept_trends: { improving: 1, stable: 0, requiring_attention: 1, insufficient_data: 0 },
  recent_activity: [
    { type: "tutor_conversation", description: "Asked the AI Tutor a question", created_at: "2026-01-01T00:00:00Z" },
  ],
  ai_activity_summary: [{ feature: "tutor", calls: 2, prompt_tokens: 50, completion_tokens: 20 }],
  projects_overview: [
    {
      project_id: "p1",
      project_name: "ML Basics",
      space_name: "School",
      tracked_concepts: 2,
      average_mastery: 0.6,
      quiz_accuracy: 0.5,
      total_events: 4,
    },
  ],
};

describe("GlobalAnalyticsPage", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows an empty state when the user has no Spaces or Projects yet", async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue(noProjectsData);

    renderPage();

    expect(await screen.findByText("No Spaces or Projects yet")).toBeInTheDocument();
  });

  it("shows global totals, quiz performance, concept trends, projects overview, and recent activity", async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue(populatedData);

    renderPage();

    expect(await screen.findByText("Spaces")).toBeInTheDocument();
    expect(screen.getByText("Concept Trends")).toBeInTheDocument();
    expect(screen.getByText("Projects Overview")).toBeInTheDocument();
    expect(screen.getByText("ML Basics")).toBeInTheDocument();
    expect(screen.getByText("School")).toBeInTheDocument();
    expect(screen.getByText("Asked the AI Tutor a question")).toBeInTheDocument();
    expect(screen.queryByText(/rank/i)).not.toBeInTheDocument();
  });
});
