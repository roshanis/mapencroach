"""JWT bearer authentication and role-based access control.

Two verification modes, selected by environment:

- **OIDC (production)** — set MAPENCROACH_OIDC_JWKS_URL (Keycloak's
  jwks_uri) or MAPENCROACH_OIDC_JWKS (inline JWKS JSON, used in tests).
  Tokens must be RS256-signed by a key in that set; issuer and audience
  are checked when MAPENCROACH_OIDC_ISSUER / MAPENCROACH_OIDC_AUDIENCE
  are set. The dev HS256 path is disabled entirely in this mode — a
  leaked dev secret cannot mint production tokens.
- **Dev/demo (default)** — HS256 with MAPENCROACH_JWT_SECRET.

All configuration is read at call time (not import time) so tests can
monkeypatch the environment without reloading the module. Tokens carry
the three claims the rest of the API relies on for authorization: who
(sub), what they're allowed to do (role), and which subtree of the
jurisdiction tree they can see (jurisdiction_id). Keycloak deployments
map the role through realm roles (realm_access.roles) and add
jurisdiction_id as a user-attribute claim in the client scope.
"""

import json
import os
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from functools import lru_cache
from typing import Annotated, Any

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

_ALGORITHM = "HS256"
_OIDC_ALGORITHM = "RS256"
_DEFAULT_SECRET = "dev-secret-do-not-deploy"  # noqa: S105 - documented dev default, not a real secret


def _secret() -> str:
    return os.environ.get("MAPENCROACH_JWT_SECRET", _DEFAULT_SECRET)


def _oidc_configured() -> bool:
    return bool(
        os.environ.get("MAPENCROACH_OIDC_JWKS_URL") or os.environ.get("MAPENCROACH_OIDC_JWKS")
    )


@lru_cache(maxsize=4)
def _jwks_client(url: str) -> jwt.PyJWKClient:
    return jwt.PyJWKClient(url, cache_keys=True)


def _oidc_signing_key(token: str):
    """Resolve the RS256 verification key for `token` from the configured JWKS."""
    inline = os.environ.get("MAPENCROACH_OIDC_JWKS")
    if inline:
        keys = json.loads(inline)["keys"]
        kid = jwt.get_unverified_header(token).get("kid")
        for key_dict in keys:
            if kid is None or key_dict.get("kid") == kid:
                return jwt.PyJWK(key_dict).key
        raise jwt.PyJWTError(f"no JWKS key matches kid {kid!r}")
    url = os.environ["MAPENCROACH_OIDC_JWKS_URL"]
    return _jwks_client(url).get_signing_key_from_jwt(token).key


def _decode_oidc(token: str) -> dict[str, Any]:
    issuer = os.environ.get("MAPENCROACH_OIDC_ISSUER")
    audience = os.environ.get("MAPENCROACH_OIDC_AUDIENCE")
    return jwt.decode(
        token,
        key=_oidc_signing_key(token),
        algorithms=[_OIDC_ALGORITHM],
        issuer=issuer,
        audience=audience,
        options={
            "verify_iss": issuer is not None,
            "verify_aud": audience is not None,
            "require": ["exp", "sub"],
        },
    )


def _role_from_claims(payload: dict[str, Any]) -> "Role":
    """Extract exactly one recognized role from token claims.

    Checks the direct `role` claim first (dev tokens, custom mappers),
    then Keycloak's realm_access.roles. Requiring exactly one recognized
    role keeps least-privilege honest — a user provisioned with two
    mapencroach roles is a provisioning error, not a merge.
    """
    direct = payload.get("role")
    if direct is not None:
        return Role(direct)

    realm_roles = payload.get("realm_access", {}).get("roles", [])
    known = {role.value for role in Role}
    matched = [name for name in realm_roles if name in known]
    if len(matched) != 1:
        raise ValueError(f"expected exactly one recognized role, got {matched!r}")
    return Role(matched[0])


def signing_secret() -> str:
    """The active signing secret, for callers that mint tokens (demo login)."""
    return _secret()


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
        if _oidc_configured():
            payload = _decode_oidc(credentials.credentials)
        else:
            payload = jwt.decode(credentials.credentials, _secret(), algorithms=[_ALGORITHM])
    except (jwt.PyJWTError, ValueError, KeyError) as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid or expired token"
        ) from exc

    try:
        role = _role_from_claims(payload)
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
