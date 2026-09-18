import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TutorPage from "./TutorPage";
import { api } from "../lib/api";

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return { ...actual, api: { ...actual.api, get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() } };
});

function renderAt(projectId: string) {
  return render(
    <MemoryRouter initialEntries={[`/projects/${projectId}/tutor`]}>
      <Routes>
        <Route path="/projects/:projectId/tutor" element={<TutorPage />} />
      </Routes>
    </MemoryRouter>
  );
}

function sseResponse(events: object[]) {
  const encoder = new TextEncoder();
  const chunks = events.map((e) => encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
  let i = 0;
  return {
    ok: true,
    status: 200,
    body: {
      getReader() {
        return {
          async read() {
            if (i < chunks.length) return { done: false, value: chunks[i++] };
            return { done: true, value: undefined };
          },
        };
      },
    },
  };
}

function slowSseResponse(signal: AbortSignal) {
  const encoder = new TextEncoder();
  const firstChunk = encoder.encode(`data: ${JSON.stringify({ type: "delta", text: "Partial answer" })}\n\n`);
  let firstRead = true;
  return {
    ok: true,
    status: 200,
    body: {
      getReader() {
        return {
          read() {
            if (firstRead) {
              firstRead = false;
              return Promise.resolve({ done: false, value: firstChunk });
            }
            // Simulates a still-streaming response: never resolves on its
            // own, only rejects once the caller aborts — same as a real
            // fetch() tied to an AbortSignal.
            return new Promise((_, reject) => {
              signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
            });
          },
        };
      },
    },
  };
}

function conversationButton(name: string) {
  return screen.getByRole("button", { name });
}

async function findConversationButton(name: string) {
  return screen.findByRole("button", { name });
}

describe("TutorPage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows the no-materials hint when the Project has no ready material", async () => {
    (api.get as ReturnType<typeof vi.fn>).mockImplementation((path: string) =>
      path.includes("/materials") ? Promise.resolve([{ status: "processing" }]) : Promise.reject(new Error("no history"))
    );

    renderAt("p1");

    expect(await screen.findByText("Add a learning material to this Project before using the grounded Tutor.")).toBeInTheDocument();
  });

  it("shows the default hint when a ready material exists", async () => {
    (api.get as ReturnType<typeof vi.fn>).mockImplementation((path: string) =>
      path.includes("/materials") ? Promise.resolve([{ status: "ready" }]) : Promise.reject(new Error("no history"))
    );

    renderAt("p2");

    expect(await screen.findByText(/Ask a question about your uploaded materials/)).toBeInTheDocument();
  });

  it("renders a grounded answer with its citation after sending a question", async () => {
    (api.get as ReturnType<typeof vi.fn>).mockImplementation((path: string) =>
      path.includes("/materials") ? Promise.resolve([{ status: "ready" }]) : Promise.reject(new Error("no history"))
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sseResponse([
          { type: "delta", text: "RAG combines retrieval with generation." },
          {
            type: "done",
            citations: [{ source_material: "RAG_Notes.pdf", page_number: 5, material_id: "m1" }],
            insufficient_evidence: false,
            retrieval_failed: false,
            tool_calls_used: [],
          },
        ])
      )
    );

    renderAt("p3");
    await screen.findByPlaceholderText("Ask about your materials…");

    await userEvent.type(screen.getByPlaceholderText("Ask about your materials…"), "What is RAG?");
    await userEvent.click(screen.getByText("Send"));

    expect(await screen.findByText("RAG combines retrieval with generation.")).toBeInTheDocument();
    expect(
      await screen.findByText((_, element) => element?.className === "cite" && /RAG_Notes\.pdf.*p\.5/.test(element.textContent ?? ""))
    ).toBeInTheDocument();
  });

  it("shows a distinguishable banner for insufficient evidence vs a retrieval failure", async () => {
    (api.get as ReturnType<typeof vi.fn>).mockImplementation((path: string) =>
      path.includes("/materials") ? Promise.resolve([{ status: "ready" }]) : Promise.reject(new Error("no history"))
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sseResponse([
          { type: "delta", text: "I couldn't find enough information in this project's materials to answer that reliably." },
          { type: "done", citations: [], insufficient_evidence: true, retrieval_failed: false, tool_calls_used: [] },
        ])
      )
    );

    renderAt("p4");
    await userEvent.type(screen.getByPlaceholderText("Ask about your materials…"), "Something obscure?");
    await userEvent.click(screen.getByText("Send"));

    expect(await screen.findByText(/Insufficient evidence in your materials/)).toBeInTheDocument();
    expect(screen.queryByText(/Search failed/)).not.toBeInTheDocument();
  });

  it("turns Send into Stop while a reply is streaming, and stopping keeps the partial answer", async () => {
    (api.get as ReturnType<typeof vi.fn>).mockImplementation((path: string) =>
      path.includes("/materials") ? Promise.resolve([{ status: "ready" }]) : Promise.reject(new Error("no history"))
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: string, options: RequestInit) => Promise.resolve(slowSseResponse(options.signal as AbortSignal)))
    );

    renderAt("p5");
    await userEvent.type(screen.getByPlaceholderText("Ask about your materials…"), "Tell me everything");
    await userEvent.click(screen.getByText("Send"));

    expect(await screen.findByText("Partial answer")).toBeInTheDocument();
    const stopButton = await screen.findByRole("button", { name: "Stop generating" });

    await userEvent.click(stopButton);

    expect(await screen.findByText("Send")).toBeInTheDocument();
    expect(screen.getByText("Partial answer")).toBeInTheDocument();
  });

  it("lists past conversations in a sidebar and switches to the clicked one", async () => {
    const conversations = [
      { conversation_id: "conv-b", title: "Explain embeddings", started_at: "2026-01-02T00:00:00", last_activity: "2026-01-02T00:00:00", pinned: false },
      { conversation_id: "conv-a", title: "What is RAG?", started_at: "2026-01-01T00:00:00", last_activity: "2026-01-01T00:00:00", pinned: false },
    ];
    (api.get as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
      if (path.endsWith("/tutor/conversations")) return Promise.resolve(conversations);
      if (path.includes("/tutor/conversations/conv-a")) {
        return Promise.resolve([
          { id: "m1", role: "user", content: "What is RAG?", citations: [], insufficient_evidence: false, created_at: "2026-01-01T00:00:00" },
        ]);
      }
      if (path.includes("/tutor/conversations/")) return Promise.reject(new Error("no history"));
      if (path.includes("/materials")) return Promise.resolve([{ status: "ready" }]);
      return Promise.reject(new Error("unexpected path"));
    });

    renderAt("p6");

    expect(await findConversationButton("Explain embeddings")).toBeInTheDocument();
    expect(conversationButton("What is RAG?")).toBeInTheDocument();

    await userEvent.click(conversationButton("What is RAG?"));

    expect(await screen.findByText("What is RAG?", { selector: "div" })).toBeInTheDocument();
  });

  it("hides and re-shows the conversation sidebar via the toggle button", async () => {
    (api.get as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
      if (path.endsWith("/tutor/conversations")) {
        return Promise.resolve([
          { conversation_id: "conv-a", title: "What is RAG?", started_at: "2026-01-01T00:00:00", last_activity: "2026-01-01T00:00:00", pinned: false },
        ]);
      }
      if (path.includes("/tutor/conversations/")) return Promise.reject(new Error("no history"));
      if (path.includes("/materials")) return Promise.resolve([{ status: "ready" }]);
      return Promise.reject(new Error("unexpected path"));
    });

    renderAt("p8");

    expect(await findConversationButton("What is RAG?")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /hide conversation history/i }));
    expect(screen.queryByRole("button", { name: /what is rag/i })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /show conversation history/i }));
    expect(await findConversationButton("What is RAG?")).toBeInTheDocument();
  });

  it("starting a new conversation clears the visible messages", async () => {
    (api.get as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
      if (path.endsWith("/tutor/conversations")) {
        return Promise.resolve([
          { conversation_id: "conv-a", title: "What is RAG?", started_at: "2026-01-01T00:00:00", last_activity: "2026-01-01T00:00:00", pinned: false },
        ]);
      }
      if (path.includes("/tutor/conversations/conv-a")) {
        return Promise.resolve([
          { id: "m1", role: "user", content: "What is RAG?", citations: [], insufficient_evidence: false, created_at: "2026-01-01T00:00:00" },
        ]);
      }
      if (path.includes("/tutor/conversations/")) return Promise.reject(new Error("no history"));
      if (path.includes("/materials")) return Promise.resolve([{ status: "ready" }]);
      return Promise.reject(new Error("unexpected path"));
    });

    renderAt("p7");

    await screen.findByText("What is RAG?", { selector: "div" });

    await userEvent.click(screen.getByText("+ New conversation"));

    await waitFor(() => expect(screen.queryByText("What is RAG?", { selector: "div" })).not.toBeInTheDocument());
    expect(await screen.findByText(/Ask a question about your uploaded materials/)).toBeInTheDocument();
  });

  it("shows the retrieval-failed banner, not the insufficient-evidence one, when retrieval itself failed", async () => {
    (api.get as ReturnType<typeof vi.fn>).mockImplementation((path: string) =>
      path.includes("/materials") ? Promise.resolve([{ status: "ready" }]) : Promise.reject(new Error("no history"))
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sseResponse([
          { type: "delta", text: "We couldn't search this Project's materials right now. Please try again in a moment." },
          { type: "done", citations: [], insufficient_evidence: true, retrieval_failed: true, tool_calls_used: [] },
        ])
      )
    );

    renderAt("p5");
    await userEvent.type(screen.getByPlaceholderText("Ask about your materials…"), "What is RAG?");
    await userEvent.click(screen.getByText("Send"));

    expect(await screen.findByText(/Search failed/)).toBeInTheDocument();
    expect(screen.queryByText(/Insufficient evidence in your materials/)).not.toBeInTheDocument();
  });

  it("right-clicking a conversation shows a context menu with Rename, Pin and Delete options", async () => {
    (api.get as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
      if (path.endsWith("/tutor/conversations")) {
        return Promise.resolve([
          { conversation_id: "conv-a", title: "What is RAG?", started_at: "2026-01-01T00:00:00", last_activity: "2026-01-01T00:00:00", pinned: false },
        ]);
      }
      if (path.includes("/tutor/conversations/")) return Promise.reject(new Error("no history"));
      if (path.includes("/materials")) return Promise.resolve([{ status: "ready" }]);
      return Promise.reject(new Error("unexpected path"));
    });

    renderAt("p9");
    const item = await findConversationButton("What is RAG?");

    await userEvent.pointer({ keys: "[MouseRight]", target: item });

    expect(await screen.findByText("✏️ Rename")).toBeInTheDocument();
    expect(screen.getByText("📌 Pin")).toBeInTheDocument();
    expect(screen.getByText("🗑 Delete")).toBeInTheDocument();
  });

  it("pinning a conversation calls the pin endpoint and refreshes the list", async () => {
    let pinned = false;
    (api.get as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
      if (path.endsWith("/tutor/conversations")) {
        return Promise.resolve([
          { conversation_id: "conv-a", title: "What is RAG?", started_at: "2026-01-01T00:00:00", last_activity: "2026-01-01T00:00:00", pinned },
        ]);
      }
      if (path.includes("/tutor/conversations/")) return Promise.reject(new Error("no history"));
      if (path.includes("/materials")) return Promise.resolve([{ status: "ready" }]);
      return Promise.reject(new Error("unexpected path"));
    });
    (api.post as ReturnType<typeof vi.fn>).mockImplementation(() => {
      pinned = true;
      return Promise.resolve({ pinned: true });
    });

    renderAt("p10");
    const item = await findConversationButton("What is RAG?");
    await userEvent.pointer({ keys: "[MouseRight]", target: item });

    await userEvent.click(await screen.findByText("📌 Pin"));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/api/projects/p10/tutor/conversations/conv-a/pin"));
    // pin refreshed the list — the item still resolves by its title (aria-label),
    // and the pin icon now renders next to it instead of the chat-bubble icon
    expect(await findConversationButton("What is RAG?")).toBeInTheDocument();
    expect(await screen.findByText("📌")).toBeInTheDocument();
  });

  it("renaming a conversation shows an inline input and saves via PATCH", async () => {
    (api.get as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
      if (path.endsWith("/tutor/conversations")) {
        return Promise.resolve([
          { conversation_id: "conv-a", title: "What is RAG?", started_at: "2026-01-01T00:00:00", last_activity: "2026-01-01T00:00:00", pinned: false },
        ]);
      }
      if (path.includes("/tutor/conversations/")) return Promise.reject(new Error("no history"));
      if (path.includes("/materials")) return Promise.resolve([{ status: "ready" }]);
      return Promise.reject(new Error("unexpected path"));
    });
    (api.patch as ReturnType<typeof vi.fn>).mockResolvedValue({ title: "My renamed chat" });

    renderAt("p12");
    const item = await findConversationButton("What is RAG?");
    await userEvent.pointer({ keys: "[MouseRight]", target: item });
    await userEvent.click(await screen.findByText("✏️ Rename"));

    const renameInput = await screen.findByDisplayValue("What is RAG?");
    await userEvent.clear(renameInput);
    await userEvent.type(renameInput, "My renamed chat{Enter}");

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith("/api/projects/p12/tutor/conversations/conv-a/title", { title: "My renamed chat" })
    );
  });

  it("deleting a conversation requires confirmation before calling the delete endpoint", async () => {
    (api.get as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
      if (path.endsWith("/tutor/conversations")) {
        return Promise.resolve([
          { conversation_id: "conv-a", title: "What is RAG?", started_at: "2026-01-01T00:00:00", last_activity: "2026-01-01T00:00:00", pinned: false },
        ]);
      }
      if (path.includes("/tutor/conversations/")) return Promise.reject(new Error("no history"));
      if (path.includes("/materials")) return Promise.resolve([{ status: "ready" }]);
      return Promise.reject(new Error("unexpected path"));
    });
    (api.del as ReturnType<typeof vi.fn>).mockResolvedValue({ deleted: true });

    renderAt("p11");
    const item = await findConversationButton("What is RAG?");
    await userEvent.pointer({ keys: "[MouseRight]", target: item });
    await userEvent.click(await screen.findByText("🗑 Delete"));

    // confirmation modal appears — deletion must not happen until confirmed
    expect(await screen.findByText("Delete conversation", { selector: "h2" })).toBeInTheDocument();
    expect(api.del).not.toHaveBeenCalled();

    await userEvent.click(screen.getByText("Delete", { selector: "button" }));

    await waitFor(() =>
      expect(api.del).toHaveBeenCalledWith("/api/projects/p11/tutor/conversations/conv-a")
    );
  });
});
