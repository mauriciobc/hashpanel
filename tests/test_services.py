"""Testes dos serviços: imagem, resumos, extração de hashtags e coleta."""

from __future__ import annotations

from typing import Any

from hashpanel.constants import TRUNCATION_NOTICE
from hashpanel.services.collector import HistoryCollector
from hashpanel.services.hashtags import HashtagAnalysis
from hashpanel.services.images import ImageGeneratorService
from hashpanel.services.listener import extract_hashtags
from hashpanel.services.toots import TootService
from tests.conftest import make_toot


# --- imagem ---
def test_image_is_a_valid_png() -> None:
    """A imagem gerada é um PNG legível."""
    from io import BytesIO

    from PIL import Image

    generator = ImageGeneratorService()
    image_bytes, alt_text = generator.generate_dashboard_image(
        {"hashtag": "tercinema", "summary": {"tootCount": 5, "uniqueUsers": 3, "weeklyTotal": 40}}
    )

    image = Image.open(BytesIO(image_bytes))
    assert image.format == "PNG"
    assert image.size == (800, 800)
    assert "tercinema" in alt_text


def test_alt_text_describes_every_card() -> None:
    """O texto alternativo menciona os quatro cards."""
    generator = ImageGeneratorService()
    alt_text = generator.generate_alt_text(
        {"hashtag": "tercinema", "summary": {"tootCount": 1, "uniqueUsers": 1, "weeklyTotal": 2}}
    )

    assert "Total da semana - 2 posts" in alt_text
    assert "Participantes únicos - 1 usuário" in alt_text
    assert "Posts hoje - 1 post" in alt_text
    assert "Hashtag atual - #tercinema" in alt_text


def test_light_theme_differs_from_dark() -> None:
    """Os temas geram imagens diferentes."""
    generator = ImageGeneratorService()
    stats = {
        "hashtag": "tercinema",
        "summary": {"tootCount": 1, "uniqueUsers": 1, "weeklyTotal": 2},
    }

    assert (
        generator.generate_dashboard_image(stats, theme="dark")[0]
        != (generator.generate_dashboard_image(stats, theme="light")[0])
    )


def test_icon_circle_is_translucent() -> None:
    """O círculo do ícone é a cor de destaque misturada ao fundo do cartão.

    O Pillow não mistura alfa ao desenhar sobre uma imagem RGB, então o
    círculo precisa ser pré-combinado. Sem isso, o círculo sairia opaco e o
    glifo vetorial — desenhado na mesma cor — ficaria invisível.
    """
    from io import BytesIO

    from PIL import Image

    generator = ImageGeneratorService()
    image_bytes, _ = generator.generate_dashboard_image(
        {"hashtag": "tercinema", "summary": {"tootCount": 1, "uniqueUsers": 1, "weeklyTotal": 2}},
        theme="dark",
    )
    image = Image.open(BytesIO(image_bytes)).convert("RGB")

    accent = (250, 179, 135)  # peach do tema escuro
    card_bg = (49, 50, 68)

    # Amostra o anel do círculo, entre a borda e o glifo.
    ring = {image.getpixel((x, 115)) for x in range(82, 108)}

    # O anel tem a cor misturada (20% do destaque sobre o fundo do cartão).
    ratio = 51 / 255
    expected = tuple(
        int(round(channel * ratio + background * (1 - ratio)))
        for channel, background in zip(accent, card_bg, strict=True)
    )
    assert expected in ring, f"círculo opaco: esperado {expected}, encontrado {ring}"

    # E o glifo vetorial continua visível em cima do círculo.
    assert accent in {image.getpixel((x, 115)) for x in range(108, 150)}


