from app.models.models import LearningContext, Project, Space, User
from app.services.context_selection import select_learning_context


def test_project_a_learning_context_never_leaks_into_project_b(db_session):
    user = User(email="iso@test.com", hashed_password="x")
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)

    space = Space(owner_id=user.id, name="S")
    db_session.add(space)
    db_session.commit()
    db_session.refresh(space)

    project_a = Project(space_id=space.id, owner_id=user.id, name="Project A", goal="Learn calculus")
    project_b = Project(space_id=space.id, owner_id=user.id, name="Project B", goal="Learn cooking")
    db_session.add_all([project_a, project_b])
    db_session.commit()
    db_session.refresh(project_a)
    db_session.refresh(project_b)

    ctx_a = LearningContext(
        project_id=project_a.id,
        owner_id=user.id,
        goal="Learn calculus",
        weaknesses=[{"concept_id": "c1", "concept_name": "derivatives", "note": "struggles with chain rule"}],
        repeated_mistakes=[{"concept_id": "c1", "concept_name": "derivatives", "count": 3}],
    )
    db_session.add(ctx_a)
    db_session.commit()

    # Project B has its own (empty) context — same user, same query keyword.
    selected_for_b = select_learning_context(db_session, user.id, project_b.id, "derivatives chain rule")

    assert "derivatives" not in selected_for_b["text"]
    assert "calculus" not in selected_for_b["text"]
    assert "chain rule" not in selected_for_b["text"]

    # Sanity check: the same query against Project A DOES surface its own context.
    selected_for_a = select_learning_context(db_session, user.id, project_a.id, "derivatives chain rule")
    assert "derivatives" in selected_for_a["text"]


def test_learning_context_is_scoped_by_unique_project_id(db_session):
    user = User(email="iso2@test.com", hashed_password="x")
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)

    space = Space(owner_id=user.id, name="S")
    db_session.add(space)
    db_session.commit()
    db_session.refresh(space)

    project_a = Project(space_id=space.id, owner_id=user.id, name="A")
    project_b = Project(space_id=space.id, owner_id=user.id, name="B")
    db_session.add_all([project_a, project_b])
    db_session.commit()
    db_session.refresh(project_a)
    db_session.refresh(project_b)

    from app.services.context_selection import get_or_create_context

    ctx_a = get_or_create_context(db_session, user.id, project_a.id)
    ctx_b = get_or_create_context(db_session, user.id, project_b.id)

    assert ctx_a.id != ctx_b.id
    assert ctx_a.project_id != ctx_b.project_id
