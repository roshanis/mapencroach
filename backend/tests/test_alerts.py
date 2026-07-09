import pytest

from mapencroach.domain.alerts import (
    LAND_CATEGORY_WEIGHTS,
    AlertTier,
    persistence_check,
    severity_score,
)


class TestAlertTier:
    def test_has_four_tiers(self):
        assert {t.value for t in AlertTier} == {"GREEN", "AMBER", "RED", "LEGACY"}


class TestLandCategoryWeights:
    def test_weight_ordering(self):
        ordered = [
            "waterbody",
            "forest",
            "irrigation",
            "municipal",
            "housing",
            "industrial",
            "revenue",
        ]
        weights = [LAND_CATEGORY_WEIGHTS[cat] for cat in ordered]
        assert weights == sorted(weights, reverse=True)

    def test_exact_weight_values(self):
        assert LAND_CATEGORY_WEIGHTS == {
            "waterbody": 1.0,
            "forest": 0.9,
            "irrigation": 0.8,
            "municipal": 0.7,
            "housing": 0.6,
            "industrial": 0.5,
            "revenue": 0.4,
        }


class TestSeverityScore:
    def test_full_hectare_waterbody_grade_a_not_repeat(self):
        # area_factor=1.0, weight=1.0, grade=1.0, no repeat bonus
        # 1.0 * 1.0 * 1.0 * 100 = 100.0
        assert severity_score(10_000, "waterbody", "A", repeat_offender=False) == 100.0

    def test_half_hectare_forest_grade_b(self):
        # area_factor = 5000/10000 = 0.5, weight=0.9, grade=0.8
        # 0.5 * 0.9 * 0.8 * 100 = 36.0
        assert severity_score(5_000, "forest", "B", repeat_offender=False) == 36.0

    def test_quarter_hectare_revenue_grade_c(self):
        # area_factor = 2500/10000 = 0.25, weight=0.4, grade=0.5
        # 0.25 * 0.4 * 0.5 * 100 = 5.0
        assert severity_score(2_500, "revenue", "C", repeat_offender=False) == 5.0

    def test_repeat_offender_adds_twenty_percent(self):
        # base = 0.5 * 0.9 * 0.8 * 100 = 36.0; *1.2 = 43.2
        assert severity_score(5_000, "forest", "B", repeat_offender=True) == 43.2

    def test_area_beyond_one_hectare_is_capped_at_area_factor_one(self):
        # 20_000 m2 -> area_factor still 1.0, same as 10_000 m2
        assert severity_score(20_000, "waterbody", "A", False) == severity_score(
            10_000, "waterbody", "A", False
        )

    def test_zero_area_gives_zero_score(self):
        assert severity_score(0, "waterbody", "A", repeat_offender=False) == 0.0

    def test_zero_area_repeat_offender_still_zero(self):
        assert severity_score(0, "waterbody", "A", repeat_offender=True) == 0.0

    def test_score_is_clamped_to_100_even_with_repeat_bonus(self):
        # base 100.0 * 1.2 would be 120 -> clamp to 100.0
        assert severity_score(10_000, "waterbody", "A", repeat_offender=True) == 100.0

    def test_score_rounded_to_one_decimal(self):
        # area_factor = 3333/10000 = 0.3333, weight=0.6 (housing), grade B=0.8
        # 0.3333 * 0.6 * 0.8 * 100 = 15.9984 -> rounds to 16.0
        result = severity_score(3_333, "housing", "B", repeat_offender=False)
        assert result == round(result, 1)
        assert result == 16.0

    def test_unknown_land_category_raises_value_error(self):
        with pytest.raises(ValueError, match="land_category"):
            severity_score(1_000, "swampland", "A", repeat_offender=False)

    def test_unknown_boundary_grade_raises_value_error(self):
        with pytest.raises(ValueError, match="boundary_grade"):
            severity_score(1_000, "forest", "Z", repeat_offender=False)

    def test_result_within_bounds(self):
        result = severity_score(50_000, "waterbody", "A", repeat_offender=True)
        assert 0.0 <= result <= 100.0


class TestPersistenceCheck:
    def test_one_observation_is_insufficient_with_default_required(self):
        assert persistence_check(1) is False

    def test_two_observations_meets_default_required(self):
        assert persistence_check(2) is True

    def test_zero_observations_is_insufficient(self):
        assert persistence_check(0) is False

    def test_more_than_required_still_true(self):
        assert persistence_check(5) is True

    def test_custom_required_boundary_below(self):
        assert persistence_check(3, required=4) is False

    def test_custom_required_boundary_at(self):
        assert persistence_check(4, required=4) is True

    def test_custom_required_of_one(self):
        assert persistence_check(1, required=1) is True
