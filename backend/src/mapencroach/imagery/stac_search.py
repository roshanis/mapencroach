"""Sentinel-2 scene discovery via public STAC search APIs.

Discovery and ingestion are deliberately separate. This module only
*finds* candidate scenes — metadata and asset hrefs from a STAC catalog
(default: Element 84 Earth Search over the AWS Sentinel-2 open-data
archive). Nothing enters the SceneRegistry until actual bytes have been
downloaded and hashed, because hash-on-ingest is the evidence-integrity
anchor the audit chain relies on. `ingest_candidate` is the bridge: it
registers downloaded bytes under the candidate's metadata and preserves
the catalog's own STAC item as provenance instead of synthesizing one.
"""

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import httpx

from mapencroach.imagery.registry import SceneRecord, SceneRegistry

EARTH_SEARCH_URL = "https://earth-search.aws.element84.com/v1/search"
SENTINEL2_COLLECTION = "sentinel-2-l2a"

# Item-level gsd is not guaranteed on every catalog; Sentinel-2 visual
# bands are 10 m, which is what the change-detection pipeline consumes.
_SENTINEL2_DEFAULT_GSD_M = 10.0

Bbox = tuple[float, float, float, float]


class StacSearchError(Exception):
    """Raised when the upstream STAC catalog cannot be queried or parsed."""


@dataclass(frozen=True)
class SceneCandidate:
    """A scene discovered in a STAC catalog, not yet ingested."""

    scene_id: str
    captured_at: datetime
    cloud_pct: float
    resolution_m: float
    sensor: str
    source: str
    thumbnail_href: str | None
    visual_href: str | None
    stac_item: dict[str, Any]

    def to_api_dict(self) -> dict[str, Any]:
        return {
            "scene_id": self.scene_id,
            "captured_at": self.captured_at.isoformat(),
            "cloud_pct": self.cloud_pct,
            "resolution_m": self.resolution_m,
            "sensor": self.sensor,
            "source": self.source,
            "thumbnail_href": self.thumbnail_href,
            "visual_href": self.visual_href,
        }


def geometry_bbox(geometry: dict[str, Any], buffer_deg: float = 0.0) -> Bbox:
    """Lon/lat bbox of a GeoJSON geometry, optionally buffered outward."""
    lons: list[float] = []
    lats: list[float] = []

    def walk(coords: Any) -> None:
        if isinstance(coords[0], (int, float)):
            lons.append(float(coords[0]))
            lats.append(float(coords[1]))
        else:
            for part in coords:
                walk(part)

    coordinates = geometry.get("coordinates")
    if not coordinates:
        raise ValueError("geometry has no coordinates")
    walk(coordinates)
    return (
        min(lons) - buffer_deg,
        min(lats) - buffer_deg,
        max(lons) + buffer_deg,
        max(lats) + buffer_deg,
    )


def build_search_payload(
    bbox: Bbox,
    *,
    start: datetime,
    end: datetime,
    max_cloud_pct: float | None,
    limit: int,
    collection: str = SENTINEL2_COLLECTION,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "collections": [collection],
        "bbox": list(bbox),
        "datetime": f"{_utc_iso(start)}/{_utc_iso(end)}",
        "limit": limit,
        "sortby": [{"field": "properties.datetime", "direction": "desc"}],
    }
    if max_cloud_pct is not None:
        payload["query"] = {"eo:cloud_cover": {"lt": max_cloud_pct}}
    return payload


def _utc_iso(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _asset_href(assets: dict[str, Any], key: str) -> str | None:
    asset = assets.get(key)
    if isinstance(asset, dict):
        href = asset.get("href")
        if isinstance(href, str):
            return href
    return None


def parse_items(features: list[dict[str, Any]], *, source: str) -> list[SceneCandidate]:
    """Map STAC features to candidates, skipping malformed entries.

    A public catalog is external input: one bad feature must not take
    down the whole search result.
    """
    candidates: list[SceneCandidate] = []
    for feature in features:
        scene_id = feature.get("id")
        properties = feature.get("properties") or {}
        raw_datetime = properties.get("datetime")
        if not isinstance(scene_id, str) or not isinstance(raw_datetime, str):
            continue
        try:
            captured_at = datetime.fromisoformat(raw_datetime)
        except ValueError:
            continue
        assets = feature.get("assets") or {}
        gsd = properties.get("gsd")
        candidates.append(
            SceneCandidate(
                scene_id=scene_id,
                captured_at=captured_at,
                cloud_pct=float(properties.get("eo:cloud_cover", 0.0)),
                resolution_m=float(gsd) if gsd is not None else _SENTINEL2_DEFAULT_GSD_M,
                sensor=str(properties.get("platform", "sentinel-2")),
                source=source,
                thumbnail_href=_asset_href(assets, "thumbnail"),
                visual_href=_asset_href(assets, "visual"),
                stac_item=feature,
            )
        )
    return candidates


class StacClient:
    """Thin search client for a STAC API `/search` endpoint."""

    def __init__(
        self,
        url: str = EARTH_SEARCH_URL,
        *,
        timeout_s: float = 20.0,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self.url = url
        self._client = httpx.Client(timeout=timeout_s, transport=transport)

    def search(
        self,
        bbox: Bbox,
        *,
        start: datetime,
        end: datetime,
        max_cloud_pct: float | None = None,
        limit: int = 12,
    ) -> list[SceneCandidate]:
        payload = build_search_payload(
            bbox, start=start, end=end, max_cloud_pct=max_cloud_pct, limit=limit
        )
        try:
            response = self._client.post(self.url, json=payload)
            response.raise_for_status()
            body = response.json()
        except httpx.HTTPError as exc:
            raise StacSearchError(f"STAC search failed: {exc}") from exc
        except ValueError as exc:
            raise StacSearchError("STAC search returned invalid JSON") from exc

        features = body.get("features")
        if not isinstance(features, list):
            raise StacSearchError("STAC response has no 'features' list")
        return parse_items(features, source=self.url)


def ingest_candidate(
    registry: SceneRegistry, candidate: SceneCandidate, data: bytes
) -> SceneRecord:
    """Register downloaded scene bytes under the candidate's catalog metadata."""
    return registry.register(
        data,
        scene_id=candidate.scene_id,
        captured_at=candidate.captured_at,
        sensor=candidate.sensor,
        resolution_m=candidate.resolution_m,
        cloud_pct=candidate.cloud_pct,
        source=candidate.source,
        href=candidate.visual_href or "",
        stac_item=candidate.stac_item,
    )
