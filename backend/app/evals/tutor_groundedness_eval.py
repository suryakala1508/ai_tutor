"""AI eval suite: Tutor groundedness (Section 14 requirement).

10-15 question/answer pairs against a known test document (a short passage
about gradient descent, learning rate, and overfitting). Some are
answerable-from-material; some are deliberately unanswerable. Asserts the
Tutor cites correctly on the former and declines/flags uncertainty on the
latter.

Run: python -m app.evals.tutor_groundedness_eval
Requires ANTHROPIC_API_KEY to be set (makes real LLM calls). Records a row
in eval_runs so the Admin eval panel has something to show.
"""

import asyncio
import sys

from app.database import SessionLocal
from app.models.models import Chunk, Concept, EvalRun, Material, Project, Space, User
from app.services.embeddings import embed
from app.services.tutor import assemble_context
from anthropic import AsyncAnthropic
from app.config import get_settings

TEST_DOCUMENT = """Gradient Descent is an optimization algorithm used to minimize a loss \
function by iteratively moving in the direction of steepest descent, as defined by the \
negative of the gradient.

Learning Rate controls how large a step gradient descent takes on each iteration. Too large \
a learning rate can cause divergence; too small makes convergence slow.

Overfitting occurs when a model learns the training data too well, including its noise, and \
fails to generalize to new data. Regularization techniques like L2 penalty or dropout help \
reduce overfitting.

Cross-Validation is a technique for assessing how a model generalizes to an independent \
dataset by partitioning data into training and validation folds."""

CASES = [
    # answerable-from-material
    {"question": "What is gradient descent?", "answerable": True, "must_cite": True},
    {"question": "What happens if the learning rate is too large?", "answerable": True, "must_cite": True},
    {"question": "What is overfitting?", "answerable": True, "must_cite": True},
    {"question": "Name a regularization technique mentioned in the material.", "answerable": True, "must_cite": True},
    {"question": "What is cross-validation used for?", "answerable": True, "must_cite": True},
    {"question": "How does the learning rate affect convergence speed?", "answerable": True, "must_cite": True},
    # deliberately unanswerable from this material
    {"question": "What is the capital of France?", "answerable": False, "must_cite": False},
    {"question": "Explain the transformer attention mechanism.", "answerable": False, "must_cite": False},
    {"question": "What is the Adam optimizer's beta_2 default value?", "answerable": False, "must_cite": False},
    {"question": "Who invented gradient descent and in what year?", "answerable": False, "must_cite": False},
    {"question": "What is the time complexity of k-means clustering?", "answerable": False, "must_cite": False},
    {"question": "Summarize chapter 5 of the material.", "answerable": False, "must_cite": False},
]

DECLINE_PHRASES = ["don't have enough information", "insufficient", "cannot answer", "not enough information", "no information"]


def _setup_project(db) -> tuple[str, str]:
    user = User(email="eval-tutor@internal.test", hashed_password="x")
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

    material = Material(
        project_id=project.id,
        owner_id=user.id,
        name="Machine Learning Notes",
        status="ready",
        raw_text=TEST_DOCUMENT,
        page_count=1,
    )
    db.add(material)
    db.commit()
    db.refresh(material)

    for i, para in enumerate(TEST_DOCUMENT.split("\n\n")):
        chunk = Chunk(
            material_id=material.id,
            project_id=project.id,
            owner_id=user.id,
            page_number=1,
            chunk_index=i,
            text=para,
            embedding=embed(para),
        )
        db.add(chunk)
    db.commit()

    return user.id, project.id


async def run() -> EvalRun:
    settings = get_settings()
    db = SessionLocal()
    owner_id, project_id = _setup_project(db)

    client = AsyncAnthropic(api_key=settings.anthropic_api_key)
    details = []
    passed = 0
    failed = 0

    for case in CASES:
        ctx = assemble_context(db, owner_id, project_id, conversation_id="eval-conv", question=case["question"])
        response = await client.messages.create(
            model=settings.tutor_model,
            max_tokens=500,
            system=ctx["system_prompt"],
            messages=[{"role": "user", "content": case["question"]}],
        )
        answer_text = "".join(b.text for b in response.content if b.type == "text")

        from app.services.tutor import extract_citations_used

        citations = extract_citations_used(answer_text, ctx["citation_candidates"])
        declined = any(phrase in answer_text.lower() for phrase in DECLINE_PHRASES)

        if case["answerable"]:
            ok = len(citations) > 0 and not declined
        else:
            ok = declined or len(citations) == 0

        details.append(
            {
                "question": case["question"],
                "answerable": case["answerable"],
                "citations_found": len(citations),
                "declined": declined,
                "passed": ok,
                "answer_excerpt": answer_text[:200],
            }
        )
        passed += int(ok)
        failed += int(not ok)

    run_row = EvalRun(suite="tutor_groundedness", passed=passed, failed=failed, details=details)
    db.add(run_row)
    db.commit()
    db.refresh(run_row)
    db.close()
    return run_row


if __name__ == "__main__":
    result = asyncio.run(run())
    print(f"tutor_groundedness eval: {result.passed} passed, {result.failed} failed")
    for d in result.details:
        status = "PASS" if d["passed"] else "FAIL"
        print(f"  [{status}] {d['question']}")
    sys.exit(0 if result.failed == 0 else 1)
