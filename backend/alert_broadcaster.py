"""
Alert notification broadcaster.

Sends alert messages to the specific user's WebSocket queues.
The same queue used for tick data is reused — messages are
differentiated by `type` field ("tick" vs "alert").

Thread-safe: push from the KiteTicker thread uses
asyncio.run_coroutine_threadsafe; async code uses await directly.
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from typing import Any

log = logging.getLogger(__name__)

# user_id → set of asyncio.Queue (same queues as in ticker._clients)
_user_queues: dict[uuid.UUID, set[asyncio.Queue]] = {}


def register(user_id: uuid.UUID, q: asyncio.Queue) -> None:
    """Register a WebSocket queue as belonging to a specific user."""
    if user_id not in _user_queues:
        _user_queues[user_id] = set()
    _user_queues[user_id].add(q)


def unregister(user_id: uuid.UUID, q: asyncio.Queue) -> None:
    """Unregister a WebSocket queue for a user (on disconnect)."""
    queues = _user_queues.get(user_id)
    if queues:
        queues.discard(q)
        if not queues:
            del _user_queues[user_id]


async def broadcast(user_id: uuid.UUID, payload: dict[str, Any]) -> None:
    """
    Put an alert message into all WebSocket queues owned by user_id.

    Called from async context (scheduler / router).
    """
    queues = _user_queues.get(user_id)
    if not queues:
        return
    msg = {"type": "alert", "data": payload}
    for q in list(queues):
        try:
            await q.put(msg)
        except Exception as exc:  # pragma: no cover
            log.warning("broadcast: failed to enqueue alert for user %s: %s", user_id, exc)


def broadcast_threadsafe(
    user_id: uuid.UUID,
    payload: dict[str, Any],
    loop: asyncio.AbstractEventLoop,
) -> None:
    """
    Put an alert message into user queues from a non-async thread
    (e.g. the KiteTicker callback thread).
    """
    asyncio.run_coroutine_threadsafe(broadcast(user_id, payload), loop)
