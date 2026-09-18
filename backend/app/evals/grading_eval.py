"""AI eval suite: open-ended assessment grading (Section 14 requirement).

Fixed open-ended answers of known quality (great/partial/wrong) against a
fixed question + expected key points. Asserts the grader's structured
feedback correctly identifies missing concepts.

Run: python -m app.evals.grading_eval
Requires ANTHROPIC_API_KEY to be set (makes real LLM calls). Records a row
in eval_runs.
"""

import asyncio
import sys

from app.database import SessionLocal
from app.models.models import Concept, EvalRun, Project, QuizQuestion, Space, User
from app.services.grading import grade_open_ended

QUESTION = "Explain what overfitting is and how regularization helps prevent it."
EXPECTED_KEY_POINTS = [
    "model fits training data too closely / learns noise",
    "poor generalization to new/unseen data",
    "regularization (e.g. L2, dropout) reduces model complexity or penalizes large weights",
]

CASES = [
    {
        "label": "great",
        "answer": (
            "Overfitting happens when a model learns the training data too well, including its noise, "
            "so it performs great on training data but poorly on new, unseen data because it hasn't "
            "learned the true underlying pattern. Regularization techniques like L2 penalty or dropout "
            "help by discouraging the model from fitting the noise — L2 penalizes large weights, and "
            "dropout randomly disables neurons during training so the model can't over-rely on any one "
            "feature, both of which push the model toward simpler, more generalizable solutions."
        ),
        "expect_understanding": "strong",
        "expect_missing_at_most": 0,
    },
    {
        "label": "partial",
        "answer": (
            "Overfitting is when a model does really well on training data but bad on new data. "
            "I think it happens because the model is too complex."
        ),
        "expect_understanding": "partial",
        "expect_missing_at_least": 1,  # should flag that regularization mechanism wasn't explained
    },
    {
        "label": "wrong",
        "answer": (
            "Overfitting is when you don't have enough training data, so the model just guesses randomly. "
            "You fix it by adding more layers to the neural network."
        ),
        "expect_understanding": "weak",
        "expect_missing_at_least": 2,
    },
]


def _setup(db) -> tuple[str, str, QuizQuestion]:
    user = User(email="eval-grading@internal.test", hashed_password="x")
    db.add(user)
    db.commit()
    db.refresh(user)
    space = Space(owner_id=user.id, name="Eval Space")
    db.add(space)
    db.commit()
    db.refresh(space)
    project = Project(space_id=space.id, owner_id=user.id, name="Eval Project")
    db.add(project)
    db.commit()
    db.refresh(project)
    concept = Concept(project_id=project.id, owner_id=user.id, name="Overfitting")
    db.add(concept)
    db.commit()
    db.refresh(concept)

    question = QuizQuestion(
        project_id=project.id,
        owner_id=user.id,
        concept_id=concept.id,
        kind="open_ended",
        question_text=QUESTION,
        expected_key_points=EXPECTED_KEY_POINTS,
    )
    db.add(question)
    db.commit()
    db.refresh(question)
    return user.id, project.id, question


async def run() -> EvalRun:
    db = SessionLocal()
    owner_id, project_id, question = _setup(db)

    details = []
    passed = 0
    failed = 0

    for case in CASES:
        grading = await grade_open_ended(db, owner_id, project_id, question, case["answer"])

        ok = grading.understanding_level == case["expect_understanding"]
        if "expect_missing_at_most" in case:
            ok = ok and len(grading.concepts_missing) <= case["expect_missing_at_most"]
        if "expect_missing_at_least" in case:
            ok = ok and len(grading.concepts_missing) >= case["expect_missing_at_least"]

        details.append(
            {
                "label": case["label"],
                "expected_understanding": case["expect_understanding"],
                "actual_understanding": grading.understanding_level,
                "concepts_missing": grading.concepts_missing,
                "passed": ok,
            }
        )
        passed += int(ok)
        failed += int(not ok)

    run_row = EvalRun(suite="assessment_grading", passed=passed, failed=failed, details=details)
    db.add(run_row)
    db.commit()
    db.refresh(run_row)
    db.close()
    return run_row


if __name__ == "__main__":
    result = asyncio.run(run())
    print(f"assessment_grading eval: {result.passed} passed, {result.failed} failed")
    for d in result.details:
        status = "PASS" if d["passed"] else "FAIL"
        print(f"  [{status}] {d['label']}: expected={d['expected_understanding']} actual={d['actual_understanding']}")
    sys.exit(0 if result.failed == 0 else 1)
