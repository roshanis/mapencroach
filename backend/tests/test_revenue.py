import csv

from mapencroach.cadastral.revenue import KhasraLinkResult, RorRecord, link_khasra, load_ror_csv

DEMO_PARCELS = [
    {"id": "parcel-1", "survey_no": "SN-101", "jurisdiction_id": "taluk-a1"},
    {"id": "parcel-2", "survey_no": "SN-102", "jurisdiction_id": "taluk-a1"},
    {"id": "parcel-6", "survey_no": "SN-106", "jurisdiction_id": "taluk-b1"},
]


def _write_csv(tmp_path, header, rows, name="ror.csv"):
    path = tmp_path / name
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(header)
        writer.writerows(rows)
    return path


class TestBatchAcceptance:
    def test_valid_batch_is_accepted_with_correct_records(self, tmp_path):
        path = _write_csv(
            tmp_path,
            ["khasra_no", "village_code", "area_sq_m", "land_class"],
            [
                ["101", "taluk-a1", "450.5", "agricultural"],
                ["102", "taluk-a1", "300", "residential"],
            ],
        )

        result = load_ror_csv(path)

        assert result.status == "accepted"
        assert result.errors == []
        assert len(result.records) == 2
        first = result.records[0]
        assert first.khasra_no == "101"
        assert first.village_code == "taluk-a1"
        assert first.area_sq_m == 450.5
        assert first.land_class == "agricultural"
        assert first.source_row == 2

    def test_optional_columns_may_be_absent(self, tmp_path):
        path = _write_csv(tmp_path, ["khasra_no", "village_code"], [["101", "taluk-a1"]])

        result = load_ror_csv(path)

        assert result.status == "accepted"
        record = result.records[0]
        assert record.area_sq_m is None
        assert record.land_class is None
        assert record.occupant_count == 0

    def test_header_matching_is_case_insensitive(self, tmp_path):
        path = _write_csv(tmp_path, ["Khasra_No", "Village_Code"], [["101", "taluk-a1"]])

        result = load_ror_csv(path)

        assert result.status == "accepted"
        assert result.records[0].khasra_no == "101"

    def test_missing_file_is_rejected(self, tmp_path):
        result = load_ror_csv(tmp_path / "does-not-exist.csv")

        assert result.status == "rejected"
        assert result.records == []
        assert any("not found" in e for e in result.errors)


class TestStructuralErrorsCollectedTogether:
    def test_missing_required_columns_reject_the_batch(self, tmp_path):
        path = _write_csv(tmp_path, ["village_code"], [["taluk-a1"]])

        result = load_ror_csv(path)

        assert result.status == "rejected"
        assert result.records == []
        assert any("khasra_no" in e for e in result.errors)

    def test_all_structural_errors_are_collected_not_just_the_first(self, tmp_path):
        path = _write_csv(
            tmp_path,
            ["khasra_no", "village_code", "area_sq_m"],
            [
                ["", "taluk-a1", "10"],  # empty khasra_no
                ["102", "", "10"],  # empty village_code
                ["103", "taluk-a1", "-5"],  # negative area
            ],
        )

        result = load_ror_csv(path)

        assert result.status == "rejected"
        assert result.records == []
        assert len(result.errors) == 3
        joined = " ".join(result.errors)
        assert "khasra_no is empty" in joined
        assert "village_code is empty" in joined
        assert "negative" in joined

    def test_duplicate_khasra_within_same_village_rejects_batch(self, tmp_path):
        path = _write_csv(
            tmp_path,
            ["khasra_no", "village_code"],
            [
                ["101", "taluk-a1"],
                ["101", "taluk-a1"],
            ],
        )

        result = load_ror_csv(path)

        assert result.status == "rejected"
        assert any("duplicate" in e for e in result.errors)

    def test_same_khasra_in_different_villages_is_accepted(self, tmp_path):
        path = _write_csv(
            tmp_path,
            ["khasra_no", "village_code"],
            [
                ["101", "taluk-a1"],
                ["101", "taluk-b1"],
            ],
        )

        result = load_ror_csv(path)

        assert result.status == "accepted"
        assert len(result.records) == 2
        assert {r.village_code for r in result.records} == {"taluk-a1", "taluk-b1"}


class TestPersonalDataGating:
    def test_occupant_names_are_dropped_by_default(self, tmp_path):
        path = _write_csv(
            tmp_path,
            ["khasra_no", "village_code", "occupant_names"],
            [["101", "taluk-a1", "Ram Singh;Shyam Lal"]],
        )

        result = load_ror_csv(path)

        record = result.records[0]
        assert record.has_recorded_occupants is True
        assert record.occupant_count == 2
        assert record.occupant_names == ()

    def test_occupant_names_are_retained_when_include_personal_is_set(self, tmp_path):
        path = _write_csv(
            tmp_path,
            ["khasra_no", "village_code", "occupant_names"],
            [["101", "taluk-a1", "Ram Singh;Shyam Lal"]],
        )

        result = load_ror_csv(path, include_personal=True)

        record = result.records[0]
        assert record.has_recorded_occupants is True
        assert record.occupant_count == 2
        assert record.occupant_names == ("Ram Singh", "Shyam Lal")

    def test_no_occupants_recorded_when_column_absent_or_blank(self, tmp_path):
        path = _write_csv(
            tmp_path,
            ["khasra_no", "village_code", "occupant_names"],
            [["101", "taluk-a1", ""]],
        )

        result = load_ror_csv(path, include_personal=True)

        record = result.records[0]
        assert record.has_recorded_occupants is False
        assert record.occupant_count == 0
        assert record.occupant_names == ()


