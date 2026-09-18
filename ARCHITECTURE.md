# Architecture

This document explains how AI Tutor is built and how the different parts talk to each other.

## Simple Diagram

```
Frontend (React)
      |
      | calls the API
      v
Backend API (FastAPI)
      |
      |-----------------------------|
      v                             v
Business Logic                AI Tool Layer
(retrieval, tutor,             (search_materials,
 quizzes, mastery,              get_mastery,
 recommendations)               get_recent_mistakes, etc.)
      |                             |
      v                             v
Database (PostgreSQL + pgvector)
      |
      v
Background Workers
(process uploads, update mastery,
 generate recommendations)
      |
      v
AI Model (Groq API)
```

## How Each Part Works

### Frontend
Built with React, TypeScript, and Vite. It has pages for Home, Projects, the AI Tutor chat, Quizzes, Growth tracking, Analytics, and Admin.

### Backend API
Built with FastAPI. Every request that touches a Project first checks that the logged-in user actually owns that Project. This check is done through one shared function, so it only has to be reviewed and tested in one place.

### Business Logic
This is where the real work happens: searching material, building answers for the Tutor, generating quizzes, grading answers, calculating mastery, and creating recommendations.

### AI Tool Layer
The AI Tutor doesn't touch the database directly. Instead, it uses a small set of "tools" (like `search_materials` or `get_mastery`). Every tool checks that the user is allowed to access that data before returning anything. This means even if something goes wrong with the AI's instructions, it still can't read another user's data.

### Database
PostgreSQL is used for all data (users, projects, materials, quizzes, mastery, etc.). The `pgvector` extension is used to store embeddings (numeric representations of text) so the app can search material by meaning, not just by keyword.

### Background Workers
Some tasks take time and don't need to block the user, so they run in the background:
- Processing an uploaded PDF (splitting it into chunks, creating embeddings)
- Updating mastery after a quiz is answered
- Generating a new recommendation

### AI Model
The app uses the Groq API with the `openai/gpt-oss-120b` model for the Tutor, quiz generation, grading, and recommendations.

### Monitoring / Logging
Every AI call and every important learning action is logged. This data is shown in the Admin Dashboard so it's easy to see usage, costs, and errors.

---

## Key Decisions (Simple Summary)

### Database: PostgreSQL + pgvector
Chosen because the app needs normal relational data (users, projects, quizzes) **and** similarity search for embeddings. Using one database for both is simpler than running a separate vector database.
- Not done yet: proper database migrations (Alembic). The schema is currently created automatically on startup, which is fine for a demo but not ideal for a real production app.

### Search: Real embeddings with sentence-transformers
Text is converted into embeddings using a local model (`all-MiniLM-L6-v2`). This model runs on the backend server, so no extra API key or cost is needed for search.
- An earlier version used a simpler, hash-based method for comparing text. It gave wrong results in some cases, so it was replaced with real embeddings.

### Background Jobs: Simple in-app queue (not Celery/Redis)
Background tasks are handled with Python's `asyncio` inside the same backend process, instead of a separate job queue system like Celery. This is simpler to set up and good enough for this project's scale.
- Limitation: if the backend restarts while a job is running, that job is not automatically resumed.

### AI Tutor: Search is always used, some tools are optional
The Tutor always searches the uploaded material before answering — this is never left up to the AI model to decide, since correct, grounded answers are the most important requirement. Some other tools (like checking mastery or recent mistakes) are offered to the AI model, which decides on its own if and when to use them.

### AI Provider: Groq API
The Groq API is used directly (not through a framework like LangChain) so that prompts, retries, and validation are fully visible and easy to debug.

### Authentication: JWT + bcrypt
Login uses JWT tokens (a signed token proving who the user is) and bcrypt for password hashing.
- Limitation: there is no refresh-token system yet, and a token cannot be manually revoked before it expires (7 days).

---

## Where to Find Things
- `backend/app/models/models.py` — all database tables (models)
- `backend/app/services/` — business logic (tutor, quizzes, grading, mastery, etc.)
- `backend/app/tools/tools.py` — the tools the AI is allowed to use
- `backend/app/workers/` — background job handlers
- `backend/app/evals/` — scripts that test AI quality using real AI calls
- `backend/app/tests/` — automated tests (fast, no real AI calls)
