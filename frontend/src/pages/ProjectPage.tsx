import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { ErrorBanner, EmptyState, LoadingBlock } from "../components/Feedback";
import { ConfirmModal } from "../components/ConfirmModal";

interface PageDiagnostic {
  page: number;
  method: "text" | "empty" | "ocr" | "ocr_unavailable" | "ocr_failed";
  chars: number;
}

interface Material {
  id: string;
  name: string;
  status: string;
  processing_stage: string | null;
  error_message: string | null;
  concepts_extracted: boolean;
  page_count: number;
  page_diagnostics: PageDiagnostic[];
}

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  queued: { label: "Queued", className: "queued" },
  processing: { label: "Processing…", className: "proc" },
  ready: { label: "Ready", className: "ready" },
  failed: { label: "Failed", className: "fail" },
};

// Granular sub-stage shown while status === "processing", matching the
// pipeline: Queued -> OCR -> Content Extraction -> Knowledge/Concept
// Extraction -> Chunking -> Search/Retrieval Representation -> Ready.
const STAGE_LABEL: Record<string, string> = {
  queued: "Queued",
  ocr: "Scanning for OCR-only pages…",
  content_extraction: "Extracting content…",
  knowledge_extraction: "Extracting concepts…",
  chunking: "Creating chunks…",
  search_indexing: "Building search index…",
  ready: "Ready",
  failed: "Failed",
};

const PIPELINE_STAGES = ["Queued", "OCR", "Extract", "Concepts", "Chunk", "Index", "Ready"];
const STAGE_TO_INDEX: Record<string, number> = {
  queued: 0,
  ocr: 1,
  content_extraction: 2,
  knowledge_extraction: 3,
  chunking: 4,
  search_indexing: 5,
  ready: 6,
};

