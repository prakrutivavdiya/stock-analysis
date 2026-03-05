"""
Tests for /api/v1/audit endpoint.

  GET /audit  → paginated, filterable audit log
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from tests.conftest import USER_ID, seed_audit, seed_user


# ─────────────────────────────────────────────────────────────────────────────
# GET /audit
# ─────────────────────────────────────────────────────────────────────────────

async def test_audit_returns_empty_when_no_logs(client: AsyncClient) -> None:
    """Empty audit log returns total=0 and empty logs list."""
    response = await client.get("/api/v1/audit")

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 0
    assert body["logs"] == []


async def test_audit_returns_own_logs(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Returns audit log entries for the authenticated user."""
    await seed_user(db_session)
    await seed_audit(db_session, action_type="PLACE_ORDER", tradingsymbol="INFY")
    await seed_audit(db_session, action_type="CANCEL_ORDER", tradingsymbol="RELIANCE")

    response = await client.get("/api/v1/audit")

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 2
    assert len(body["logs"]) == 2
    # Default sort is newest-first — verify both are present
    action_types = {log["action_type"] for log in body["logs"]}
    assert action_types == {"PLACE_ORDER", "CANCEL_ORDER"}


async def test_audit_filter_by_action_type(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """action_type filter returns only matching entries."""
    await seed_user(db_session)
    await seed_audit(db_session, action_type="PLACE_ORDER")
    await seed_audit(db_session, action_type="CANCEL_ORDER")

    response = await client.get("/api/v1/audit", params={"action_type": "PLACE_ORDER"})

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    assert body["logs"][0]["action_type"] == "PLACE_ORDER"


async def test_audit_filter_by_tradingsymbol(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """tradingsymbol filter (case-insensitive substring) returns matching entries."""
    await seed_user(db_session)
    await seed_audit(db_session, tradingsymbol="INFY")
    await seed_audit(db_session, tradingsymbol="RELIANCE")

    response = await client.get("/api/v1/audit", params={"tradingsymbol": "INFY"})

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    assert body["logs"][0]["tradingsymbol"] == "INFY"


async def test_audit_filter_by_date_range(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """from_date / to_date filters return only entries within the range."""
    await seed_user(db_session)

    # Create an old entry
    old_log = await seed_audit(db_session, action_type="PLACE_ORDER")
    old_log.created_at = datetime.now(timezone.utc) - timedelta(days=30)
    await db_session.commit()

    # Create a recent entry
    await seed_audit(db_session, action_type="CANCEL_ORDER")

    today = datetime.now(timezone.utc).date().isoformat()
    response = await client.get(
        "/api/v1/audit",
        params={"from_date": today, "to_date": today},
    )

    assert response.status_code == 200
    body = response.json()
    # Only the recent entry should match today's date range
    assert body["total"] == 1
    assert body["logs"][0]["action_type"] == "CANCEL_ORDER"


async def test_audit_pagination(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """limit and offset parameters paginate results correctly."""
    await seed_user(db_session)
    for i in range(5):
        await seed_audit(db_session, action_type="PLACE_ORDER", tradingsymbol=f"SYM{i}")

    # Get page 1 (first 2)
    page1 = await client.get("/api/v1/audit", params={"limit": 2, "offset": 0})
    assert page1.status_code == 200
    page1_body = page1.json()
    assert page1_body["total"] == 5
    assert len(page1_body["logs"]) == 2

    # Get page 2 (next 2)
    page2 = await client.get("/api/v1/audit", params={"limit": 2, "offset": 2})
    page2_body = page2.json()
    assert len(page2_body["logs"]) == 2

    # Entries on page1 and page2 must be different
    ids1 = {log["id"] for log in page1_body["logs"]}
    ids2 = {log["id"] for log in page2_body["logs"]}
    assert ids1.isdisjoint(ids2)


async def test_audit_unknown_action_type_ignored(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Invalid action_type filter is silently ignored (returns all logs)."""
    await seed_user(db_session)
    await seed_audit(db_session, action_type="PLACE_ORDER")

    response = await client.get(
        "/api/v1/audit", params={"action_type": "NOT_A_REAL_ACTION"}
    )

    # Invalid action_type is not in VALID_ACTIONS → filter is ignored
    assert response.status_code == 200
    assert response.json()["total"] == 1


async def test_audit_logs_contain_required_fields(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Each log entry contains all required fields per API spec."""
    await seed_user(db_session)
    await seed_audit(db_session, kite_order_id="ORD001")

    response = await client.get("/api/v1/audit")
    log = response.json()["logs"][0]

    required_fields = {
        "id", "action_type", "tradingsymbol", "exchange",
        "outcome", "created_at", "kite_order_id",
    }
    for field in required_fields:
        assert field in log, f"Missing field: {field}"


async def test_audit_sorted_newest_first(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Logs are returned sorted newest-first (descending created_at)."""
    await seed_user(db_session)

    first = await seed_audit(db_session, action_type="PLACE_ORDER")
    first.created_at = datetime.now(timezone.utc) - timedelta(hours=2)
    await db_session.commit()

    second = await seed_audit(db_session, action_type="CANCEL_ORDER")
    second.created_at = datetime.now(timezone.utc) - timedelta(hours=1)
    await db_session.commit()

    response = await client.get("/api/v1/audit")
    logs = response.json()["logs"]

    # Newest (CANCEL_ORDER) should come first
    assert logs[0]["action_type"] == "CANCEL_ORDER"
    assert logs[1]["action_type"] == "PLACE_ORDER"
