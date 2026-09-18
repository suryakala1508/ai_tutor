from datetime import datetime, timedelta, timezone

from app.models.models import Concept, ConceptMastery, Project, QuizAnswer, Space, User
from app.services.adaptive_selection import select_next_concept
from app.services.mastery import update_mastery


def _record_answer(db, project, user, concept, is_correct=None, understanding_level=None):
    """Mirrors the real flow: the quiz router persists a QuizAnswer row before
    calling update_mastery, so classify_trend's recent-wrong-answer lookback
    has something to query."""
    answer = QuizAnswer(
        question_id="q-" + concept.id,
        project_id=project.id,
        owner_id=user.id,
        concept_id=concept.id,
        answer_text="answer",
        is_correct=is_correct,
        understanding_level=understanding_level,
    )
    db.add(answer)
    db.commit()
    return update_mastery(db, project.id, user.id, concept.id, is_correct=is_correct, understanding_level=understanding_level)


def _make_user_space_project(db, email="m@test.com"):
    user = User(email=email, hashed_password="x")
    db.add(user)
    db.commit()
    db.refresh(user)
    space = Space(owner_id=user.id, name="S")
    db.add(space)
    db.commit()
    db.refresh(space)
    project = Project(space_id=space.id, owner_id=user.id, name="P", goal="g")
    db.add(project)
    db.commit()
    db.refresh(project)
    return user, project


def _make_concept(db, project, user, name="Gradient Descent"):
    concept = Concept(project_id=project.id, owner_id=user.id, name=name)
    db.add(concept)
    db.commit()
    db.refresh(concept)
    return concept


def test_mastery_increases_on_correct_answers(db_session):
    user, project = _make_user_space_project(db_session)
    concept = _make_concept(db_session, project, user)

    row = _record_answer(db_session, project, user, concept, is_correct=True)
    assert row.mastery > 0.3  # starts at default 0.3, should move up

    for _ in range(4):
        row = _record_answer(db_session, project, user, concept, is_correct=True)
    assert row.mastery > 0.8


def test_mastery_decreases_on_wrong_answers(db_session):
    user, project = _make_user_space_project(db_session, "m2@test.com")
    concept = _make_concept(db_session, project, user)

    # push mastery up first
    for _ in range(5):
        row = _record_answer(db_session, project, user, concept, is_correct=True)
    high_mastery = row.mastery

    for _ in range(3):
        row = _record_answer(db_session, project, user, concept, is_correct=False)

    assert row.mastery < high_mastery


def test_open_ended_partial_credit_between_strong_and_weak(db_session):
    user, project = _make_user_space_project(db_session, "m3@test.com")
    concept = _make_concept(db_session, project, user)

    strong = _record_answer(db_session, project, user, concept, understanding_level="strong")
    db_session.rollback()

    user2, project2 = _make_user_space_project(db_session, "m4@test.com")
    concept2 = _make_concept(db_session, project2, user2, "Gradient Descent")
    partial = _record_answer(db_session, project2, user2, concept2, understanding_level="partial")

    user3, project3 = _make_user_space_project(db_session, "m5@test.com")
    concept3 = _make_concept(db_session, project3, user3, "Gradient Descent")
    weak = _record_answer(db_session, project3, user3, concept3, understanding_level="weak")

    assert weak.mastery < partial.mastery < strong.mastery


def test_repeated_wrong_answers_trigger_needs_attention_trend(db_session):
    user, project = _make_user_space_project(db_session, "m6@test.com")
    concept = _make_concept(db_session, project, user)

    for _ in range(2):
        row = _record_answer(db_session, project, user, concept, is_correct=False)

    assert row.trend == "needs-attention"


def test_adaptive_selection_prioritizes_low_mastery_over_recently_mastered(db_session):
    user, project = _make_user_space_project(db_session, "a1@test.com")
    weak_concept = _make_concept(db_session, project, user, "Weak Concept")
    strong_concept = _make_concept(db_session, project, user, "Strong Concept")

    now = datetime.now(timezone.utc)

    db_session.add(
        ConceptMastery(
            project_id=project.id,
            owner_id=user.id,
            concept_id=weak_concept.id,
            mastery=0.15,
            attempts=1,
            last_practiced_at=now,
        )
    )
    db_session.add(
        ConceptMastery(
            project_id=project.id,
            owner_id=user.id,
            concept_id=strong_concept.id,
            mastery=0.95,
            attempts=5,
            last_practiced_at=now,
        )
    )
    db_session.commit()

    pick = select_next_concept(db_session, project.id, user.id, recent_mistake_concept_ids=set())
    assert pick["concept_id"] == weak_concept.id


def test_adaptive_selection_surfaces_stale_concept_even_with_decent_mastery(db_session):
    user, project = _make_user_space_project(db_session, "a2@test.com")
    stale_concept = _make_concept(db_session, project, user, "Stale Concept")
    fresh_concept = _make_concept(db_session, project, user, "Fresh Concept")

    now = datetime.now(timezone.utc)

    # Both at the same decent mastery, but stale_concept hasn't been touched in 20 days.
    db_session.add(
        ConceptMastery(
            project_id=project.id,
            owner_id=user.id,
            concept_id=stale_concept.id,
            mastery=0.6,
            attempts=3,
            last_practiced_at=now - timedelta(days=20),
        )
    )
    db_session.add(
        ConceptMastery(
            project_id=project.id,
            owner_id=user.id,
            concept_id=fresh_concept.id,
            mastery=0.6,
            attempts=3,
            last_practiced_at=now,
        )
    )
    db_session.commit()

    pick = select_next_concept(db_session, project.id, user.id, recent_mistake_concept_ids=set())
    assert pick["concept_id"] == stale_concept.id


def test_adaptive_selection_boosts_recent_mistake_concept(db_session):
    user, project = _make_user_space_project(db_session, "a3@test.com")
    mistake_concept = _make_concept(db_session, project, user, "Mistake Concept")
    other_concept = _make_concept(db_session, project, user, "Other Concept")

    now = datetime.now(timezone.utc)
    for c in (mistake_concept, other_concept):
        db_session.add(
            ConceptMastery(
                project_id=project.id,
                owner_id=user.id,
                concept_id=c.id,
                mastery=0.6,
                attempts=3,
                last_practiced_at=now,
            )
        )
    db_session.commit()

    pick = select_next_concept(
        db_session, project.id, user.id, recent_mistake_concept_ids={mistake_concept.id}
    )
    assert pick["concept_id"] == mistake_concept.id
