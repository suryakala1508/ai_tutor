import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiError, API_BASE } from "../lib/api";
import { ConfirmModal } from "../components/ConfirmModal";
import { ErrorBanner } from "../components/Feedback";

interface Citation {
  source_material: string;
  page_number: number | null;
  material_id?: string | null;
}

interface ToolCallUsed {
  name: string;
  arguments: Record<string, unknown>;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations: Citation[];
  insufficient_evidence: boolean;
  retrieval_failed?: boolean;
  streaming?: boolean;
  tool_calls_used?: ToolCallUsed[];
}

const TOOL_LABEL: Record<string, string> = {
  get_mastery: "Checked your mastery levels",
  get_recent_mistakes: "Checked your recent mistakes",
};

interface StoredConversationMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations: Citation[];
  insufficient_evidence: boolean;
  created_at: string;
}

interface ConversationSummary {
  conversation_id: string;
  title: string;
  started_at: string;
  last_activity: string;
  pinned: boolean;
}

interface ContextMenuState {
  conversationId: string;
  x: number;
  y: number;
}

function lastActiveConversationKey(projectId: string): string {
  return `tutor-conversation:${projectId}`;
}

function newConversationId(): string {
  return `conv-${Date.now()}`;
}

export default function TutorPage() {
  const { projectId } = useParams();
  const [conversationId, setConversationId] = useState<string>(() => newConversationId());
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [hasReadyMaterial, setHasReadyMaterial] = useState<boolean | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [deletingConversationId, setDeletingConversationId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (renamingId) renameInputRef.current?.select();
  }, [renamingId]);

  function loadConversationList() {
    if (!projectId) return;
    api
      .get<ConversationSummary[]>(`/api/projects/${projectId}/tutor/conversations`)
      .then(setConversations)
      .catch((err) => {
        // The backend returns an empty list (not an error) when there are no
        // conversations yet, so a caught error here is a real failure.
        setError(err instanceof ApiError ? err.message : "Could not load your conversation list.");
      });
  }

  // On mount: figure out which conversation to open — the last one the user
  // was in (if it still exists), otherwise a fresh one. The conversation
  // *list* always comes from the backend; localStorage is just a per-device
  // "where was I" pointer, not the source of truth.
  useEffect(() => {
    if (!projectId) return;
    api
      .get<ConversationSummary[]>(`/api/projects/${projectId}/tutor/conversations`)
      .then((list) => {
        setConversations(list);
        const lastActive = localStorage.getItem(lastActiveConversationKey(projectId));
        if (lastActive && list.some((c) => c.conversation_id === lastActive)) {
          setConversationId(lastActive);
        } else if (list.length > 0) {
          setConversationId(list[0].conversation_id);
        }
      })
      .catch((err) => {
        // As above: an empty list isn't an error, so a caught error here is
        // real — the freshly-generated conversation id from useState still
        // stands, but the user should know their history may not have loaded.
        setError(err instanceof ApiError ? err.message : "Could not load your conversation list.");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    api
      .get<{ status: string }[]>(`/api/projects/${projectId}/materials`)
      .then((materials) => setHasReadyMaterial(materials.some((m) => m.status === "ready")))
      .catch(() => setHasReadyMaterial(null));
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    localStorage.setItem(lastActiveConversationKey(projectId), conversationId);
    setHistoryLoaded(false);
    // Reload prior turns for this conversation so switching conversations
    // (or refreshing the page) shows the backend's persisted history.
    api
      .get<StoredConversationMessage[]>(`/api/projects/${projectId}/tutor/conversations/${conversationId}`)
      .then((history) => {
        setMessages(
          history.map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            citations: m.citations || [],
            insufficient_evidence: m.insufficient_evidence,
          }))
        );
      })
      .catch((err) => {
        // The backend returns an empty list (not an error) for a brand new
        // conversation, so a caught error here is a real failure — don't
        // silently show an empty chat as if there's simply no history.
        setError(err instanceof ApiError ? err.message : "Could not load this conversation's history.");
        setMessages([]);
      })
      .finally(() => setHistoryLoaded(true));
  }, [projectId, conversationId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  function startNewConversation() {
    setConversationId(newConversationId());
  }

  function openContextMenu(e: React.MouseEvent, targetConversationId: string) {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ conversationId: targetConversationId, x: e.clientX, y: e.clientY });
  }

  async function togglePin(targetConversationId: string, currentlyPinned: boolean) {
    if (!projectId) return;
    setContextMenu(null);
    try {
      if (currentlyPinned) {
        await api.del(`/api/projects/${projectId}/tutor/conversations/${targetConversationId}/pin`);
      } else {
        await api.post(`/api/projects/${projectId}/tutor/conversations/${targetConversationId}/pin`);
      }
      loadConversationList();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update pin.");
    }
  }

  function startRename(target: ConversationSummary) {
    setRenamingId(target.conversation_id);
    setRenameValue(target.title);
    setContextMenu(null);
  }

  async function submitRename() {
    if (!projectId || !renamingId) return;
    const targetId = renamingId;
    const title = renameValue.trim();
    setRenamingId(null);
    if (!title) return;
    try {
      await api.patch(`/api/projects/${projectId}/tutor/conversations/${targetId}/title`, { title });
      loadConversationList();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not rename conversation.");
    }
  }

  async function confirmDeleteConversation() {
    if (!projectId || !deletingConversationId) return;
    const target = deletingConversationId;
    setDeletingConversationId(null);
    try {
      await api.del(`/api/projects/${projectId}/tutor/conversations/${target}`);
      loadConversationList();
      if (target === conversationId) {
        startNewConversation();
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not delete conversation.");
    }
  }

  function stopStreaming() {
    abortControllerRef.current?.abort();
  }

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || !projectId || sending) return;

    const question = input.trim();
    setInput("");
    setError(null);
    setSending(true);

    const userMsg: Message = { id: `u-${Date.now()}`, role: "user", content: question, citations: [], insufficient_evidence: false };
    const assistantId = `a-${Date.now()}`;
    setMessages((prev) => [...prev, userMsg, { id: assistantId, role: "assistant", content: "", citations: [], insufficient_evidence: false, streaming: true }]);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`${API_BASE}/api/projects/${projectId}/tutor/message`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ conversation_id: conversationId, message: question }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        throw new Error(res.status === 429 ? "You're sending messages too quickly. Please wait a moment." : "The tutor is temporarily unavailable.");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = JSON.parse(line.slice(6));
          if (payload.type === "delta") {
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + payload.text } : m))
            );
          } else if (payload.type === "done") {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      citations: payload.citations,
                      insufficient_evidence: payload.insufficient_evidence,
                      retrieval_failed: payload.retrieval_failed || false,
                      tool_calls_used: payload.tool_calls_used || [],
                      streaming: false,
                    }
                  : m
              )
            );
          }
        }
      }
      loadConversationList(); // this exchange may have started a new conversation, or should bump its "last activity"/title
      // Title generation now runs as a fire-and-forget background task on the
      // backend so it never delays the answer itself; refresh again shortly
      // after so the sidebar picks up the generated title once it lands.
      setTimeout(loadConversationList, 2500);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        // User clicked Stop — keep whatever text streamed in so far instead
        // of discarding it, just like ChatGPT leaves the partial answer.
        setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, streaming: false } : m)));
      } else {
        setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
        setMessages((prev) => prev.filter((m) => m.id !== assistantId));
      }
    } finally {
      setSending(false);
      abortControllerRef.current = null;
    }
  }

  if (!projectId) return null;

  const pinnedConversations = conversations.filter((c) => c.pinned);
  const recentConversations = conversations.filter((c) => !c.pinned);

  function renderConversationItem(c: ConversationSummary) {
    const isActive = c.conversation_id === conversationId;
    const isRenaming = c.conversation_id === renamingId;

    if (isRenaming) {
      return (
        <input
          key={c.conversation_id}
          ref={renameInputRef}
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onBlur={submitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") submitRename();
            if (e.key === "Escape") setRenamingId(null);
          }}
          style={{ width: "100%", fontSize: 13.5, padding: "9px 12px" }}
        />
      );
    }

    const displayTitle = c.title || "New conversation";
    return (
      <button
        key={c.conversation_id}
        onClick={() => setConversationId(c.conversation_id)}
        onContextMenu={(e) => openContextMenu(e, c.conversation_id)}
        aria-label={displayTitle}
        className={`nav-link${isActive ? " active" : ""}`}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          textAlign: "left",
          border: "none",
          cursor: "pointer",
          width: "100%",
          padding: "9px 12px",
        }}
        title={displayTitle}
      >
        <span aria-hidden="true" style={{ flexShrink: 0, fontSize: 12, opacity: 0.8 }}>{c.pinned ? "📌" : "💬"}</span>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
          {displayTitle}
        </span>
      </button>
    );
  }

  return (
    <div className="page" style={{ maxWidth: 1180, display: "flex", flexDirection: "column", height: "calc(100vh - 100px)" }}>
      <div className="crumb">
        <Link to={`/projects/${projectId}`} style={{ color: "inherit" }}>← Project</Link>
      </div>
      <div className="spread" style={{ marginBottom: 16 }}>
        <h1 className="h-disp" style={{ fontSize: 24 }}>Tutor</h1>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => setSidebarOpen((s) => !s)}
          aria-label={sidebarOpen ? "Hide conversation history" : "Show conversation history"}
          title={sidebarOpen ? "Hide conversation history" : "Show conversation history"}
        >
          {sidebarOpen ? "⟨ Hide history" : "⟩ Show history"}
        </button>
      </div>

      <div style={{ display: "flex", gap: sidebarOpen ? 18 : 0, flex: 1, minHeight: 0 }}>
        {sidebarOpen && (
          <div className="block" style={{ width: 260, flexShrink: 0, display: "flex", flexDirection: "column", padding: 12, overflow: "hidden" }}>
            <button className="btn btn-primary btn-sm" onClick={startNewConversation} style={{ width: "100%", marginBottom: 10 }}>
              + New conversation
            </button>

            <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
              {conversations.length === 0 ? (
                <div style={{ fontSize: 12.5, color: "var(--faint)", padding: "4px 4px" }}>
                  No conversations yet.
                </div>
              ) : (
                <>
                  {pinnedConversations.length > 0 && (
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.04, padding: "0 6px 4px", textTransform: "uppercase", color: "var(--faint)" }}>
                        Pinned
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        {pinnedConversations.map(renderConversationItem)}
                      </div>
                    </div>
                  )}
                  {recentConversations.length > 0 && (
                    <div>
                      {pinnedConversations.length > 0 && (
                        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.04, padding: "0 6px 4px", textTransform: "uppercase", color: "var(--faint)" }}>
                          Recent
                        </div>
                      )}
                      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        {recentConversations.map(renderConversationItem)}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        <div className="block" style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden" }}>
          <div ref={scrollRef} className="chat" style={{ flex: 1, overflowY: "auto" }}>
            <div style={{ width: "100%", maxWidth: 780, margin: "0 auto", display: "flex", flexDirection: "column", gap: 20 }}>
              {historyLoaded && messages.length === 0 && hasReadyMaterial === false && (
                <div className="empty-state">
                  Add a learning material to this Project before using the grounded Tutor.
                </div>
              )}
              {historyLoaded && messages.length === 0 && hasReadyMaterial !== false && (
                <div className="empty-state">
                  Ask a question about your uploaded materials. The Tutor only answers from what you've uploaded and
                  will tell you plainly if something isn't covered.
                </div>
              )}
              {messages.map((m) => (
                <div key={m.id} className={`msg ${m.role === "user" ? "u" : "a"}`}>
                  <span className="who">{m.role === "user" ? "You" : "Tutor"}</span>
                  <div className="bubble">
                    <div style={{ whiteSpace: "pre-wrap" }}>
                      {m.content}
                      {m.streaming && <span className="skeleton" style={{ display: "inline-block", width: 8, height: 14, marginLeft: 2 }} />}
                    </div>
                    {m.role === "assistant" && !m.streaming && m.retrieval_failed && (
                      <div style={{ marginTop: 10, padding: "8px 11px", background: "var(--red-tint)", borderRadius: 10, color: "#c81e46", fontSize: 13, fontWeight: 600 }}>
                        ⚠ Search failed — this is different from "not covered in your materials." Please try again.
                      </div>
                    )}
                    {m.role === "assistant" && !m.streaming && m.insufficient_evidence && !m.retrieval_failed && (
                      <div style={{ marginTop: 10 }}>
                        <span className="evidence">⚠ Insufficient evidence in your materials</span>
                      </div>
                    )}
                    {m.citations.length > 0 && (
                      <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {m.citations.map((c, i) => (
                          <span key={i} className="cite">
                            📄 {c.source_material}
                            {c.page_number ? <span className="pg"> · p.{c.page_number}</span> : null}
                          </span>
                        ))}
                      </div>
                    )}
                    {m.tool_calls_used && m.tool_calls_used.length > 0 && (
                      <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 3 }}>
                        {m.tool_calls_used.map((t, i) => (
                          <div key={i} style={{ fontSize: 12, color: "var(--faint)", fontStyle: "italic" }}>
                            🛠 {TOOL_LABEL[t.name] || t.name}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {error && <div style={{ padding: "0 22px" }}><ErrorBanner message={error} /></div>}

          <form onSubmit={sendMessage} className="composer">
            <input
              placeholder="Ask about your materials…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={sending}
            />
            {sending ? (
              <button type="button" className="btn btn-ghost" onClick={stopStreaming} aria-label="Stop generating" style={{ minWidth: 76 }}>
                ■ Stop
              </button>
            ) : (
              <button className="btn btn-primary" type="submit" disabled={!input.trim()}>
                Send
              </button>
            )}
          </form>
        </div>
      </div>

      {contextMenu && (() => {
        const target = conversations.find((c) => c.conversation_id === contextMenu.conversationId);
        if (!target) return null;
        return (
          <div
            className="card"
            style={{
              position: "fixed",
              top: contextMenu.y,
              left: contextMenu.x,
              zIndex: 50,
              padding: 6,
              display: "flex",
              flexDirection: "column",
              minWidth: 180,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button className="context-menu-item" onClick={() => startRename(target)}>
              ✏️ Rename
            </button>
            <button className="context-menu-item" onClick={() => togglePin(target.conversation_id, target.pinned)}>
              {target.pinned ? "📌 Unpin" : "📌 Pin"}
            </button>
            <div style={{ borderTop: "1px solid var(--line)", margin: "4px 0" }} />
            <button
              className="context-menu-item"
              style={{ color: "var(--red)" }}
              onClick={() => {
                setDeletingConversationId(target.conversation_id);
                setContextMenu(null);
              }}
            >
              🗑 Delete
            </button>
          </div>
        );
      })()}

      {deletingConversationId && (
        <ConfirmModal
          title="Delete conversation"
          message="This permanently deletes this conversation and all its messages. This can't be undone."
          confirmLabel="Delete"
          onConfirm={confirmDeleteConversation}
          onCancel={() => setDeletingConversationId(null)}
        />
      )}
    </div>
  );
}
