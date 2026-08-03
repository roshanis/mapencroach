"""GIS layer registry: line/polygon ingestion, store round-trip, surveys API."""

from datetime import UTC, datetime, timedelta

import geopandas as gpd
import pytest
from fastapi.testclient import TestClient
from shapely.geometry import LineString, Polygon
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool

from mapencroach.api.app import create_app
from mapencroach.api.auth import Role, create_token
from mapencroach.api.store import Store
from mapencroach.cadastral.layers import load_layer
from mapencroach.db.store import DatabaseStore, init_db, seed_demo_database

SECRET = "dev-secret-do-not-deploy"  # noqa: S105 - matches auth.py dev default


def write_layer(path, geometries, ids, crs="EPSG:4326", **columns):
    gdf = gpd.GeoDataFrame({"fid": ids, **columns, "geometry": geometries}, crs=crs)
    gdf.to_file(path, driver="GeoJSON")
    return path


def square(x, y, size=0.001):
    return Polygon([(x, y), (x + size, y), (x + size, y + size), (x, y + size)])


class TestLineIngestion:
    def test_clean_road_centerlines_are_accepted(self, tmp_path):
        path = write_layer(
            tmp_path / "roads.geojson",
            [LineString([(78.1, 29.9), (78.2, 29.95)]), LineString([(78.15, 29.9), (78.15, 30.0)])],
            ids=["NH-334", "SH-59"],
            row_width_m=[45.0, 24.0],
        )
        result = load_layer(path, kind="road", id_column="fid")
        assert result.status == "accepted"
        assert len(result.features) == 2
        assert result.features[0].attributes["row_width_m"] == 45.0
        assert result.features[0].geometry["type"] == "LineString"

    def test_self_intersecting_line_quarantines_the_batch(self, tmp_path):
        bowtie = LineString([(0, 0), (1, 1), (1, 0), (0, 1)])
        path = write_layer(
            tmp_path / "bad.geojson",
            [bowtie, LineString([(2, 2), (3, 3)])],
            ids=["r1", "r2"],
        )
        result = load_layer(path, kind="road", id_column="fid")
        assert result.status == "quarantined"
        assert any(i.kind == "self_intersection" for i in result.report.issues)

    def test_duplicate_lines_warn_but_do_not_block(self, tmp_path):
        line = LineString([(78.1, 29.9), (78.2, 29.9)])
        path = write_layer(tmp_path / "dup.geojson", [line, line], ids=["r1", "r2"])
        result = load_layer(path, kind="road", id_column="fid")
        assert result.status == "accepted"
        assert any(i.kind == "duplicate" for i in result.report.issues)

    def test_polygons_in_a_road_layer_are_a_schema_error(self, tmp_path):
        path = write_layer(
            tmp_path / "wrong.geojson", [square(78.1, 29.9)], ids=["r1"]
        )
        result = load_layer(path, kind="road", id_column="fid")
        assert result.status == "rejected"
        assert "requires linear geometry" in result.errors[0]

    def test_lines_in_a_green_belt_layer_are_a_schema_error(self, tmp_path):
        path = write_layer(
            tmp_path / "wrong2.geojson",
            [LineString([(78.1, 29.9), (78.2, 29.9)])],
            ids=["g1"],
        )
        result = load_layer(path, kind="green_belt", id_column="fid")
        assert result.status == "rejected"
        assert "requires polygonal geometry" in result.errors[0]

    def test_unknown_kind_is_rejected(self, tmp_path):
        path = write_layer(tmp_path / "x.geojson", [square(0, 0)], ids=["a"])
        assert load_layer(path, kind="mystery", id_column="fid").status == "rejected"


class TestPolygonLayerIngestion:
    def test_zoning_layer_accepted_with_attributes(self, tmp_path):
        path = write_layer(
            tmp_path / "plu.geojson",
            [square(78.10, 29.90), square(78.102, 29.90)],
            ids=["z1", "z2"],
            land_use=["residential", "commercial"],
        )
        result = load_layer(path, kind="plu", id_column="fid")
        assert result.status == "accepted"
        assert result.features[0].attributes["land_use"] == "residential"


def _stores():
    memory = Store.seed_demo()
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    init_db(engine)
    seed_demo_database(engine)
    return {"memory": memory, "database": DatabaseStore(engine)}


@pytest.fixture(params=["memory", "database"])
def store(request):
    return _stores()[request.param]


