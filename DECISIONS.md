# Decisions

This document explains the important decisions made while building this project, and why they were made.

## Security

### Checking that users only see their own data
Every route that touches a Project checks that the logged-in user actually owns it, using one shared function (`get_owned_project` / `get_owned_space`). This makes it easy to review and test in one place instead of many.

While reviewing the code, one route (`quiz_router.py`) was found to depend on ownership being checked earlier in the flow, instead of checking it directly. It was not actually exploitable, but it was fragile — a future change could have broken it silently. It was fixed by adding a direct ownership check.

### AI tools also check ownership
The AI Tutor uses a small set of tools (`search_materials`, `get_mastery`, etc.) to fetch data. Every tool checks ownership the same way a normal API route does. This means the AI cannot be tricked into reading or changing another user's data, even through prompt injection.

### Background jobs
Background jobs only read data by ID from information created by an already-checked route. They never accept raw project or user IDs from an untrusted source.

### Input validation
All request data is validated using Pydantic. Unknown fields are rejected instead of ignored. File uploads are limited to PDF/TXT files, capped at 20MB, and empty files are rejected.

### Rate limiting
The two most AI-heavy endpoints (`/tutor/message` and `/quiz/generate`) are rate-limited per user.

### Secrets
- `.env` files are not committed to git.
- `.env.example` files show what variables are needed, with placeholder values only.
- API keys and secrets are read from environment variables, never hardcoded.

### Error handling
- Any unexpected error returns a generic message to the user (not a raw stack trace). The real error is still logged on the server.
- AI calls have a timeout and retry logic. If the AI is unavailable, the user sees a clear message instead of a crash.
- If processing an uploaded file fails, only that step fails — it doesn't block the rest of the app from working.
- AI responses that don't match the expected format are rejected and retried, never saved as-is.

### Protection against prompt injection
The Tutor is instructed to treat uploaded document text as reference material only, never as instructions — even if the document contains text like "ignore previous instructions." This is tested with an automated test that checks the instruction is placed correctly in the prompt.

---

## Known Simplifications
- Postgres + pgvector is used for the main app, but SQLite is still supported for quick local testing.
- Background jobs run inside the same backend process instead of a separate job queue system (like Celery). This is simpler but doesn't survive a mid-job crash.
- Embeddings use a real local AI model (`all-MiniLM-L6-v2`) instead of a simpler method.

---

## Testing

### What is tested (automated tests, no real AI calls needed)
- **Auth**: signup, login, wrong password, duplicate email, protected routes
- **Authorization**: a user cannot see another user's data; non-admins cannot access admin routes
- **Validation**: rejecting bad file uploads and bad request data
- **Tutor**: citations are only shown when they're actually used; the "not enough info" case shows no citations; the prompt-injection protection is in place
- **AI output validation**: bad AI responses are rejected and retried, never saved
- **Learning/mastery**: mastery score goes up on correct answers and down on wrong ones; adaptive quiz selection favors weak or stale concepts
- **Background jobs**: successful jobs complete, failed jobs retry and are marked failed (not lost), duplicate job requests don't create duplicates
- **Material processing**: PDF upload, chunking, and text extraction work end-to-end
- **Flashcards**: spaced repetition scheduling works as expected
- **Concept map**: concepts that appear together in materials get linked

### What is intentionally not automated
- **Live AI quality tests** (`tutor_groundedness_eval.py`, `grading_eval.py`) make real API calls, so they are run manually rather than on every test run.
- **Frontend automated tests**: not built yet. The frontend was tested manually by going through the full app (signup → project → upload → Tutor → quiz → growth → analytics).
- **Load testing**: not done. Performance under many concurrent users hasn't been tested.
- **Scanned/image PDFs**: OCR is attempted but not deeply tested (see LIMITATIONS.md).

---

## Major Changes Made During Development

1. **Switched AI provider from Anthropic to Groq** to avoid billing requirements, using the `openai/gpt-oss-120b` model.
2. **Fixed a real bug in search**: an earlier hash-based method for comparing text sometimes ranked an unrelated sentence higher than the correct one. It was replaced with real AI embeddings, which fixed the problem.
3. **Fixed evaluation scripts** that assumed the database tables already existed — they now create the tables themselves if needed.
4. **Improved recommendations** so they don't repeat the same advice — the system now checks the last recommendation before creating a new one.
5. **Fixed a case where a useful learner note was never being saved** — it's now written and used to personalize the Tutor's responses.
6. **Fixed silent failures in concept extraction** — failures are now recorded, and the user can retry.
7. **Fixed a bug where retrying material processing could create duplicate data** — retries now clean up old data first.
8. **Added a Space-level view** — users can now see all Projects and activity inside a Space, not just individual Projects.
9. **Improved the Admin activity feed** to allow filtering by Space.
10. **Added a retrieval quality test suite** to make sure search results stay accurate over time.

---

## Database Migration: SQLite → PostgreSQL + pgvector

The project originally used SQLite with a simple text-comparison method for search. It was later moved to PostgreSQL with the `pgvector` extension, along with a real local AI model for generating embeddings.

**Why:** `pgvector` supports fast similarity search directly inside the database, and a real embedding model gives much better search results than a simple text-comparison method.

**What was verified:** file upload, processing, and search were tested end-to-end with the new setup, and the Tutor was confirmed to still give correctly cited answers.

**Note:** SQLite is still used for running the fast automated test suite locally, since it doesn't need Postgres to be installed. The Postgres-specific search feature is tested separately with real data.
