"""HS256 JWT bearer authentication and role-based access control.

The secret is read from MAPENCROACH_JWT_SECRET at call time (not import
time) so tests can monkeypatch the environment without reloading the
module. Tokens carry the three claims the rest of the API relies on for
authorization: who (sub), what they're allowed to do (role), and which
subtree of the jurisdiction tree they can see (jurisdiction_id).
"""

import os
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

_ALGORITHM = "HS256"
_DEFAULT_SECRET = "dev-secret-do-not-deploy"  # noqa: S105 - documented dev default, not a real secret


def _secret() -> str:
    return os.environ.get("MAPENCROACH_JWT_SECRET", _DEFAULT_SECRET)


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
    }
    return jwt.encode(payload, secret, algorithm=_ALGORITHM)


_bearer_scheme = HTTPBearer(auto_error=False)


def current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer_scheme)],
) -> User:
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="missing token")

    try:
        payload = jwt.decode(credentials.credentials, _secret(), algorithms=[_ALGORITHM])
    except jwt.PyJWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid or expired token"
        ) from exc

    try:
        role = Role(payload["role"])
        return User(
            sub=payload["sub"],
            role=role,
            jurisdiction_id=payload["jurisdiction_id"],
        )
    except (KeyError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="malformed token claims"
        ) from exc


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
