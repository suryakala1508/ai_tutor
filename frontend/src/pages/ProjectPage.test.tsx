import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import ProjectPage from "./ProjectPage";
import { api } from "../lib/api";

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return { ...actual, api: { ...actual.api, get: vi.fn(), post: vi.fn(), postForm: vi.fn(), del: vi.fn() } };
});

function renderAt(projectId: string) {
  return render(
    <MemoryRouter initialEntries={[`/projects/${projectId}`]}>
      <Routes>
        <Route path="/projects/:projectId" element={<ProjectPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("ProjectPage materials pipeline display", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows the granular processing_stage label while a material is mid-pipeline", async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "m1",
        name: "notes.pdf",
        status: "processing",
        processing_stage: "knowledge_extraction",
        error_message: null,
        concepts_extracted: false,
        page_count: 0,
        page_diagnostics: [],
      },
    ]);

    renderAt("p1");

    expect(await screen.findByText("Extracting concepts…")).toBeInTheDocument();
  });

  it("shows Queued for a freshly uploaded material", async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "m0",
        name: "notes.pdf",
        status: "queued",
        processing_stage: "queued",
        error_message: null,
        concepts_extracted: false,
        page_count: 0,
        page_diagnostics: [],
      },
    ]);

    renderAt("p0");

    expect(await screen.findByText("Queued")).toBeInTheDocument();
  });

  it("shows Failed with the specific reason and a working Retry button — never Ready with a caveat", async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "m5",
        name: "Project_Requirements.pdf",
        status: "failed",
        processing_stage: "failed",
        error_message: "Concept extraction failed: provider timeout",
        concepts_extracted: false,
        page_count: 1,
        page_diagnostics: [],
      },
    ]);
    (api.post as ReturnType<typeof vi.fn>).mockResolvedValue({});

    renderAt("p5");

    expect(await screen.findByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("Reason: Concept extraction failed: provider timeout")).toBeInTheDocument();
    expect(screen.queryByText("Ready")).not.toBeInTheDocument();

    await userEvent.click(screen.getByText("Retry"));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/api/projects/p5/materials/m5/retry"));
  });

  it("shows an OCR-recovered notice for a ready material with a recovered scanned page", async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "m2",
        name: "scanned-notes.pdf",
        status: "ready",
        processing_stage: "ready",
        error_message: null,
        concepts_extracted: true,
        page_count: 2,
        page_diagnostics: [
          { page: 1, method: "text", chars: 500 },
          { page: 2, method: "ocr", chars: 300 },
        ],
      },
    ]);

    renderAt("p2");

    expect(await screen.findByText(/OCR recovered 1 scanned page/)).toBeInTheDocument();
  });

  it("warns when a scanned page needed OCR but none was available", async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "m3",
        name: "scanned-only.pdf",
        status: "ready",
        processing_stage: "ready",
        error_message: null,
        concepts_extracted: true,
        page_count: 1,
        page_diagnostics: [{ page: 1, method: "ocr_unavailable", chars: 0 }],
      },
    ]);

    renderAt("p3");

    expect(await screen.findByText(/OCR wasn't available/)).toBeInTheDocument();
  });

  it("shows the empty state when there are no materials yet", async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    renderAt("p4");

    await waitFor(() => expect(screen.getByText(/No materials uploaded yet/)).toBeInTheDocument());
  });
});
