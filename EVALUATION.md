# Evaluation

This document explains how the AI features in this project were tested.

Two kinds of testing are used:
1. **Automated tests** — fast, no real AI calls, check that the code around the AI works correctly (like citation formatting or rejecting bad AI output).
2. **Live evaluation suites** — make real AI calls against a fixed set of test cases, to check that the AI's actual answers are good.

## Tutor Answer Accuracy

**Live test:** `backend/app/evals/tutor_groundedness_eval.py`

A short test document about machine learning topics (gradient descent, learning rate, overfitting, cross-validation) is uploaded, and 12 fixed questions are asked:
- 6 questions that **can** be answered from the document — the Tutor should answer with a correct citation.
- 6 questions that **cannot** be answered from the document (like "What is the capital of France?") — the Tutor should say it doesn't have enough information, instead of guessing.

Each run is saved and shown in the Admin Dashboard's evaluation panel.

**Automated tests:** check that citations are only shown when they are actually used, and that the "not enough information" instruction is placed correctly in the Tutor's prompt.

## Search / Retrieval Quality

**Live test:** `backend/app/evals/retrieval_quality_eval.py` (no AI calls, fast to run)

This tests the search feature directly: 8 fixed test cases check that a relevant question returns the right piece of text, and an unrelated question is correctly flagged as "not enough information."

This test caught a real bug early on — an older, simpler search method sometimes ranked an unrelated sentence above the correct one. It was fixed by switching to real AI embeddings (see DECISIONS.md).

## Quiz Grading Accuracy

**Live test:** `backend/app/evals/grading_eval.py`

One open-ended question is graded using three sample answers of different quality:
- A **complete and correct** answer → should be graded as "strong understanding"
- A **partial** answer → should be graded as "partial understanding"
- A **wrong** answer → should be graded as "weak understanding"

**Automated tests:** check that valid AI grading output is accepted, bad output is rejected and retried, and a failed grading attempt never gets saved as a real answer.

## Recommendation Quality

Recommendations are checked for correct structure before being saved. The system also avoids repeating the same recommendation twice in a row.

There is currently no automated live test that checks if a recommendation's *content* is actually good advice — this is listed in FUTURE_IMPROVEMENTS.md as something to add next.

## How to Run the Live Evaluations
```bash
cd backend
source venv/bin/activate    # or venv\Scripts\activate on Windows

python -m app.evals.tutor_groundedness_eval
python -m app.evals.grading_eval
python -m app.evals.retrieval_quality_eval
```
The first two require a real `GROQ_API_KEY` set in `.env`. Each script prints pass/fail results and saves them for the Admin Dashboard.