class TestKhasraLinkage:
    def test_exact_village_match_yields_high_confidence_alias(self):
        record = RorRecord(
            khasra_no="101",
            village_code="taluk-a1",
            area_sq_m=None,
            land_class=None,
            has_recorded_occupants=False,
            occupant_count=0,
            source_row=2,
        )

        result = link_khasra([record], DEMO_PARCELS, source="Bhulekh RoR demo import")

        assert isinstance(result, KhasraLinkResult)
        assert len(result.aliases) == 1
        parcel_id, alias = result.aliases[0]
        assert parcel_id == "parcel-1"
        assert alias.scheme == "khasra"
        assert alias.value == "101"
        assert alias.source == "Bhulekh RoR demo import"
        assert alias.match_method == "khasra_exact_village_match"
        assert alias.confidence == 0.95
        assert alias.valid_from is None
        assert alias.valid_to is None
        assert result.unmatched == []
        assert result.ambiguous == []

    def test_full_survey_no_string_also_matches(self):
        record = RorRecord(
            khasra_no="SN-101",
            village_code="taluk-a1",
            area_sq_m=None,
            land_class=None,
            has_recorded_occupants=False,
            occupant_count=0,
            source_row=2,
        )

        result = link_khasra([record], DEMO_PARCELS, source="Bhulekh RoR demo import")

        assert len(result.aliases) == 1
        parcel_id, alias = result.aliases[0]
        assert parcel_id == "parcel-1"
        assert alias.match_method == "khasra_exact_village_match"

    def test_khasra_number_matches_but_village_differs_is_lower_confidence(self):
        record = RorRecord(
            khasra_no="101",
            village_code="taluk-b1",
            area_sq_m=None,
            land_class=None,
            has_recorded_occupants=False,
            occupant_count=0,
            source_row=2,
        )

        result = link_khasra([record], DEMO_PARCELS, source="Bhulekh RoR demo import")

        assert len(result.aliases) == 1
        parcel_id, alias = result.aliases[0]
        assert parcel_id == "parcel-1"
        assert alias.match_method == "khasra_number_only"
        assert alias.confidence == 0.6
        assert result.unmatched == []
        assert result.ambiguous == []

    def test_unmatched_khasra_is_reported_not_dropped(self):
        record = RorRecord(
            khasra_no="999",
            village_code="taluk-a1",
            area_sq_m=None,
            land_class=None,
            has_recorded_occupants=False,
            occupant_count=0,
            source_row=2,
        )

        result = link_khasra([record], DEMO_PARCELS, source="Bhulekh RoR demo import")

        assert result.aliases == []
        assert result.unmatched == [record]
        assert result.ambiguous == []

    def test_ambiguous_match_goes_to_ambiguous_never_guessed_into_aliases(self):
        parcels = [
            {"id": "parcel-1", "survey_no": "SN-101", "jurisdiction_id": "taluk-a1"},
            {"id": "parcel-9", "survey_no": "SN-101", "jurisdiction_id": "taluk-a2"},
        ]
        record = RorRecord(
            khasra_no="101",
            village_code="taluk-b1",
            area_sq_m=None,
            land_class=None,
            has_recorded_occupants=False,
            occupant_count=0,
            source_row=2,
        )

        result = link_khasra([record], parcels, source="Bhulekh RoR demo import")

        assert result.aliases == []
        assert result.ambiguous == [record]
        assert result.unmatched == []

    def test_exact_match_wins_even_if_another_parcel_has_a_coincidental_number_only_hit(self):
        parcels = [
            {"id": "parcel-1", "survey_no": "SN-101", "jurisdiction_id": "taluk-a1"},
            {"id": "parcel-9", "survey_no": "SN-101", "jurisdiction_id": "taluk-a2"},
        ]
        record = RorRecord(
            khasra_no="101",
            village_code="taluk-a1",
            area_sq_m=None,
            land_class=None,
            has_recorded_occupants=False,
            occupant_count=0,
            source_row=2,
        )

        result = link_khasra([record], parcels, source="Bhulekh RoR demo import")

        assert len(result.aliases) == 1
        parcel_id, alias = result.aliases[0]
        assert parcel_id == "parcel-1"
        assert alias.match_method == "khasra_exact_village_match"
        assert result.ambiguous == []

    def test_round_trip_from_csv_through_linkage_against_demo_shaped_parcels(self, tmp_path):
        path = _write_csv(
            tmp_path,
            ["khasra_no", "village_code", "area_sq_m", "occupant_names"],
            [
                ["101", "taluk-a1", "500", "Ram Singh"],
                ["106", "taluk-b1", "300", ""],
                ["500", "taluk-a1", "100", ""],
            ],
        )

        import_result = load_ror_csv(path)
        assert import_result.status == "accepted"

        link_result = link_khasra(
            import_result.records, DEMO_PARCELS, source="Bhulekh RoR demo import"
        )

        matched_parcel_ids = {parcel_id for parcel_id, _alias in link_result.aliases}
        assert matched_parcel_ids == {"parcel-1", "parcel-6"}
        assert len(link_result.unmatched) == 1
        assert link_result.unmatched[0].khasra_no == "500"
        assert link_result.ambiguous == []

        # Personal data never reached the linked records.
        for record in import_result.records:
            assert record.occupant_names == ()
