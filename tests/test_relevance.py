"""Testes do cálculo de relevância."""

from __future__ import annotations

import math

import pytest

from hashpanel.errors import DataProcessingError
from hashpanel.services.relevance import RelevanceCalculator
from tests.conftest import make_toot


def test_score_increases_with_engagement() -> None:
    """Posts com mais engajamento pontuam mais."""
    calculator = RelevanceCalculator()

    low = calculator.calculate_relevance(make_toot(favorites=1, followers=10))
    high = calculator.calculate_relevance(make_toot(favorites=100, followers=1000))

    assert high["relevanceScore"] > low["relevanceScore"]


def test_score_is_bounded_to_100() -> None:
    """Mesmo com números absurdos, o score fica entre 0 e 100."""
    calculator = RelevanceCalculator()
    result = calculator.calculate_relevance(
        make_toot(favorites=10_000_000, boosts=10_000_000, followers=10_000_000, replies=10_000_000)
    )

    assert 0 <= result["relevanceScore"] <= 100


def test_zero_metrics_gives_zero() -> None:
    """Sem engajamento o score é zero."""
    calculator = RelevanceCalculator()
    result = calculator.calculate_relevance(make_toot())

    assert result["relevanceScore"] == 0
    assert result["relevanceScoreRaw"] == 0


def test_normalization_matches_formula() -> None:
    """A normalização segue 100 * (1 - exp(-raw / 2.5))."""
    calculator = RelevanceCalculator()
    metrics = {"favorites": 100, "boosts": 50, "followers": 200, "replies": 10}
    raw = calculator.calculate_weighted_score(metrics)

    expected = math.floor(100 * (1 - math.exp(-raw / 2.5)) * 10 + 0.5) / 10

    assert calculator.normalize_score(raw) == expected


def test_missing_toot_fields_are_rejected() -> None:
    """Posts sem id ou conta são rejeitados."""
    calculator = RelevanceCalculator()

    with pytest.raises(DataProcessingError):
        calculator.calculate_relevance({"account": {"id": "1", "username": "x"}})

    with pytest.raises(DataProcessingError):
        calculator.calculate_relevance({"id": "1"})


def test_negative_counts_are_rejected() -> None:
    """Contadores negativos invalidam o post."""
    calculator = RelevanceCalculator()

    with pytest.raises(DataProcessingError):
        calculator.calculate_relevance(make_toot(favorites=-1))


def test_weights_must_sum_to_one() -> None:
    """Pesos que não somam 1 são recusados."""
    with pytest.raises(DataProcessingError):
        RelevanceCalculator({"favorites": 0.5, "boosts": 0.5, "followers": 0.5, "replies": 0.5})


def test_missing_weights_are_normalized() -> None:
    """Pesos ausentes viram zero e a soma continua válida."""
    calculator = RelevanceCalculator({"favorites": 0.5, "boosts": 0.5})

    assert calculator.weights == {
        "favorites": 0.5,
        "boosts": 0.5,
        "followers": 0.0,
        "replies": 0.0,
    }


def test_weights_that_do_not_sum_to_one_are_rejected() -> None:
    """Pesos cuja soma difere de 1 são recusados."""
    with pytest.raises(DataProcessingError):
        RelevanceCalculator({"favorites": 0.4, "boosts": 0.4, "followers": 0.4, "replies": 0.4})


def test_weight_out_of_range_is_rejected() -> None:
    """Pesos fora de [0, 1] são recusados."""
    with pytest.raises(DataProcessingError):
        RelevanceCalculator({"favorites": 1.5, "boosts": 0.2, "followers": 0.2, "replies": 0.1})


def test_sorting_is_descending() -> None:
    """A ordenação devolve o post mais relevante primeiro."""
    calculator = RelevanceCalculator()
    toots = [
        make_toot("1", favorites=1),
        make_toot("2", favorites=500),
        make_toot("3", favorites=50),
    ]

    ordered = calculator.sort_by_relevance(toots)

    assert [toot["id"] for toot in ordered] == ["2", "3", "1"]
