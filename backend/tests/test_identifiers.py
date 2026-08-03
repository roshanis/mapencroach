"""ULPIN validation, the DIGIPIN codec, and identifier surfacing on parcels."""

from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from mapencroach.api.app import create_app
from mapencroach.api.auth import Role, create_token
from mapencroach.api.store import Store
from mapencroach.domain.identifiers import (
    decode_digipin,
    encode_digipin,
    identifier_block,
    is_valid_ulpin,
    validate_ulpin,
)

SECRET = "dev-secret-do-not-deploy"  # noqa: S105 - matches auth.py dev default


class TestUlpin:
    def test_valid_ulpin_passes(self):
        assert validate_ulpin("UK0000000001HR") == "UK0000000001HR"
        assert is_valid_ulpin("UK0000000001HR")

    @pytest.mark.parametrize(
        "bad", ["", "SHORT", "uk0000000001hr", "UK-000000001HR", "UK0000000001HRX", None]
    )
    def test_invalid_ulpins_fail(self, bad):
        assert not is_valid_ulpin(bad)

    def test_validate_raises_with_reason(self):
        with pytest.raises(ValueError, match="14 uppercase"):
            validate_ulpin("nope")


class TestDigipin:
    def test_india_post_published_example(self):
        # Dak Bhawan, New Delhi — the Department of Posts' own sample.
        assert encode_digipin(28.622788, 77.213033) == "39J-49L-L8T4"

    def test_round_trip_is_sub_cell_accurate(self):
        code = encode_digipin(29.938, 78.145)
        lat, lon = decode_digipin(code)
        # level-10 cells are ~3.8m; the center must be within half a cell.
        assert abs(lat - 29.938) * 111_000 < 2.5
        assert abs(lon - 78.145) * 96_000 < 2.5

    def test_format_is_3_3_4_hyphenated(self):
        code = encode_digipin(29.938, 78.145)
        parts = code.split("-")
        assert [len(p) for p in parts] == [3, 3, 4]

    def test_out_of_bounds_is_refused(self):
        with pytest.raises(ValueError, match="bounding box"):
            encode_digipin(51.5, -0.12)  # London is not in India

    def test_decode_rejects_garbage(self):
        with pytest.raises(ValueError, match="invalid DIGIPIN"):
            decode_digipin("39J-49L-L8TZ")  # Z is not in the symbol set
        with pytest.raises(ValueError, match="invalid DIGIPIN"):
            decode_digipin("39J-49L")


class TestIdentifierBlock:
    PARCEL = {
        "id": "parcel-1",
        "survey_no": "SN-101",
        "ulpin": "UK0000000001HR",
        "geometry": {
            "type": "Polygon",
            "coordinates": [
                [
                    [78.1445, 29.9375],
                    [78.1455, 29.9375],
                    [78.1455, 29.9385],
                    [78.1445, 29.9385],
                    [78.1445, 29.9375],
                ]
            ],
        },
    }

    def test_ulpin_is_the_official_identifier_when_valid(self):
        block = identifier_block(self.PARCEL)
        assert block["official_identifier"] == {
            "scheme": "ULPIN",
            "value": "UK0000000001HR",
        }
        assert block["digipin"] is not None
        assert "legal authority" in block["authority_note"]

    def test_survey_no_is_the_fallback_citation(self):
        parcel = {**self.PARCEL, "ulpin": "not-a-ulpin"}
        block = identifier_block(parcel)
        assert block["official_identifier"] == {"scheme": "survey_no", "value": "SN-101"}
        assert block["ulpin"] is None

    def test_digipin_matches_parcel_location(self):
        block = identifier_block(self.PARCEL)
        lat, lon = decode_digipin(block["digipin"])
        assert lat == pytest.approx(29.938, abs=0.001)
        assert lon == pytest.approx(78.145, abs=0.001)


class TestParcelFeatureIdentifiers:
    def test_api_features_carry_official_identifier_and_digipin(self):
        store = Store.seed_demo()
        client = TestClient(create_app(store))
        token = create_token(
            sub="v",
            role=Role.VIEWER,
            jurisdiction_id="state",
            secret=SECRET,
            expires_at=datetime.now(UTC) + timedelta(hours=1),
        )
        feature = client.get(
            "/parcels/parcel-1", headers={"Authorization": f"Bearer {token}"}
        ).json()
        props = feature["properties"]
        assert props["official_identifier"]["scheme"] == "ULPIN"
        assert props["official_identifier"]["value"] == props["ulpin"]
        assert props["digipin"].count("-") == 2