export default function ProjectPage() {
  const { projectId } = useParams();
  // null = not loaded yet (shows a loading state, never a false "no materials"
  // flash); [] = genuinely empty. materialsRef mirrors the same data for the
  // poll interval below, which needs to read current status without itself
  // being a state update (see note there).
  const [materials, setMaterials] = useState<Material[] | null>(null);
  const materialsRef = useRef<Material[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [deletingMaterial, setDeletingMaterial] = useState<Material | null>(null);
  const [deleting, setDeleting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function loadMaterials() {
    if (!projectId) return;
    api
      .get<Material[]>(`/api/projects/${projectId}/materials`)
      .then((data) => {
        materialsRef.current = data;
        setMaterials(data);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load materials."));
  }

  useEffect(() => {
    if (!projectId) return;
    // Project details aren't separately fetchable without space_id in this API surface,
    // so we derive a minimal header from materials context; keep it simple.
    loadMaterials();
    const interval = setInterval(() => {
      // Poll while anything is still processing, so status updates show
      // live. Reads materialsRef (a plain ref) rather than calling
      // setMaterials with an updater function that triggers a fetch as a
      // side effect — that pattern is impure and gets double-invoked by
      // React StrictMode, doubling poll traffic.
      if (materialsRef.current.some((m) => m.status === "queued" || m.status === "processing")) {
        loadMaterials();
      }
    }, 2000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function retryProcessing(materialId: string) {
    if (!projectId) return;
    try {
      await api.post(`/api/projects/${projectId}/materials/${materialId}/retry`);
      loadMaterials();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not retry processing.");
    }
  }

  async function confirmDeleteMaterial() {
    if (!projectId || !deletingMaterial) return;
    setDeleting(true);
    try {
      await api.del(`/api/projects/${projectId}/materials/${deletingMaterial.id}`);
      setDeletingMaterial(null);
      loadMaterials();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not delete material.");
    } finally {
      setDeleting(false);
    }
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !projectId) return;
    setUploadError(null);
    setUploading(true);
    const form = new FormData();
    form.append("file", file);
    try {
      await api.postForm(`/api/projects/${projectId}/materials`, form);
      loadMaterials();
    } catch (err) {
      setUploadError(err instanceof ApiError ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  if (!projectId) return null;

  return (
    <div className="page">
      <div className="crumb">
        <Link to="/" style={{ color: "inherit" }}>← Home</Link>
      </div>
      <h1 className="title" style={{ fontSize: "clamp(26px,4vw,36px)", marginBottom: 22 }}>Project</h1>

      <div className="tabs" style={{ margin: "0 0 24px" }}>
        <Link className="tab active" to={`/projects/${projectId}/tutor`}>💬 Tutor</Link>
        <Link className="tab" to={`/projects/${projectId}/quiz`}>📝 Quiz</Link>
        <Link className="tab" to={`/projects/${projectId}/flashcards`}>🗂 Flashcards</Link>
        <Link className="tab" to={`/projects/${projectId}/concept-map`}>🕸 Concept Map</Link>
        <Link className="tab" to={`/projects/${projectId}/growth`}>📈 Growth</Link>
        <Link className="tab" to={`/projects/${projectId}/analytics`}>📊 Analytics</Link>
      </div>

      {error && <ErrorBanner message={error} />}

      <div className="block">
        <div className="spread" style={{ padding: "20px 22px 4px" }}>
          <div className="section-label">Materials</div>
          <label className="newbtn" style={{ cursor: "pointer" }}>
            {uploading ? "Uploading…" : "+ Upload material"}
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.txt"
              onChange={handleUpload}
              disabled={uploading}
              style={{ display: "none" }}
            />
          </label>
        </div>

        {uploadError && <div style={{ padding: "0 22px" }}><ErrorBanner message={uploadError} /></div>}

        {materials === null ? (
          !error && <div style={{ padding: 22 }}><LoadingBlock /></div>
        ) : materials.length === 0 ? (
          <>
            <div style={{ padding: "12px 22px 0" }}>
              <EmptyState
                title="No materials uploaded yet"
                hint="Upload a PDF or text file to start using the Tutor and generate quizzes grounded in your material."
              />
            </div>
            <label className="dropzone" style={{ display: "block", cursor: "pointer" }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>📄 Drop a PDF here, or click to browse</div>
              <div style={{ fontSize: 13 }}>PDF or plain text — processed automatically</div>
              <input type="file" accept=".pdf,.txt" onChange={handleUpload} disabled={uploading} style={{ display: "none" }} />
            </label>
          </>
        ) : (
          <div style={{ paddingTop: 8 }}>
            {materials.map((m) => {
              const s = STATUS_LABEL[m.status] ?? STATUS_LABEL.queued;
              const stageLabel = m.status === "processing" && m.processing_stage
                ? STAGE_LABEL[m.processing_stage] ?? s.label
                : s.label;
              const ocrPages = (m.page_diagnostics ?? []).filter((d) => d.method !== "text");
              const unavailablePages = ocrPages.filter((d) => d.method === "ocr_unavailable" || d.method === "ocr_failed");
              const recoveredPages = ocrPages.filter((d) => d.method === "ocr");
              const stageIndex = STAGE_TO_INDEX[m.processing_stage ?? ""] ?? -1;
              return (
                <div key={m.id} className="mat-row">
                  <div className="mat-ico" aria-hidden="true" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="mat-name">{m.name}</div>
                    {m.status === "processing" && (
                      <div className="pipe">
                        {PIPELINE_STAGES.map((label, i) => (
                          <span key={label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <b style={{ color: i <= stageIndex ? "var(--violet)" : "var(--faint)" }}>{label}</b>
                            {i < PIPELINE_STAGES.length - 1 && <i />}
                          </span>
                        ))}
                      </div>
                    )}
                    {m.status === "failed" && (
                      <div style={{ marginTop: 4 }}>
                        {m.error_message && (
                          <div style={{ color: "var(--red)", fontSize: 13 }}>Reason: {m.error_message}</div>
                        )}
                        <button className="btn btn-ghost btn-sm" style={{ marginTop: 6 }} onClick={() => retryProcessing(m.id)}>
                          Retry
                        </button>
                      </div>
                    )}
                    {m.status === "ready" && !m.concepts_extracted && (
                      <div style={{ color: "var(--amber)", fontSize: 13, marginTop: 4 }}>
                        This material was processed before concept extraction was required — its concepts are
                        incomplete.{" "}
                        <button className="btn btn-ghost btn-sm" onClick={() => retryProcessing(m.id)}>
                          Retry
                        </button>
                      </div>
                    )}
                    {m.status === "ready" && recoveredPages.length > 0 && (
                      <div style={{ color: "var(--green)", fontSize: 13, marginTop: 4 }}>
                        OCR recovered {recoveredPages.length} scanned page{recoveredPages.length === 1 ? "" : "s"}.
                      </div>
                    )}
                    {m.status === "ready" && unavailablePages.length > 0 && (
                      <div style={{ color: "var(--amber)", fontSize: 13, marginTop: 4 }}>
                        {unavailablePages.length} page{unavailablePages.length === 1 ? "" : "s"} looked scanned/image-only
                        and OCR wasn't available — those pages won't be searchable by the Tutor.
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 14, flexShrink: 0 }}>
                    <span className={`status ${s.className}`}>{stageLabel}</span>
                    <button className="btn btn-ghost btn-sm" onClick={() => setDeletingMaterial(m)}>
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {deletingMaterial && (
        <ConfirmModal
          title="Delete material?"
          message={`"${deletingMaterial.name}" will be permanently removed, along with everything the Tutor learned from it.`}
          confirmLabel={deleting ? "Deleting…" : "Delete"}
          onConfirm={confirmDeleteMaterial}
          onCancel={() => setDeletingMaterial(null)}
        />
      )}
    </div>
  );
}