def test_icons_are_distinct() -> None:
    """Cada cartão tem um glifo vetorial diferente.

    Sem o círculo translúcido, os quatro ícones viravam discos idênticos.
    """
    from io import BytesIO

    from PIL import Image

    generator = ImageGeneratorService()
    image_bytes, _ = generator.generate_dashboard_image(
        {"hashtag": "tercinema", "summary": {"tootCount": 1, "uniqueUsers": 1, "weeklyTotal": 2}},
        theme="dark",
    )
    image = Image.open(BytesIO(image_bytes)).convert("RGB")

    accents = [(250, 179, 135), (148, 226, 213), (137, 220, 235), (203, 166, 247)]
    origins = [(40, 40), (430, 40), (40, 410), (430, 410)]

    glyphs = []
    for accent, (x, y) in zip(accents, origins, strict=True):
        pixels = {
            (px, py)
            for py in range(y + 40, y + 110)
            for px in range(x + 40, x + 110)
            if image.getpixel((px, py)) == accent
        }
        assert pixels, f"nenhum glifo desenhado para a cor {accent}"
        glyphs.append(pixels)

    for index, first in enumerate(glyphs):
        for other in glyphs[index + 1 :]:
            assert first != other, "dois cartões compartilham o mesmo glifo"


# --- resumo ---
def _analysis() -> HashtagAnalysis:
    """Análise de exemplo, com posts pontuados."""
    toots = [
        make_toot("1", "alice", favorites=10, followers=100),
        make_toot("2", "bob", favorites=50, followers=500),
    ]
    for toot in toots:
        toot["relevanceScore"] = 42.5

    return HashtagAnalysis(
        "tercinema",
        "2026-01-15",
        toots,
        [{"day": "1767225600", "uses": "12", "accounts": "5"}],
    )


def test_summary_contains_the_essentials() -> None:
    """O resumo traz hashtags, números e os posts principais.

    As contagens vêm dos posts do dia (2 posts, 2 participantes), não do
    agregado UTC da API.
    """
    service = TootService.__new__(TootService)
    from hashpanel.config import get_settings

    service.settings = get_settings()
    service.mastodon = None
    service.hashtags = None
    service.images = None

    summary = service.generate_summary("tercinema", _analysis())

    assert "#tercinema - Resumo Diário" in summary
    assert "Posts hoje: 2" in summary
    assert "Participantes: 2" in summary
    assert "Principais posts:" in summary
    assert "@alice" in summary
    assert "Score: 42.5" in summary


def test_summary_respects_the_character_limit() -> None:
    """Um conteúdo muito longo é cortado com o aviso de truncamento."""
    service = TootService.__new__(TootService)
    from hashpanel.config import get_settings

    service.settings = get_settings()
    service.mastodon = None
    service.hashtags = None
    service.images = None

    # Um nome de hashtag enorme força o resumo a estourar o limite.
    long_tag = "tercinema" + "x" * 400
    summary = service.generate_summary(long_tag, _analysis())

    assert len(summary) <= 500
    assert summary.endswith(TRUNCATION_NOTICE)


def test_truncate_keeps_whole_lines() -> None:
    """O truncamento mantém linhas inteiras e acrescenta o aviso."""
    lines = ["linha " + "a" * 40 for _ in range(20)]

    result = TootService._truncate(lines, 200)

    assert len(result) <= 200
    assert result.endswith(TRUNCATION_NOTICE)
    kept = result[: -len(TRUNCATION_NOTICE)].rstrip("\n").split("\n")
    assert kept
    assert kept == lines[: len(kept)]
    assert "\n" in result


def test_truncate_preserves_content_that_fits() -> None:
    """Conteúdo que cabe no limite volta inteiro, sem aviso de truncamento.

    Acrescentar o aviso a um texto que já cabe não é cortar nada — e, com
    494 caracteres, empurrar o aviso para dentro do limite descartaria uma
    linha inteira do resumo.
    """
    lines = ["y" * 98 for _ in range(5)]  # 494 caracteres
    joined = "\n".join(lines)
    assert len(joined) <= 500

    result = TootService._truncate(lines, 500)

    assert result == joined
    assert len(result) <= 500
    assert TRUNCATION_NOTICE not in result


def test_truncate_reserves_room_for_the_notice() -> None:
    """Quando só o aviso não cabe, o texto cede espaço para ele.

    190 caracteres mais o aviso (22) estouram os 200, então o primeiro
    bloco não é aceito: o resultado é o aviso, e não uma linha que depois
    teria de ser descartada.
    """
    result = TootService._truncate(["a" * 190, "b"], 200)

    assert len(result) <= 200
    assert result.endswith(TRUNCATION_NOTICE)


