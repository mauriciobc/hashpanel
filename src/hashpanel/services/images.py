"""Geração da imagem do relatório diário.

A imagem é um PNG de 800×800 com quatro cartões (total da semana,
participantes, posts de hoje e hashtag atual). Cada imagem vem acompanhada de
um texto alternativo descritivo, usado como descrição de acessibilidade no
Mastodon.
"""

from __future__ import annotations

import io
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont

from hashpanel.utils.logger import get_logger

logger = get_logger()

CANVAS_SIZE = (800, 800)
MARGIN = 40
SPACING = 20
CARD_RADIUS = 24

FONT_CANDIDATES = (
    Path(__file__).resolve().parents[3] / "assets" / "fonts" / "DejaVuSans.ttf",
    Path("/usr/share/fonts/dejavu/DejaVuSans.ttf"),
    Path("/usr/share/fonts/TTF/DejaVuSans.ttf"),
    Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
)

# Opacidade do círculo de fundo dos ícones (20%).
ICON_CIRCLE_ALPHA = 51

BOLD_FONT_CANDIDATES = (
    Path(__file__).resolve().parents[3] / "assets" / "fonts" / "DejaVuSans-Bold.ttf",
    Path("/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf"),
    Path("/usr/share/fonts/TTF/DejaVuSans-Bold.ttf"),
    Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
)

THEMES: dict[str, dict[str, str]] = {
    "dark": {
        "background": "#1e1e2e",
        "card": "#313244",
        "text": "#cdd6f4",
        "subText": "#a6adc8",
        "accent": "#89b4fa",
        "peach": "#fab387",
        "teal": "#94e2d5",
        "sky": "#89dceb",
        "mauve": "#cba6f7",
    },
    "light": {
        "background": "#f5f5f5",
        "card": "#ffffff",
        "text": "#2c3e50",
        "subText": "#5a6c7d",
        "accent": "#3498db",
        "peach": "#ff7f50",
        "teal": "#20b2aa",
        "sky": "#1e90ff",
        "mauve": "#9b59b6",
    },
}


def _load_font(candidates: tuple[Path, ...], size: int) -> ImageFont.FreeTypeFont:
    """Carrega a primeira fonte disponível, caindo para a padrão do Pillow."""
    for path in candidates:
        try:
            if path.exists():
                return ImageFont.truetype(str(path), size)
        except OSError:
            continue
    return ImageFont.load_default(size=size)


def _font(size: int, *, bold: bool = False) -> ImageFont.FreeTypeFont:
    return _load_font(BOLD_FONT_CANDIDATES if bold else FONT_CANDIDATES, size)


def _blend_on(draw: ImageDraw.ImageDraw, box: list[float], color: str, alpha: int) -> str:
    """Devolve a cor da forma já misturada com o fundo.

    O Pillow não mistura alfa ao desenhar sobre uma imagem RGB, então a cor
    translúcida é pré-combinada com a cor de fundo do pixel amostrado dentro da
    forma. O resultado é opaco, mas visualmente idêntico ao esperado.
    """
    x0, y0, x1, y1 = (int(v) for v in box)
    image_width, image_height = draw.im.size
    width = max(1, min(x1, image_width) - max(x0, 0))
    height = max(1, min(y1, image_height) - max(y0, 0))
    if width <= 0 or height <= 0:
        return color

    # O fundo é amostrado num ponto dentro do cartão, mas fora do círculo do
    # ícone e do glifo — logo acima do centro da forma.
    sample_x = max(x0, 0) + 8
    sample_y = max(y0, 0) - 4
    if not (0 <= sample_x < image_width and 0 <= sample_y < image_height):
        sample_x = max(x0, 0) + 8
        sample_y = max(y0, 0) + 8
    background = draw.im.getpixel((sample_x, sample_y))[:3]

    red, green, blue = (int(color[i : i + 2], 16) for i in (1, 3, 5))
    ratio = max(0.0, min(1.0, alpha / 255))
    mixed = tuple(
        int(round(channel * ratio + bg * (1 - ratio)))
        for channel, bg in ((red, background[0]), (green, background[1]), (blue, background[2]))
    )
    return "#{:02x}{:02x}{:02x}".format(*mixed)


