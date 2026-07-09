# mapencroach backend

Encroachment intelligence and case management platform for Indian state governments.

## Setup

```bash
cd backend
uv venv
uv pip install -q -p .venv/bin/python -e ".[dev]"
```

## Test

```bash
.venv/bin/pytest --cov
```

## Run the API

Start the server with demo seed data (jurisdiction tree, 8 parcels around Bhopal,
4 alerts, 2 cases):

```bash
MAPENCROACH_DEMO=1 .venv/bin/uvicorn "mapencroach.api.app:create_app" --factory
```

Without `MAPENCROACH_DEMO=1` the app boots with an empty store — wire in a real
`Store` (or a future PostGIS-backed implementation behind the same interface)
before serving production traffic.

### Minting a dev token

Auth is HS256 JWT bearer. Mint a token for local testing with `create_token`:

```bash
.venv/bin/python -c "
from datetime import UTC, datetime, timedelta
from mapencroach.api.auth import Role, create_token
print(create_token(
    sub='demo-admin',
    role=Role.DATA_ADMIN,
    jurisdiction_id='state',
    secret='dev-secret-do-not-deploy',
    expires_at=datetime.now(UTC) + timedelta(hours=1),
))
"
```

The secret defaults to `dev-secret-do-not-deploy`; override it in both the
server and the token by setting `MAPENCROACH_JWT_SECRET`.

### Example request

```bash
TOKEN="<paste the minted token>"
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8000/parcels
```

## Lint

```bash
.venv/bin/ruff check .
```
