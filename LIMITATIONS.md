# Limitations

This document describes the main limitations of the current implementation.

## Retrieval and Material Processing

### OCR is best-effort

PDF text extraction normally uses `pypdf`. If a page contains very little extracted text, the system attempts to process the page using PyMuPDF and Tesseract OCR.

OCR depends on the Tesseract binary being installed on the server. If Tesseract is not available, the page is marked as `ocr_unavailable` in the material diagnostics instead of silently producing no content.

Current limitations:

- No OCR quality score
- No multi-language OCR support
- OCR quality depends on the input document

### Embedding model is relatively small

The project uses `all-MiniLM-L6-v2` with 384-dimensional embeddings.

This provides semantic retrieval and works well for general content, but a larger or domain-specific embedding model could provide better results for highly technical or domain-specific material.

The current retrieval system also does not use a separate re-ranking step after the initial similarity search.

### No automatic re-embedding when the model changes

The current embedding dimension is set to 384.

If the embedding model is changed to one with a different dimension, the existing database schema and stored embeddings would need to be updated and the existing materials would need to be processed again.

There is currently no automatic background workflow for re-embedding all existing materials.

### Chunking is fixed-size

The document text is divided into fixed-size chunks with overlap.

The current implementation does not fully understand document structure such as:

- Sections
- Paragraph relationships
- Headings
- Tables

Because of this, information that spans multiple chunks may sometimes be harder to retrieve together.

---

## Learning and Mastery

### Mastery starts with a default value

New concepts start with a default mastery value of `0.3`.

The initial value does not currently consider:

- Concept difficulty
- Amount of material
- Previous learner experience
- Individual learner history

Mastery changes as more learning and assessment evidence becomes available.

### Adaptive-selection weights are fixed

The adaptive question-selection system picks the next quiz question using a fixed scoring formula:

```text
0.4 - how low the learner's mastery is on that concept
0.3 - how long it has been since the concept was last practiced (staleness)
0.3 - whether the learner recently got it wrong
```

These weights are hardcoded and are the same for every learner. They are not personalized, and they haven't been tuned using real usage data — they were chosen as a reasonable starting point.

---

## Other Known Limitations

- **No refresh tokens**: login tokens (JWT) are valid for 7 days and cannot be manually revoked before they expire.
- **No database migrations yet**: the database schema is created automatically on startup, which works for a fresh setup but isn't ideal for updating a live production database safely.
- **Background jobs run in-process**: if the backend restarts while a job is running, that job is not automatically resumed.
- **No load testing**: the app hasn't been tested under many concurrent users.
- **No automated frontend tests**: the frontend was tested manually, not with an automated test suite.