from datetime import date

import pytest

from mapencroach.context.shrug import (
    ShrugImportManifest,
    build_shrug_geographic_link,
    import_shrug_observations,
)
from mapencroach.domain.geography import (
    CONTEXT_DISCLAIMER,
    ContextObservation,
    ContextSource,
    GeographicLink,
    LineageRelation,
    ParcelAlias,
    ParcelContext,
    ParcelLineageEdge,
)


def source() -> ContextSource:
    return ContextSource(
        id="shrug-viirs-2.1",
        provider="Development Data Lab",
        dataset="VIIRS Night Lights",
        version="SHRUG 2.1",
        vintage="2012-2021",
        license="ODbL — review required before redistribution",
        source_url="https://docs.devdatalab.org/",
        resolution="SHRUG village/town unit",
        limitations=("Contextual aggregate; not a parcel measurement.",),
        is_demo=False,
    )


class TestGeographicLineage:
    def test_aliases_keep_source_validity_and_match_confidence(self):
        alias = ParcelAlias(
            scheme="ULPIN",
            value="UK0000000001HR",
            source="State cadastral register",
            valid_from=date(2024, 1, 1),
            valid_to=None,
            match_method="authoritative_identifier",
            confidence=1.0,
        )

        assert alias.valid_from == date(2024, 1, 1)
        assert alias.confidence == 1.0

    def test_confidence_must_be_between_zero_and_one(self):
        with pytest.raises(ValueError, match="confidence"):
            ParcelAlias(
                scheme="survey_no",
                value="SN-101",
                source="Demo register",
                valid_from=None,
                valid_to=None,
                match_method="manual",
                confidence=1.1,
            )

    def test_alias_validity_window_cannot_run_backwards(self):
        with pytest.raises(ValueError, match="valid_to"):
            ParcelAlias(
                scheme="survey_no",
                value="SN-101",
                source="Demo register",
                valid_from=date(2025, 1, 1),
                valid_to=date(2024, 1, 1),
                match_method="manual",
                confidence=0.9,
            )

    def test_lineage_cannot_link_a_parcel_to_itself(self):
        with pytest.raises(ValueError, match="itself"):
            ParcelLineageEdge(
                related_parcel_id="parcel-1",
                relation=LineageRelation.SPLIT_FROM,
                effective_on=date(2025, 1, 1),
                source="Cadastral mutation register",
                confidence=0.9,
                current_parcel_id="parcel-1",
            )


class TestParcelContext:
    def test_context_serialization_preserves_the_non_evidence_boundary(self):
        context = ParcelContext(
            parcel_id="parcel-1",
            canonical_id="parcel-1",
            aliases=(),
            lineage=(
                ParcelLineageEdge(
                    related_parcel_id="parcel-legacy-1",
                    relation=LineageRelation.RENUMBERED_FROM,
                    effective_on=date(2024, 4, 1),
                    source="Cadastral mutation register",
                    confidence=0.92,
                    current_parcel_id="parcel-1",
                ),
            ),
            geographic_links=(
                GeographicLink(
                    scheme="SHRUG_SHRID2",
                    geographic_unit_id="11-001-00001",
                    name="Haridwar context unit",
                    level="village_or_town",
                    match_method="centroid_within",
                    confidence=0.82,
                    source_id="shrug-viirs-2.1",
                ),
            ),
            observations=(
                ContextObservation(
                    key="night_light_mean",
                    label="Night-light intensity",
                    value=4.2,
                    unit="annual mean radiance",
                    period="2021",
                    trend="rising",
                    source_id="shrug-viirs-2.1",
                ),
            ),
            sources=(source(),),
        )

        payload = context.to_dict()

        assert payload["classification"] == "context_only"
        assert payload["disclaimer"] == CONTEXT_DISCLAIMER
        assert payload["lineage"][0]["effective_on"] == "2024-04-01"
        assert payload["observations"][0]["context_only"] is True
        assert payload["sources"][0]["limitations"]

    def test_context_only_flags_cannot_be_disabled(self):
        with pytest.raises(ValueError, match="context-only"):
            GeographicLink(
                scheme="SHRUG_SHRID2",
                geographic_unit_id="11-001-00001",
                name="Context unit",
                level="village_or_town",
                match_method="centroid_within",
                confidence=0.8,
                source_id="source-1",
                context_only=False,
            )
        with pytest.raises(ValueError, match="context-only"):
            ContextObservation(
                key="night_light",
                label="Night light",
                value=1.0,
                unit="index",
                period="2021",
                trend=None,
                source_id="source-1",
                context_only=False,
            )

    def test_context_classification_cannot_be_promoted_to_evidence(self):
        with pytest.raises(ValueError, match="context-only"):
            ParcelContext(
                parcel_id="parcel-1",
                canonical_id="parcel-1",
                aliases=(),
                lineage=(),
                geographic_links=(),
                observations=(),
                sources=(),
                classification="evidence",
            )

    def test_observations_must_reference_a_declared_source(self):
        with pytest.raises(ValueError, match="undeclared source"):
            ParcelContext(
                parcel_id="parcel-1",
                canonical_id="parcel-1",
                aliases=(),
                lineage=(),
                geographic_links=(),
                observations=(
                    ContextObservation(
                        key="tree_cover",
                        label="Tree cover",
                        value=31.0,
                        unit="percent",
                        period="2020",
                        trend="falling",
                        source_id="missing-source",
                    ),
                ),
                sources=(),
            )


