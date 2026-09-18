# AI Tutor

AI Tutor is an AI-powered learning platform. Users can create learning projects, upload study material, chat with an AI Tutor about that material, take quizzes, and track how well they are learning.

The Tutor only answers using the material the user has uploaded, and always shows the source it used. The app also has adaptive quizzes, mastery tracking, growth tracking, learning recommendations, analytics, and an Admin Dashboard.

---

## Live Demo

- Live URL: `<add your deployed link here>`
- GitHub Repository: `<add your GitHub repo link here>`

---

## Features

- User signup, login, and authentication
- Spaces and Projects to organize learning material
- PDF upload and processing
- Material processing runs in the background (doesn't block the user)
- Retrieval-based search over uploaded material (RAG)
- AI Tutor that answers only from uploaded material, with source citations
- Tutor tells the user when it doesn't have enough information to answer
- Adaptive quizzes (question difficulty adjusts to the learner)
- Open-ended assessments with AI grading
- Concept mastery tracking
- Growth tracking over time
- Personalized learning recommendations
- Project-level and platform-level analytics
- Activity tracking
- Persistent learning context (remembers goals, weak areas, mistakes)
- Admin Dashboard
- AI usage tracking and evaluation

---

## Technology Stack

### Backend
- FastAPI (Python)
- SQLAlchemy (ORM)

### Frontend
- React
- TypeScript
- Vite

### Database
- PostgreSQL
- pgvector (used to store and search document embeddings)

### Embeddings (for search)
- sentence-transformers
- all-MiniLM-L6-v2 model
- Runs locally, no extra API key needed

### AI
- Groq API
- Model: `openai/gpt-oss-120b` (default)

The AI is used for:
- Tutor answers
- Quiz generation
- Grading open-ended answers
- Learning recommendations

---

## Project Structure

```text
ai_tutor/
│
├── backend/
│   ├── app/
│   ├── requirements.txt
│   └── ...
│
├── frontend/
│   ├── src/
│   ├── package.json
│   └── ...
│
├── README.md
├── ARCHITECTURE.md
├── AI_USAGE.md
├── EVALUATION.md
├── DECISIONS.md
├── LIMITATIONS.md
├── FUTURE_IMPROVEMENTS.md
├── .gitignore
└── .env.example
```

---

## How to Run This Project Locally

### 1. Requirements
- Python 3.11+
- Node.js 18+
- PostgreSQL with the pgvector extension

### 2. Backend Setup
```bash
cd backend
python -m venv venv
venv\Scripts\activate       # on Windows
source venv/bin/activate    # on Mac/Linux

pip install -r requirements.txt

# copy the example env file and fill in real values
copy .env.example .env      # on Windows
cp .env.example .env        # on Mac/Linux

uvicorn app.main:app --reload
```
The backend runs at `http://localhost:8000` by default.

### 3. Frontend Setup
```bash
cd frontend
npm install

copy .env.example .env      # on Windows
cp .env.example .env        # on Mac/Linux

npm run dev
```
The frontend runs at `http://localhost:5173` by default (check the terminal output for the exact port).

### 4. Environment Variables (Backend)
| Variable | What it's for |
|---|---|
| `DATABASE_URL` | Connection string for the PostgreSQL database |
| `JWT_SECRET` | Secret key used to sign login tokens |
| `GROQ_API_KEY` | API key for the AI features (Tutor, quiz, grading, recommendations) |

### 5. Environment Variables (Frontend)
| Variable | What it's for |
|---|---|
| `VITE_API_BASE` | URL of the backend API |

---

## Other Documents

- [ARCHITECTURE.md](ARCHITECTURE.md) — how the system is built
- [DECISIONS.md](DECISIONS.md) — key decisions made and why
- [EVALUATION.md](EVALUATION.md) — how the AI features were tested
- [LIMITATIONS.md](LIMITATIONS.md) — known limitations
- [FUTURE_IMPROVEMENTS.md](FUTURE_IMPROVEMENTS.md) — what could be improved next
- [AI_USAGE.md](AI_USAGE.md) — how AI tools were used to build this project
