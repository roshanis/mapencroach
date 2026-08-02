"""Imagery providers: where `capture_week` gets its scenes from.

Two implementations ship here:

- `DemoImageryProvider` -- fully deterministic synthetic scenes, no
  network, used for the demo and in tests. Determinism is load-bearing:
  the same (geometry, week) must always yield the same bytes, so tests
  and screenshots stay reproducible and re-running a capture never
  silently produces a different "scene" for a week already on file.
- `CopernicusSentinel2Provider` -- real Sentinel-2 L2A retrieval from the
  Copernicus Data Space Ecosystem (CDSE): OAuth2 client-credentials
  token, a STAC-style catalog search constrained to the week window and
  parcel footprint, then a clipped raster download.

  IMPORTANT -- there are no live Copernicus credentials in this
  environment. This class is built strictly against CDSE's documented
  API shape (Identity token endpoint, Sentinel Hub STAC catalog, Sentinel
  Hub Process API) and is exercised in tests only against mocked HTTP.
  Endpoint URLs, exact request/response field names, and any
  undocumented rate-limit or pagination behavior are UNVERIFIED against
  the live service -- treat this as "correct per the docs" rather than
  "confirmed working."

`build_provider()` chooses between them from the environment, the same
way the rest of the app selects demo vs. real mode.
"""

import hashlib
import json
import os
import time
from collections.abc import Collection, Mapping
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx

from mapencroach.imagery.capture import ProviderScene
from mapencroach.imagery.schedule import WeekRef

# CDSE endpoints, per published documentation as of this writing. Not
# verified against a live account -- see module docstring.
COPERNICUS_TOKEN_URL = "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token"  # noqa: E501, S105 - URL, not a credential
COPERNICUS_CATALOG_URL = "https://sh.dataspace.copernicus.eu/api/v1/catalog/1.0.0/search"
COPERNICUS_PROCESS_URL = "https://sh.dataspace.copernicus.eu/api/v1/process"

_DEMO_SENSOR = "demo-synthetic"
_DEMO_RESOLUTION_M = 10.0
_DEMO_SOURCE = "demo"

# Out of every 10 (geometry, week) pairs, how many are deterministically
# "no coverage at all" vs. "covered but too cloudy" vs. a clean scene.
# These aren't calibrated to real revisit/cloud statistics -- they only
# need to guarantee that gap-handling has something to render.
_DEMO_ABSENT_BUCKETS = 2
_DEMO_CLOUDY_BUCKETS = 2
_DEMO_CLOUDY_PCT = 65.0
_DEMO_CLEAR_MAX_PCT = 25.0


def _json_safe(value: Any) -> Any:
    """Recursively convert Mapping/tuple views into plain dict/list.

    `geometry` may arrive as a plain GeoJSON dict, or (less commonly) as
    something already wrapped in a read-only Mapping. Either way this
    gives back something `json.dumps` can serialize deterministically.
    """
    if isinstance(value, Mapping):
        return {k: _json_safe(v) for k, v in value.items()}
    if isinstance(value, list | tuple):
        return [_json_safe(v) for v in value]
    return value


def _demo_digest(geometry: Mapping[str, Any], week: WeekRef) -> bytes:
    """Deterministic digest of (geometry, week) -- the only source of
    "randomness" `DemoImageryProvider` uses. No clock reads, no `random`
    module: identical inputs always produce identical output.
    """
    canonical = json.dumps(_json_safe(geometry), sort_keys=True, separators=(",", ":"))
    payload = f"{canonical}|{week.key}".encode()
    return hashlib.sha256(payload).digest()


