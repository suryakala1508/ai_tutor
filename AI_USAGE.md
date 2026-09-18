# AI Usage

## (a) AI Tools Used to Build This Project

This project was built with the help of a few different AI tools, each used for a different part of the work:

| Tool | Used for |
|---|---|
| **OpenCode** | Main coding assistant — writing and editing the backend and frontend code, step by step |
| **Claude** | Prompting and UI designing |
| **ChatGPT** | Planning ideas, understanding concepts, and drafting/checking documentation |

OpenCode was used the most, working through the project step by step. Below is a simple summary of what was built in each step.

| Step | What was built |
|---|---|
| Foundation | Authentication, database schema, Space/Project creation, file upload and processing, search |
| Tutor chat | Context building, streaming chat responses, citations, "not enough info" handling |
| AI tool layer | Tools like `search_materials`, `get_mastery`, `get_recent_mistakes` — all with ownership checks |
| Adaptive quizzes | Question selection logic, AI-generated questions, AI grading of open-ended answers |
| Learning pipeline | Mastery calculation, trend detection (improving/needs attention), recommendations, background jobs |
| Persistent learning context | Stores each learner's goals, weak areas, and repeated mistakes, and uses them to personalize the Tutor |
| Analytics and Admin | Project analytics, Home dashboard, Admin dashboard (users, activity, AI usage, evaluations) |
| Security review | Checked every route for proper ownership checks, added input validation, rate limiting, and error handling |
| Tests and frontend | Automated backend tests, and the full React frontend (Home, Project, Tutor, Quiz, Growth, Analytics, Admin) |

**How changes were verified:** by actually running the app, not just reading the code — running the automated test suite after each change, testing the API directly, and manually going through the app in the browser (signup → create project → upload material → chat with Tutor → take quiz → check growth and analytics).

## (b) AI Used Inside the Product

| Feature | Where it's used | Purpose |
|---|---|---|
| AI Tutor | Chat page | Answers questions using only the uploaded material, with citations, streamed live |
| Quiz generation | Quiz page | Creates quiz questions based on the learner's weak concepts |
| Answer grading | Quiz page | Grades open-ended answers and explains what was missing |
| Recommendations | Home / Growth page | Suggests the next best thing to study, based on mastery and recent activity |
| Concept extraction | Runs after upload | Automatically finds the key concepts inside uploaded material |

All AI calls are logged (model used, tokens used, response time, success/failure) and shown in the Analytics and Admin pages, so AI usage and cost can be tracked.
