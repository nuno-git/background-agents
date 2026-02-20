"""
GitHub App token generation for git operations.
Mirrors packages/modal-infra/src/auth/github_app.py.
"""

import time

import httpx
import jwt

from . import config


def generate_jwt(app_id: str, private_key: str) -> str:
    now = int(time.time())
    payload = {
        "iat": now - 60,
        "exp": now + 600,
        "iss": app_id,
    }
    return jwt.encode(payload, private_key, algorithm="RS256")


def get_installation_token(jwt_token: str, installation_id: str) -> str:
    url = f"https://api.github.com/app/installations/{installation_id}/access_tokens"
    headers = {
        "Authorization": f"Bearer {jwt_token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    with httpx.Client() as client:
        response = client.post(url, headers=headers)
        response.raise_for_status()
        return response.json()["token"]


def generate_installation_token() -> str | None:
    """Generate a GitHub App installation token using configured credentials."""
    app_id = config.GITHUB_APP_ID
    private_key = config.GITHUB_APP_PRIVATE_KEY
    installation_id = config.GITHUB_APP_INSTALLATION_ID

    if not (app_id and private_key and installation_id):
        return None

    jwt_token = generate_jwt(app_id, private_key)
    return get_installation_token(jwt_token, installation_id)