class DemoImageryProvider:
    """Deterministic synthetic imagery source. No network access.

    Selected when MAPENCROACH_DEMO=1 or when no Copernicus credentials
    are configured (see `build_provider`). Fed the same (geometry, week)
    twice, it returns bit-identical `ProviderScene.data` both times --
    that's what keeps the demo and the test suite reproducible.

    A deterministic slice of weeks come back as "no scene" (None) and
    another slice come back cloudy (cloud_pct above the typical 40%
    default threshold), purely as a function of the hash of the inputs.
    That's intentional: the gap-handling UI needs real absent/cloudy
    weeks to render against, not just the happy path.
    """

    def fetch(self, *, geometry: Mapping[str, Any], week: WeekRef) -> ProviderScene | None:
        digest = _demo_digest(geometry, week)
        bucket = digest[0] % 10

        if bucket < _DEMO_ABSENT_BUCKETS:
            return None

        scene_id = f"demo-{digest.hex()[:24]}"
        # Mid-week timestamp (Thursday), derived only from the week --
        # never from wall-clock time -- to keep captured_at deterministic.
        captured_at = datetime.combine(
            week.start + timedelta(days=3), datetime.min.time(), tzinfo=UTC
        )

        if bucket < _DEMO_ABSENT_BUCKETS + _DEMO_CLOUDY_BUCKETS:
            # Still vary the exact cloud figure a little, deterministically.
            cloud_pct = _DEMO_CLOUDY_PCT + (digest[1] % 30)
        else:
            cloud_pct = round((digest[1] % int(_DEMO_CLEAR_MAX_PCT * 10)) / 10, 1)

        return ProviderScene(
            data=b"\x89PNG\r\n\x1a\n" + digest + week.key.encode(),
            scene_id=scene_id,
            captured_at=captured_at,
            sensor=_DEMO_SENSOR,
            resolution_m=_DEMO_RESOLUTION_M,
            cloud_pct=float(cloud_pct),
            source=_DEMO_SOURCE,
            href=f"demo://{scene_id}",
        )


class CopernicusAuthError(Exception):
    """Raised when the CDSE OAuth2 client-credentials token request fails."""


class CopernicusCatalogError(Exception):
    """Raised when the CDSE catalog search request fails."""


class CopernicusDownloadError(Exception):
    """Raised when the clipped raster download request fails."""


class CopernicusSentinel2Provider:
    """Sentinel-2 L2A imagery from the Copernicus Data Space Ecosystem.

    Flow per `fetch` call:

    1. Obtain (and cache) an OAuth2 access token via the client-credentials
       grant against CDSE's Identity service.
    2. Search the Sentinel Hub STAC catalog for sentinel-2-l2a items whose
       datetime falls within the week window and whose geometry intersects
       the parcel footprint; pick the lowest-cloud-cover result.
    3. Request a raster clipped to that footprint from the Process API.

    UNVERIFIED against a live account (no credentials available in this
    environment): exact endpoint URLs, catalog response schema, and
    Process API request shape are implemented per CDSE's published docs
    and exercised only against mocked HTTP in tests. Treat this class as
    "correct per the documented API shape," not "confirmed against the
    live service."

    Raises ValueError at construction time if neither an explicit
    `client_id`/`client_secret` nor the COPERNICUS_CLIENT_ID /
    COPERNICUS_CLIENT_SECRET environment variables are available --
    failing fast beats silently trying to authenticate with an empty
    credential.
    """

    def __init__(
        self,
        *,
        client_id: str | None = None,
        client_secret: str | None = None,
        http_client: httpx.Client | None = None,
        token_url: str = COPERNICUS_TOKEN_URL,
        catalog_url: str = COPERNICUS_CATALOG_URL,
        process_url: str = COPERNICUS_PROCESS_URL,
        timeout: float = 30.0,
    ) -> None:
        self._client_id = client_id or os.environ.get("COPERNICUS_CLIENT_ID")
        self._client_secret = client_secret or os.environ.get("COPERNICUS_CLIENT_SECRET")
        if not self._client_id or not self._client_secret:
            raise ValueError(
                "CopernicusSentinel2Provider requires client_id/client_secret "
                "(or COPERNICUS_CLIENT_ID / COPERNICUS_CLIENT_SECRET env vars)"
            )

        self._http = http_client if http_client is not None else httpx.Client(timeout=timeout)
        self._token_url = token_url
        self._catalog_url = catalog_url
        self._process_url = process_url

        self._token: str | None = None
        self._token_expires_at: float = 0.0

    def close(self) -> None:
        """Release the underlying HTTP connection pool."""
        self._http.close()

    def fetch(self, *, geometry: Mapping[str, Any], week: WeekRef) -> ProviderScene | None:
        token = self._ensure_token()
        item = self._search_best_item(token, geometry, week)
        if item is None:
            return None

        data = self._download_clip(token, geometry, item)
        properties = item.get("properties", {})

        return ProviderScene(
            data=data,
            scene_id=str(item["id"]),
            captured_at=_parse_stac_datetime(properties.get("datetime")),
            sensor="sentinel-2",
            resolution_m=float(properties.get("gsd", 10.0)),
            cloud_pct=float(properties.get("eo:cloud_cover", 0.0)),
            source="copernicus",
            href=_asset_href(item, fallback=self._process_url),
        )

    def _ensure_token(self) -> str:
        now = time.monotonic()
        if self._token is not None and now < self._token_expires_at:
            return self._token

        try:
            response = self._http.post(
                self._token_url,
                data={
                    "grant_type": "client_credentials",
                    "client_id": self._client_id,
                    "client_secret": self._client_secret,
                },
            )
        except httpx.HTTPError as exc:
            raise CopernicusAuthError(f"token request failed: {exc}") from exc

        if response.status_code != httpx.codes.OK:
            raise CopernicusAuthError(
                f"token request failed: HTTP {response.status_code}: {response.text}"
            )

        payload = response.json()
        token = payload.get("access_token")
        if not token:
            raise CopernicusAuthError("token response missing access_token")

        expires_in = float(payload.get("expires_in", 300))
        # Refresh a little early so a token doesn't expire mid-request.
        self._token_expires_at = now + max(expires_in - 30.0, 0.0)
        self._token = token
        return token

    def _search_best_item(
        self, token: str, geometry: Mapping[str, Any], week: WeekRef
    ) -> dict[str, Any] | None:
        body = {
            "collections": ["sentinel-2-l2a"],
            "datetime": f"{week.start.isoformat()}T00:00:00Z/{week.end.isoformat()}T23:59:59Z",
            "intersects": _json_safe(geometry),
            "limit": 20,
        }
        try:
            response = self._http.post(
                self._catalog_url,
                json=body,
                headers={"Authorization": f"Bearer {token}"},
            )
        except httpx.HTTPError as exc:
            raise CopernicusCatalogError(f"catalog search failed: {exc}") from exc

        if response.status_code != httpx.codes.OK:
            raise CopernicusCatalogError(
                f"catalog search failed: HTTP {response.status_code}: {response.text}"
            )

        features: Collection[dict[str, Any]] = response.json().get("features", [])
        if not features:
            return None

        return min(
            features,
            key=lambda feature: float(
                feature.get("properties", {}).get("eo:cloud_cover", 100.0)
            ),
        )

    def _download_clip(
        self, token: str, geometry: Mapping[str, Any], item: dict[str, Any]
    ) -> bytes:
        body = {
            "input": {
                "bounds": {"geometry": _json_safe(geometry)},
                "data": [
                    {
                        "type": "sentinel-2-l2a",
                        "dataFilter": {"ids": [item["id"]]},
                    }
                ],
            },
            "output": {"format": "image/tiff"},
        }
        try:
            response = self._http.post(
                self._process_url,
                json=body,
                headers={"Authorization": f"Bearer {token}"},
            )
        except httpx.HTTPError as exc:
            raise CopernicusDownloadError(f"raster download failed: {exc}") from exc

        if response.status_code != httpx.codes.OK:
            raise CopernicusDownloadError(
                f"raster download failed: HTTP {response.status_code}: {response.text}"
            )

        return response.content