class TestShrugImportBoundary:
    def test_official_rows_require_an_explicit_redistribution_review(self):
        manifest = ShrugImportManifest(
            source_id="shrug-viirs-2.1",
            module="VIIRS Night Lights",
            version="SHRUG 2.1",
            vintage="2012-2021",
            license="ODbL",
            source_url="https://docs.devdatalab.org/",
            resolution="SHRUG village/town unit",
            limitations=("Not parcel-level evidence.",),
            redistribution_reviewed=False,
            is_demo=False,
        )

        with pytest.raises(ValueError, match="redistribution review"):
            import_shrug_observations(
                parcel_id="parcel-1",
                geographic_unit_id="11-001-00001",
                rows=[],
                indicator_key="viirs_annual_mean",
                label="Night-light intensity",
                unit="annual mean radiance",
                period_field="year",
                manifest=manifest,
            )

        with pytest.raises(ValueError, match="redistribution review"):
            build_shrug_geographic_link(
                row={"shrid2": "11-001-00001"},
                match_method="centroid_within",
                confidence=0.8,
                manifest=manifest,
            )

    def test_rows_are_scoped_to_the_linked_shrid_and_keep_provenance(self):
        manifest = ShrugImportManifest(
            source_id="shrug-viirs-2.1",
            module="VIIRS Night Lights",
            version="SHRUG 2.1",
            vintage="2012-2021",
            license="ODbL",
            source_url="https://docs.devdatalab.org/",
            resolution="SHRUG village/town unit",
            limitations=("Not parcel-level evidence.",),
            redistribution_reviewed=True,
            is_demo=False,
        )
        rows = [
            {"shrid2": "11-001-00001", "year": 2020, "viirs_annual_mean": 4.2},
            {"shrid2": "11-001-00002", "year": 2020, "viirs_annual_mean": 99.0},
        ]

        imported = import_shrug_observations(
            parcel_id="parcel-1",
            geographic_unit_id="11-001-00001",
            rows=rows,
            indicator_key="viirs_annual_mean",
            label="Night-light intensity",
            unit="annual mean radiance",
            period_field="year",
            manifest=manifest,
        )

        assert imported.source.provider == "Development Data Lab"
        assert len(imported.observations) == 1
        assert imported.observations[0].value == 4.2
        assert imported.observations[0].context_only is True

    def test_geographic_link_requires_shrid2_and_records_match_quality(self):
        manifest = ShrugImportManifest.demo(
            source_id="shrug-compatible-demo",
            module="Core keys",
            version="SHRUG-compatible demo",
        )

        link = build_shrug_geographic_link(
            row={"shrid2": "demo-001", "village_name": "Haridwar context unit"},
            match_method="centroid_within",
            confidence=0.78,
            manifest=manifest,
        )

        assert link.scheme == "SHRUG_SHRID2"
        assert link.geographic_unit_id == "demo-001"
        assert link.confidence == 0.78

        with pytest.raises(ValueError, match="shrid2"):
            build_shrug_geographic_link(
                row={"village_name": "Missing identifier"},
                match_method="centroid_within",
                confidence=0.78,
                manifest=manifest,
            )
