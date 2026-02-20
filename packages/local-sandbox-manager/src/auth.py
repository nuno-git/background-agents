"""
HMAC-SHA256 token verification for service-to-service authentication.
Mirrors packages/modal-infra/src/auth/internal.py.
"""

import hashlib
import hmac
import time

from . import config

TOKEN_VALIDITY_SECONDS = 5 * 60  # 5 minutes


class AuthConfigurationError(Exception):
    pass


def require_secret() -> str:
    secret = config.MODAL_API_SECRET
    if not secret:
        raise AuthConfigurationError(
            "MODAL_API_SECRET environment variable is not configured."
        )
    return secret


def verify_internal_token(auth_header: str | None, secret: str | None = None) -> bool:
    if secret is None:
        secret = require_secret()

    if not auth_header or not auth_header.startswith("Bearer "):
        return False

    token = auth_header[7:]
    parts = token.split(".")

    if len(parts) != 2:
        return False

    timestamp_str, signature = parts

    try:
        token_time_ms = int(timestamp_str)
    except ValueError:
        return False

    token_time = token_time_ms / 1000
    now = time.time()

    if abs(now - token_time) > TOKEN_VALIDITY_SECONDS:
        return False

    expected_signature = hmac.new(
        secret.encode("utf-8"),
        timestamp_str.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()

    return hmac.compare_digest(signature, expected_signature)