class TestLayerStore:
    def test_layer_round_trips_with_features(self, store):
        meta = {
            "kind": "green_belt",
            "name": "HRDA Green Belt 2021",
            "source": "HRDA Master Plan cell",
            "version": "2021-rev2",
        }
        features = [
            {
                "source_feature_id": "gb-1",
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [
                        [[78.1, 29.9], [78.11, 29.9], [78.11, 29.91], [78.1, 29.91], [78.1, 29.9]]
                    ],
                },
                "attributes": {"designation": "riverfront buffer"},
            }
        ]
        saved = store.save_layer(meta, features)
        assert saved["feature_count"] == 1
        assert store.gis_layers[saved["id"]]["kind"] == "green_belt"

        loaded = store.layer_features("green_belt")
        assert len(loaded) == 1
        assert loaded[0]["attributes"]["designation"] == "riverfront buffer"
        assert loaded[0]["geometry"]["type"] == "Polygon"
        assert store.layer_features("road") == []


class TestSurveysApi:
    @pytest.fixture
    def client(self, store) -> TestClient:
        return TestClient(create_app(store))

    def _headers(self, role: Role, jurisdiction: str = "state") -> dict[str, str]:
        token = create_token(
            sub=f"{role.value}-1",
            role=role,
            jurisdiction_id=jurisdiction,
            secret=SECRET,
            expires_at=datetime.now(UTC) + timedelta(hours=1),
        )
        return {"Authorization": f"Bearer {token}"}

    SURVEY = {
        "survey_ref": "SRV-2026-101",
        "method": "DGPS",
        "accuracy_m": 0.05,
        "surveyed_on": "2026-07-20",
        "resulting_grade": "A",
    }

    def test_dgps_survey_promotes_boundary_grade(self, client, store):
        # parcel-3 is grade C (Rajaji forest fringe).
        resp = client.post(
            "/parcels/parcel-3/surveys",
            json=self.SURVEY,
            headers=self._headers(Role.SURVEY_OFFICER),
        )
        assert resp.status_code == 201
        assert resp.json()["properties"]["boundary_grade"] == "A"
        assert store.parcels["parcel-3"]["boundary_grade"] == "A"
        surveys = list(store.surveys)
        assert surveys[-1]["survey_ref"] == "SRV-2026-101"
        assert store.audit_chain[-1].payload["action"] == "parcel.survey.upload"

    def test_downgrade_is_refused(self, client, store):
        # parcel-1 is already grade A; a C-grade survey result is a data
        # error, not a permitted regression.
        resp = client.post(
            "/parcels/parcel-1/surveys",
            json={**self.SURVEY, "resulting_grade": "C"},
            headers=self._headers(Role.SURVEY_OFFICER),
        )
        assert resp.status_code == 409
        assert store.parcels["parcel-1"]["boundary_grade"] == "A"

    def test_case_officer_cannot_upload_surveys(self, client):
        resp = client.post(
            "/parcels/parcel-3/surveys",
            json=self.SURVEY,
            headers=self._headers(Role.CASE_OFFICER),
        )
        assert resp.status_code == 403

    def test_out_of_scope_parcel_is_404(self, client):
        # dist-b surveyor cannot even confirm a dist-a parcel exists.
        resp = client.post(
            "/parcels/parcel-3/surveys",  # taluk-a2, dist-a
            json=self.SURVEY,
            headers=self._headers(Role.SURVEY_OFFICER, jurisdiction="dist-b"),
        )
        assert resp.status_code == 404

    def test_unknown_method_is_422(self, client):
        resp = client.post(
            "/parcels/parcel-3/surveys",
            json={**self.SURVEY, "method": "guesswork"},
            headers=self._headers(Role.SURVEY_OFFICER),
        )
        assert resp.status_code == 422


class TestLayersApi:
    def test_listing_requires_data_admin_and_hides_features(self, store):
        store.save_layer(
            {"kind": "road", "name": "Roads", "source": "PWD", "version": "v1"},
            [
                {
                    "source_feature_id": "r1",
                    "geometry": {"type": "LineString", "coordinates": [[78.1, 29.9], [78.2, 29.9]]},
                    "attributes": {},
                }
            ],
        )
        client = TestClient(create_app(store))
        token = create_token(
            sub="admin",
            role=Role.DATA_ADMIN,
            jurisdiction_id="state",
            secret=SECRET,
            expires_at=datetime.now(UTC) + timedelta(hours=1),
        )
        body = client.get("/layers", headers={"Authorization": f"Bearer {token}"}).json()
        assert body[-1]["kind"] == "road"
        assert body[-1]["feature_count"] == 1
        assert "features" not in body[-1]

        viewer_token = create_token(
            sub="v",
            role=Role.VIEWER,
            jurisdiction_id="state",
            secret=SECRET,
            expires_at=datetime.now(UTC) + timedelta(hours=1),
        )
        assert (
            client.get("/layers", headers={"Authorization": f"Bearer {viewer_token}"}).status_code
            == 403
        )