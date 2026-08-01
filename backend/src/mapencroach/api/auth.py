"""HS256 JWT bearer authentication and role-based access control.

The signing secret is resolved once per app instance by `validate_secret_config`
(called from `create_app`, not at import time, so tests can monkeypatch the
environment before building an app without reloading this module) and fails
closed: outside demo mode the app refuses to start unless MAPENCROACH_JWT_SECRET
is set to something other than the source-visible dev default. Demo mode always
signs with that dev default and says so loudly on startup - it never coexists
with a real secret. Tokens carry the claims the rest of the API relies on for
authorization: who (sub), what they're allowed to do (role), which subtree of
the jurisdiction tree they can see (jurisdiction_id), who issued the token and
who it's for (iss/aud), and when it stops being valid (exp, required on every
token).
"""

import os
import warnings
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from mapencroach.api.store import Store

_ALGORITHM = "HS256"
_DEFAULT_SECRET = "dev-secret-do-not-deploy"  # noqa: S105 - documented dev default, not a real secret
_ISSUER = "mapencroach-api"
_AUDIENCE = "mapencroach-clients"


def validate_secret_config(demo_mode: bool) -> str:
    """Resolve and fail-closed-validate the HS256 signing secret for one app.

    Called once from `create_app` so a misconfigured deployment refuses to
    start rather than silently signing tokens with a secret nobody chose.

    Outside demo mode, MAPENCROACH_JWT_SECRET must be set to something other
    than the well-known dev default - a missing, empty, or default secret
    raises RuntimeError. In demo mode the dev default is always used (and a
    custom MAPENCROACH_JWT_SECRET set alongside MAPENCROACH_DEMO=1 raises,
    rather than being silently ignored, since that combination usually means
    demo mode was switched on in what is otherwise a production
    configuration) and a prominent UserWarning is emitted on every startup
    noting that POST /demo/login mints tokens for any persona with no
    credentials at all.
    """
    secret = os.environ.get("MAPENCROACH_JWT_SECRET", "")

    if demo_mode:
        if secret and secret != _DEFAULT_SECRET:
            raise RuntimeError(
                "MAPENCROACH_DEMO=1 cannot be combined with a custom "
                "MAPENCROACH_JWT_SECRET. Demo mode always signs with the "
                "well-known dev secret and exposes an unauthenticated "
                "token-minting endpoint (POST /demo/login); pairing it with a "
                "real secret is a production-configuration trap, not a "
                "safeguard. Unset MAPENCROACH_JWT_SECRET or disable "
                "MAPENCROACH_DEMO."
            )
        warnings.warn(
            "MAPENCROACH_DEMO=1: signing tokens with the well-known dev "
            "secret and exposing POST /demo/login, which mints a valid "
            "token for any persona with no credentials at all. This build "
            "is for demos only - never deploy it as a production backend.",
            stacklevel=2,
        )
        return _DEFAULT_SECRET

    if not secret or secret == _DEFAULT_SECRET:
        raise RuntimeError(
            "MAPENCROACH_JWT_SECRET must be set to a non-default secret "
            "outside demo mode. Refusing to start with a missing or "
            "well-known signing secret - set MAPENCROACH_JWT_SECRET, or run "
            "with MAPENCROACH_DEMO=1 for a demo deployment."
        )
    return secret


class Role(StrEnum):
    VIEWER = "viewer"
    CASE_OFFICER = "case_officer"
    INSPECTOR = "inspector"
    SURVEY_OFFICER = "survey_officer"
    LEGAL_OFFICER = "legal_officer"
    DATA_ADMIN = "data_admin"
    SYSTEM_ADMIN = "system_admin"


@dataclass(frozen=True)
class User:
    sub: str
    role: Role
    jurisdiction_id: str


def create_token(
    sub: str,
    role: Role,
    jurisdiction_id: str,
    secret: str,
    expires_at: datetime,
) -> str:
    """Mint an HS256 JWT. Used by tests and a future CLI to issue dev tokens."""
    payload = {
        "sub": sub,
        "role": role.value if isinstance(role, Role) else role,
        "jurisdiction_id": jurisdiction_id,
        "exp": expires_at,
        "iss": _ISSUER,
        "aud": _AUDIENCE,
    }
    return jwt.encode(payload, secret, algorithm=_ALGORITHM)


_bearer_scheme = HTTPBearer(auto_error=False)


def _get_jwt_secret(request: Request) -> str:
    return request.app.state.jwt_secret


def _get_store(request: Request) -> Store:
    return request.app.state.store


def current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer_scheme)],
    secret: Annotated[str, Depends(_get_jwt_secret)],
    store: Annotated[Store, Depends(_get_store)],
) -> User:
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="missing token")

    try:
        payload = jwt.decode(
            credentials.credentials,
            secret,
            algorithms=[_ALGORITHM],
            issuer=_ISSUER,
            audience=_AUDIENCE,
            options={"require": ["exp", "iss", "aud"]},
        )
    except jwt.PyJWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid or expired token"
        ) from exc

    try:
        sub = payload["sub"]
        role = Role(payload["role"])
        jurisdiction_id = payload["jurisdiction_id"]
        if not isinstance(jurisdiction_id, str):
            raise ValueError("jurisdiction_id must be a string")
    except (KeyError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="malformed token claims"
        ) from exc

    try:
        store.tree.scope_ids(jurisdiction_id)
    except KeyError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="token jurisdiction_id is not a known jurisdiction",
        ) from exc

    return User(sub=sub, role=role, jurisdiction_id=jurisdiction_id)


def require_roles(*roles: Role):
    """Dependency factory: 403 unless the current user's role is in `roles`."""

    def _check(user: Annotated[User, Depends(current_user)]) -> User:
        if user.role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"role {user.role.value!r} is not permitted for this action",
            )
        return user

    return _check