def test_truncate_cuts_at_a_line_boundary_and_warns() -> None:
    """Acima do limite, o corte é em linha inteira e o aviso fecha o texto."""
    lines = ["z" * 100 for _ in range(10)]

    result = TootService._truncate(lines, 500)

    assert len(result) <= 500
    assert result.endswith(TRUNCATION_NOTICE)
    kept = result[: -len(TRUNCATION_NOTICE)].rstrip("\n")
    assert kept.split("\n") == lines[:4]


# --- extração de hashtags ---
def test_extracts_hashtag_from_mastodon_html() -> None:
    """Hashtags no HTML do Mastodon são reconhecidas."""
    content = '<a href="/tags/tercinema" class="hashtag">#<span>tercinema</span></a>'

    assert extract_hashtags(content) == ["tercinema"]


def test_extracts_hashtag_from_plain_text() -> None:
    """Hashtags em texto simples também são reconhecidas."""
    assert extract_hashtags("olá #tercinema tudo bem") == ["tercinema"]


def test_digit_only_hashtag_is_not_a_hashtag() -> None:
    """``#123`` não é uma hashtag válida."""
    assert extract_hashtags("olá #123 mundo") == []


def test_bot_hashtags_are_ignored() -> None:
    """As hashtags do próprio bot não geram relatório."""
    assert extract_hashtags("post do #hashpanel") == []
    assert extract_hashtags("post do #bot") == []


def test_unicode_hashtags_are_supported() -> None:
    """Hashtags com acentos são reconhecidas."""
    assert extract_hashtags("olá #música") == ["música"]


# --- coleta ---
def test_collector_skips_already_collected_data(repository: Any) -> None:
    """Dados já coletados não são buscados de novo."""
    from hashpanel.utils.timezone import get_current_date_in_timezone

    collector = HistoryCollector(repository=repository)
    today = get_current_date_in_timezone(collector.settings.preferred_timezone)
    calls: list[str] = []

    class FakeMastodon:
        def fetch_all_toots(
            self, hashtag: str, max_pages: int | None = None
        ) -> list[dict[str, Any]]:
            calls.append(hashtag)
            return [make_toot("1", "alice", created_at=f"{today}T12:00:00.000Z")]

    collector.mastodon = FakeMastodon()

    assert collector.collect_hashtag_data("tercinema", today) is True
    assert repository.has_data_for_date("tercinema", today) is True

    # A segunda chamada não chama a API.
    calls.clear()
    assert collector.collect_hashtag_data("tercinema", today) is False
    assert calls == []


def test_collector_saves_the_matching_day(repository: Any) -> None:
    """O coletor grava o dia pedido, contando os posts do dia local.

    O post de ``21/10 02:00Z`` é ``20/10 23:00`` em São Paulo e conta no dia
    20; o de ``19/10 12:00Z`` fica de fora. O dia já terminou e está além da
    primeira página da timeline, então a coleta precisa paginar até ele.
    """
    target_day = "2026-10-20"
    collector = HistoryCollector(repository=repository)
    page_size = collector.settings.toots_per_page

    # Posts recentes que ocupam a primeira página inteira da timeline.
    recent = [
        make_toot(f"recente-{index}", "carol", created_at="2026-10-21T12:00:00.000Z")
        for index in range(page_size + 5)
    ]
    tail = [
        make_toot("1", "alice", created_at="2026-10-20T12:00:00.000Z"),
        # 02:00 UTC de 21/10 ainda é 23:00 de 20/10 em São Paulo.
        make_toot("2", "alice", created_at="2026-10-21T02:00:00.000Z"),
        make_toot("3", "bob", created_at="2026-10-20T18:00:00.000Z"),
        # Dia anterior no fuso local: fora da contagem.
        make_toot("4", "carol", created_at="2026-10-19T12:00:00.000Z"),
    ]
    timeline = recent + tail

    class FakeMastodon:
        def fetch_all_toots(
            self, hashtag: str, max_pages: int | None = None
        ) -> list[dict[str, Any]]:
            return timeline[: page_size * (max_pages or 1)]

    collector.mastodon = FakeMastodon()

    assert collector.collect_hashtag_data("tercinema", target_day) is True

    data = repository.get_daily_data("tercinema", target_day)
    assert data is not None
    assert data["uses"] == 3
    assert data["accounts"] == 2