class ImageGeneratorService:
    """Compõe a imagem do relatório e o texto alternativo."""

    def __init__(self) -> None:
        self.width, self.height = CANVAS_SIZE

    # --- texto alternativo ---
    @staticmethod
    def generate_alt_text(stats: dict[str, Any]) -> str:
        """Descrição acessível da imagem, em português."""
        summary = stats.get("summary") or {}
        hashtag = stats.get("hashtag") or "desconhecida"
        weekly_total = summary.get("weeklyTotal") or 0
        unique_users = summary.get("uniqueUsers") or 0
        toot_count = summary.get("tootCount") or 0

        parts = [
            f"Dashboard HashPanel para #{hashtag}.",
            "Dados organizados em 4 cards:",
            f"Card 1: Total da semana - {weekly_total} {'post' if weekly_total == 1 else 'posts'}.",
            f"Card 2: Participantes únicos - {unique_users} "
            f"{'usuário' if unique_users == 1 else 'usuários'}.",
            f"Card 3: Posts hoje - {toot_count} {'post' if toot_count == 1 else 'posts'}.",
            f"Card 4: Hashtag atual - #{hashtag}.",
        ]
        return " ".join(parts)

    # --- imagem ---
    def generate_dashboard_image(
        self, stats: dict[str, Any], *, theme: str = "dark"
    ) -> tuple[bytes, str]:
        """Gera o PNG e devolve ``(bytes, alt_text)``."""
        colors = THEMES.get(theme, THEMES["dark"])
        summary = stats.get("summary") or {}

        image = Image.new("RGB", CANVAS_SIZE, colors["background"])
        draw = ImageDraw.Draw(image)

        card_width = (self.width - MARGIN * 2 - SPACING) // 2
        card_height = (self.height - MARGIN * 2 - SPACING) // 2

        cards = [
            {
                "title": "TOTAL DA SEMANA",
                "value": summary.get("weeklyTotal") or 0,
                "color": colors["peach"],
                "x": MARGIN,
                "y": MARGIN,
            },
            {
                "title": "PARTICIPANTES ÚNICOS",
                "value": summary.get("uniqueUsers") or 0,
                "color": colors["teal"],
                "x": MARGIN + card_width + SPACING,
                "y": MARGIN,
            },
            {
                "title": "POSTS HOJE",
                "value": summary.get("tootCount") or 0,
                "color": colors["sky"],
                "x": MARGIN,
                "y": MARGIN + card_height + SPACING,
            },
            {
                "title": "HASHTAG ATUAL",
                "value": f"#{stats.get('hashtag') or 'desconhecida'}",
                "color": colors["mauve"],
                "x": MARGIN + card_width + SPACING,
                "y": MARGIN + card_height + SPACING,
                "is_hashtag": True,
            },
        ]

        for card in cards:
            self._draw_card(draw, card, card_width, card_height, colors)

        buffer = io.BytesIO()
        image.save(buffer, format="PNG")
        return buffer.getvalue(), self.generate_alt_text(stats)

    def _draw_card(
        self,
        draw: ImageDraw.ImageDraw,
        card: dict[str, Any],
        width: int,
        height: int,
        colors: dict[str, str],
    ) -> None:
        """Desenha um cartão com ícone, valor e título."""
        x, y = card["x"], card["y"]
        is_hashtag = card.get("is_hashtag", False)

        draw.rounded_rectangle(
            [x, y, x + width, y + height],
            radius=CARD_RADIUS,
            fill=colors["card"],
        )

        # Círculo do ícone.
        # A transparência precisa ser composta explicitamente: o Pillow guarda
        # o canal alfa de uma cor de 8 dígitos, mas não o mistura ao desenhar
        # sobre uma imagem RGB — o círculo sairia opaco e esconderia o glifo
        # vetorial desenhado por cima (na mesma cor).
        icon_center_x, icon_center_y, icon_radius = x + 75, y + 75, 35
        circle_box = [
            icon_center_x - icon_radius,
            icon_center_y - icon_radius,
            icon_center_x + icon_radius,
            icon_center_y + icon_radius,
        ]
        draw.ellipse(circle_box, fill=_blend_on(draw, circle_box, card["color"], ICON_CIRCLE_ALPHA))
        self._draw_icon(draw, card["title"], icon_center_x, icon_center_y, card["color"])

        # Valor, encolhido e truncado para caber na largura do cartão
        value_text = str(card["value"])
        max_value_width = width - 80
        font_size = 36 if is_hashtag else 56
        min_font_size = 24 if is_hashtag else 36
        font = _font(font_size, bold=True)

        while (
            font_size > min_font_size and draw.textlength(value_text, font=font) > max_value_width
        ):
            font_size -= 4
            font = _font(font_size, bold=True)

        if draw.textlength(value_text, font=font) > max_value_width:
            while (
                len(value_text) > 1
                and draw.textlength(value_text + "...", font=font) > max_value_width
            ):
                value_text = value_text[:-1]
            value_text += "..."

        draw.text(
            (x + 40, y + 170),
            value_text,
            font=font,
            fill=card["color"] if is_hashtag else colors["text"],
        )

        # Título, ancorado na base do cartão
        draw.text(
            (x + 40, y + height - 40),
            card["title"],
            font=_font(18, bold=True),
            fill=colors["subText"],
            anchor="ls",
        )

    @staticmethod
    def _draw_icon(
        draw: ImageDraw.ImageDraw,
        title: str,
        cx: int,
        cy: int,
        color: str,
    ) -> None:
        """Desenha o ícone vetorial do cartão (sem emoji, que não renderizam)."""
        if title == "TOTAL DA SEMANA":
            bar_width, gap, heights = 8, 6, (16, 26, 36)
            total_width = bar_width * 3 + gap * 2
            bx = cx - total_width // 2
            for height in heights:
                draw.rounded_rectangle(
                    [bx, cy + 18 - height, bx + bar_width, cy + 18],
                    radius=3,
                    fill=color,
                )
                bx += bar_width + gap
        elif title == "PARTICIPANTES ÚNICOS":
            for px, py, radius in ((cx - 9, cy - 6, 11), (cx + 9, cy - 9, 10)):
                draw.ellipse(
                    [
                        px - radius * 0.55,
                        py - radius * 0.55,
                        px + radius * 0.55,
                        py + radius * 0.55,
                    ],
                    fill=color,
                )
                draw.pieslice(
                    [px - radius, py + radius * 0.5, px + radius, py + radius * 2.5],
                    start=180,
                    end=360,
                    fill=color,
                )
        elif title == "POSTS HOJE":
            # Caneta diagonal: corpo + ponta
            draw.polygon(
                [
                    (cx - 12, cy + 8),
                    (cx + 4, cy - 8),
                    (cx + 10, cy - 2),
                    (cx - 6, cy + 14),
                ],
                fill=color,
            )
            draw.polygon(
                [(cx + 4, cy - 8), (cx + 12, cy - 14), (cx + 16, cy - 8), (cx + 10, cy - 2)],
                fill=color,
            )
        elif title == "HASHTAG ATUAL":
            draw.text(
                (cx, cy + 2),
                "#",
                font=_font(34, bold=True),
                fill=color,
                anchor="mm",
            )


_generator: ImageGeneratorService | None = None


def get_image_generator() -> ImageGeneratorService:
    """Instância única do gerador de imagens."""
    global _generator
    if _generator is None:
        _generator = ImageGeneratorService()
    return _generator
