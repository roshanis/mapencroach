"""Column types shared by the schema.

GeoJSONGeometry keeps one geometry column definition honest on two
backends: PostGIS in production (real `geometry` columns, spatial
indexes possible) and plain SQLite in tests/CI (GeoJSON text). The
Python-side currency is always a GeoJSON mapping — the same shape the
API serves — so the store layer never needs to know which backend it
is talking to.
"""

import json
from typing import Any

from geoalchemy2 import Geometry
from geoalchemy2.shape import from_shape, to_shape
from shapely.geometry import MultiPolygon, mapping, shape
from sqlalchemy import Text
from sqlalchemy.engine import Dialect
from sqlalchemy.types import TypeDecorator


class GeoJSONGeometry(TypeDecorator):
    """A geometry column bound to/from GeoJSON mappings.

    On PostgreSQL the underlying column is a PostGIS ``Geometry``; on
    every other dialect it is ``Text`` holding canonical GeoJSON. A
    Polygon value bound into a MULTIPOLYGON PostGIS column is promoted
    to a single-member MultiPolygon (PostGIS enforces the declared
    type; GeoJSON text does not care).
    """

    impl = Text
    cache_ok = True

    def __init__(self, geometry_type: str = "MULTIPOLYGON", srid: int = 4326) -> None:
        super().__init__()
        self.geometry_type = geometry_type
        self.srid = srid

    def load_dialect_impl(self, dialect: Dialect):
        if dialect.name == "postgresql":
            return dialect.type_descriptor(
                Geometry(geometry_type=self.geometry_type, srid=self.srid)
            )
        return dialect.type_descriptor(Text())

    def process_bind_param(self, value: dict[str, Any] | None, dialect: Dialect):
        if value is None:
            return None
        if dialect.name == "postgresql":
            geom = shape(value)
            if self.geometry_type == "MULTIPOLYGON" and geom.geom_type == "Polygon":
                geom = MultiPolygon([geom])
            return from_shape(geom, srid=self.srid)
        return json.dumps(value)

    def process_result_value(self, value: Any, dialect: Dialect) -> dict[str, Any] | None:
        if value is None:
            return None
        if dialect.name == "postgresql":
            return mapping(to_shape(value))
        return json.loads(value)
