import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import AnalyticsPage from "./AnalyticsPage";
import { api } from "../lib/api";

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return { ...actual, api: { ...actual.api, get: vi.fn() } };
});

function renderAt(projectId: string) {
  return render(
    <MemoryRouter initialEntries={[`/projects/${projectId}/analytics`]}>
      <Routes>
        <Route path="/projects/:projectId/analytics" element={<AnalyticsPage />} />
      </Routes>
    </MemoryRouter>
  );
}

const emptyData = {
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
  recent_activity: [],
  ai_activity_summary: [],
};

const populatedData = {
  summary: {
    total_events: 5,
    materials_uploaded: 1,
    materials_processed: 1,
    quiz_questions_answered: 2,
    tutor_messages: 1,
    assessments_completed: 0,
    recommendations_generated: 0,
  },
  quiz_performance: { total_answers: 2, correct_or_strong: 1, accuracy: 0.5 },
  mastery_summary: { tracked_concepts: 1, average_mastery: 0.42 },
  recent_activity: [
    { type: "quiz_answered", description: "Answered a quiz question on RAG — incorrect", created_at: "2026-01-01T00:00:00Z" },
    { type: "material_uploaded", description: 'Uploaded material "notes.pdf"', created_at: "2026-01-01T00:00:00Z" },
  ],
  ai_activity_summary: [{ feature: "tutor", calls: 3, prompt_tokens: 100, completion_tokens: 50 }],
};

describe("AnalyticsPage", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows an empty state when the Project has no learning activity yet", async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue(emptyData);

    renderAt("p1");

    expect(await screen.findByText("No learning activity yet")).toBeInTheDocument();
    expect(screen.queryByText("Recent Activity")).not.toBeInTheDocument();
  });

  it("shows real summary stats, quiz performance, mastery, and recent activity", async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue(populatedData);

    renderAt("p2");

    expect(await screen.findByText("Total activity")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument(); // quiz accuracy
    expect(screen.getByText("42%")).toBeInTheDocument(); // average mastery
    expect(screen.getByText("Answered a quiz question on RAG — incorrect")).toBeInTheDocument();
    expect(screen.getByText('Uploaded material "notes.pdf"')).toBeInTheDocument();
    expect(screen.getAllByText("tutor").length).toBeGreaterThan(0);
  });
});
