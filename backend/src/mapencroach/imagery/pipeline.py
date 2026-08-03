"""Scene ingestion: hash first, then convert to COG, then catalog (STAC).

Evidence-safe ordering is the whole point: the delivered GeoTIFF and its
sidecar are SHA-256 hashed byte-for-byte *before* any processing, so the
original's integrity is provable independently of anything this pipeline
does afterwards. The Cloud-Optimized GeoTIFF is a serving artifact with
its own hash; the original is what goes to court.
"""

import hashlib
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

import rasterio
from rasterio.warp import transform_bounds
from rio_cogeo.cogeo import cog_translate
from rio_cogeo.profiles import cog_profiles

from mapencroach.imagery.sidecar import SidecarRecord, parse_sidecar

_WGS84 = "EPSG:4326"


@dataclass(frozen=True)
class IngestedScene:
    scene_id: str
    original_sha256: str
    cog_sha256: str
    cog_path: str
    captured_at: datetime
    sensor: str
    resolution_m: float
    cloud_pct: float
    source: str
    stac_item: dict[str, Any]
    sidecar: SidecarRecord | None

    def to_store_dict(self) -> dict[str, Any]:
        """The shape the store persists and GET /scenes serves."""
        return {
            "scene_id": self.scene_id,
            "sha256": self.original_sha256,
            "cog_sha256": self.cog_sha256,
            "captured_at": self.captured_at.isoformat(),
            "sensor": self.sensor,
            "resolution_m": self.resolution_m,
            "cloud_pct": self.cloud_pct,
            "source": self.source,
            "href": self.cog_path,
            "stac_item": self.stac_item,
            "sidecar_sha256": self.sidecar.sha256 if self.sidecar else None,
            "sidecar_raw": self.sidecar.raw if self.sidecar else None,
            "ortho_rmse_m": None,  # measured against GCPs after ortho-QC, not at ingest
        }


def _footprint_wgs84(dataset: rasterio.DatasetReader) -> tuple[list[float], dict[str, Any]]:
    """(bbox, GeoJSON polygon) of the dataset extent in WGS84."""
    if dataset.crs is None:
        raise ValueError("scene has no CRS; refusing to catalog unlocatable imagery")
    left, bottom, right, top = transform_bounds(dataset.crs, _WGS84, *dataset.bounds)
    bbox = [left, bottom, right, top]
    polygon = {
        "type": "Polygon",
        "coordinates": [
            [[left, bottom], [right, bottom], [right, top], [left, top], [left, bottom]]
        ],
    }
    return bbox, polygon


def _build_stac_item(
    *,
    scene_id: str,
    captured_at: datetime,
    sensor: str,
    resolution_m: float,
    cloud_pct: float,
    bbox: list[float],
    geometry: dict[str, Any],
    cog_path: str,
    original_sha256: str,
    cog_sha256: str,
    sidecar: SidecarRecord | None,
) -> dict[str, Any]:
    properties: dict[str, Any] = {
        "datetime": captured_at.isoformat(),
        "eo:cloud_cover": cloud_pct,
        "gsd": resolution_m,
        "platform": sensor,
        "mapencroach:original_sha256": original_sha256,
        "mapencroach:cog_sha256": cog_sha256,
    }
    if sidecar is not None:
        properties["mapencroach:sidecar_sha256"] = sidecar.sha256
        properties["mapencroach:sidecar_format"] = sidecar.format
    assets: dict[str, Any] = {
        "data": {
            "href": cog_path,
            "type": "image/tiff; application=geotiff; profile=cloud-optimized",
            "roles": ["data"],
        }
    }
    return {
        "type": "Feature",
        "stac_version": "1.0.0",
        "id": scene_id,
        "bbox": bbox,
        "geometry": geometry,
        "properties": properties,
        "assets": assets,
    }


def ingest_scene(
    tif_path: str | Path,
    *,
    scene_id: str,
    captured_at: datetime,
    sensor: str,
    resolution_m: float,
    cloud_pct: float,
    source: str,
    output_dir: str | Path,
    sidecar_path: str | Path | None = None,
) -> IngestedScene:
    """Hash the delivered files, convert to COG, and build the STAC item.

    Ordering is deliberate and load-bearing: original + sidecar hashes
    are computed from the delivered bytes before conversion touches
    anything, so the evidentiary anchor exists even if conversion fails
    halfway.
    """
    tif_path = Path(tif_path)
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    original_sha256 = hashlib.sha256(tif_path.read_bytes()).hexdigest()
    sidecar = (
        parse_sidecar(Path(sidecar_path).read_bytes()) if sidecar_path is not None else None
    )

    cog_path = output_dir / f"{scene_id}.tif"
    cog_translate(
        tif_path,
        cog_path,
        cog_profiles.get("deflate"),
        in_memory=True,
        quiet=True,
    )
    cog_sha256 = hashlib.sha256(cog_path.read_bytes()).hexdigest()

    with rasterio.open(cog_path) as dataset:
        bbox, geometry = _footprint_wgs84(dataset)

    stac_item = _build_stac_item(
        scene_id=scene_id,
        captured_at=captured_at,
        sensor=sensor,
        resolution_m=resolution_m,
        cloud_pct=cloud_pct,
        bbox=bbox,
        geometry=geometry,
        cog_path=str(cog_path),
        original_sha256=original_sha256,
        cog_sha256=cog_sha256,
        sidecar=sidecar,
    )
    return IngestedScene(
        scene_id=scene_id,
        original_sha256=original_sha256,
        cog_sha256=cog_sha256,
        cog_path=str(cog_path),
        captured_at=captured_at,
        sensor=sensor,
        resolution_m=resolution_m,
        cloud_pct=cloud_pct,
        source=source,
        stac_item=stac_item,
        sidecar=sidecar,
    )


def register_scene(store: Any, ingested: IngestedScene, *, actor: str) -> dict[str, Any]:
    """Persist an ingested scene through the store and audit the ingestion."""
    scene = ingested.to_store_dict()
    store.save_scene(scene)
    store.record_audit(
        actor=actor,
        action="scene.ingest",
        object_type="imagery_scene",
        object_id=ingested.scene_id,
    )
    return scene