def _parse_stac_datetime(value: str | None) -> datetime:
    """Parse a STAC `datetime` property, defaulting to epoch if absent.

    A missing datetime shouldn't crash the capture -- `capture_week`
    still needs a `captured_at` to register the scene -- but it should
    never be silently mistaken for "now", so it falls back to a fixed,
    obviously-a-placeholder epoch value instead of reading the clock.
    """
    if not value:
        return datetime.fromtimestamp(0, tz=UTC)
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _asset_href(item: Mapping[str, Any], *, fallback: str) -> str:
    assets = item.get("assets", {})
    for candidate in ("data", "visual", "default"):
        asset = assets.get(candidate)
        if isinstance(asset, Mapping) and asset.get("href"):
            return str(asset["href"])
    for asset in assets.values():
        if isinstance(asset, Mapping) and asset.get("href"):
            return str(asset["href"])
    return fallback


def build_provider() -> "DemoImageryProvider | CopernicusSentinel2Provider":
    """Choose an `ImageryProvider` from the environment.

    MAPENCROACH_DEMO=1 forces the deterministic demo provider. Otherwise,
    real Copernicus credentials (COPERNICUS_CLIENT_ID / _SECRET) select
    `CopernicusSentinel2Provider`; if either is missing, this falls back
    to the demo provider rather than constructing a client doomed to fail
    on its first call.
    """
    if os.environ.get("MAPENCROACH_DEMO") == "1":
        return DemoImageryProvider()

    client_id = os.environ.get("COPERNICUS_CLIENT_ID")
    client_secret = os.environ.get("COPERNICUS_CLIENT_SECRET")
    if not client_id or not client_secret:
        return DemoImageryProvider()

    return CopernicusSentinel2Provider(client_id=client_id, client_secret=client_secret)
