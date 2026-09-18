"""Shared rate limiter, keyed by authenticated user when possible (falls back
to IP for unauthenticated requests) so limits are per-user, not shared across
all clients behind one IP."""

from fastapi import Request
from slowapi import Limiter
from slowapi.util import get_remote_address


def _key_func(request: Request) -> str:
    auth_header = request.headers.get("authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header[len("Bearer "):]
        # Use the raw token as the rate-limit key (cheap, avoids re-decoding
        # JWT here); each user's token is effectively their identity for
        # this purpose since tokens aren't shared across users.
        return f"user:{token[-32:]}"
    return get_remote_address(request)


limiter = Limiter(key_func=_key_func)
