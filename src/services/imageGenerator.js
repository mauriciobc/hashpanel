import { createCanvas, registerFont } from 'canvas';
import { logger } from '../utils/logger.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const BUNDLED_FONT_DIR = path.join(MODULE_DIR, '../../assets/fonts');

/** @type {'DejaVu Sans' | 'sans-serif'} */
let reportFontFamily = 'sans-serif';

const FONT_PATHS = [
  path.join(BUNDLED_FONT_DIR, 'DejaVuSans.ttf'),
  path.join(BUNDLED_FONT_DIR, 'DejaVuSans-Bold.ttf'),
  '/usr/share/fonts/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/TTF/DejaVuSans.ttf',
  '/usr/share/fonts/TTF/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
];

let fontsRegistered = false;
let fontsFoundCount = 0;
const registeredWeights = new Set();

function registerFontsOnce() {
  if (fontsRegistered) return;

  for (const fontPath of FONT_PATHS) {
    const isBold = fontPath.includes('Bold');
    const weight = isBold ? 'bold' : 'normal';
    if (registeredWeights.has(weight)) continue;

    try {
      if (fs.existsSync(fontPath)) {
        registerFont(fontPath, {
          family: 'DejaVu Sans',
          weight
        });
        registeredWeights.add(weight);
        fontsFoundCount++;
        logger.info(`Registered font: ${fontPath}`);
      }
    } catch (err) {
      logger.warn(`Failed to register font ${fontPath}: ${err.message}`);
    }
  }

  if (fontsFoundCount > 0) {
    // node-canvas does not resolve CSS font stacks ("DejaVu Sans, sans-serif");
    // using an unregistered family name renders empty glyph boxes in the PNG.
    reportFontFamily = 'DejaVu Sans';
  } else {
    logger.warn(
      'No DejaVu font file was found for the report image; text may render as empty boxes on this host.'
    );
  }

  fontsRegistered = true;
}

registerFontsOnce();

/** @returns {boolean} Whether DejaVu was registered for dashboard PNG text */
export function isDashboardFontRegistered() {
  return fontsFoundCount > 0;
}

function canvasFont(weight, sizePx) {
  const family =
    reportFontFamily === 'sans-serif' ? 'sans-serif' : `"${reportFontFamily}"`;
  return `${weight} ${sizePx}px ${family}`;
}

/**
 * Service to generate dashboard images using canvas
 */
export class ImageGeneratorService {
  constructor() {
    this.width = 800;
    this.height = 800;
    this.fontFamily = reportFontFamily;

    // Theme definitions
    this.themes = {
      dark: {
        backgroundColor: '#1e1e2e',
        cardColor: '#313244',
        textColor: '#cdd6f4',
        subTextColor: '#a6adc8',
        accentColor: '#89b4fa',
        hashtagColor: '#cba6f7'
      },
      light: {
        backgroundColor: '#f5f5f5',
        cardColor: '#ffffff',
        textColor: '#2c3e50',
        subTextColor: '#5a6c7d',
        accentColor: '#3498db',
        hashtagColor: '#9b59b6'
      }
    };
  }

  /**
   * Get colors for the specified theme
   * @private
   * @param {string} theme - Theme name ('dark' or 'light')
   * @returns {Object} Theme colors
   */
  _getThemeColors(theme = 'dark') {
    return this.themes[theme] || this.themes.dark;
  }

  /**
   * Generate accessible ALT text description from stats
   * @param {Object} stats - Dashboard statistics
   * @returns {string} Accessible description
   */
  generateAltText(stats) {
    const hashtag = stats.hashtag || 'desconhecida';
    const weeklyTotal = stats.summary?.weeklyTotal || 0;
    const uniqueUsers = stats.summary?.uniqueUsers || 0;
    const tootCount = stats.summary?.tootCount || 0;

    const parts = [
      `Dashboard HashPanel para #${hashtag}.`,
      'Dados organizados em 4 cards:',
      `Card 1: Total da semana - ${weeklyTotal} ${weeklyTotal === 1 ? 'post' : 'posts'}.`,
      `Card 2: Participantes únicos - ${uniqueUsers} ${uniqueUsers === 1 ? 'usuário' : 'usuários'}.`,
      `Card 3: Posts hoje - ${tootCount} ${tootCount === 1 ? 'post' : 'posts'}.`,
      `Card 4: Hashtag atual - #${hashtag}.`
    ];
    
    return parts.join(' ');
  }

  /**
   * Generate dashboard image from stats
   * @param {Object} stats - Dashboard statistics
   * @param {Object} options - Generation options
   * @param {string} options.theme - Theme ('dark' or 'light'), defaults to 'dark'
   * @returns {Promise<Object>} Object with imageBuffer and altText
   */
  async generateDashboardImage(stats, options = {}) {
    const theme = options.theme || 'dark';
    const colors = this._getThemeColors(theme);
    
    logger.info('Generating dashboard image report', { theme });
    
    const canvas = createCanvas(this.width, this.height);
    const ctx = canvas.getContext('2d');

    // Background
    ctx.fillStyle = colors.backgroundColor;
    ctx.fillRect(0, 0, this.width, this.height);

    const margin = 40;
    const spacing = 20;
    const cardWidth = (this.width - margin * 2 - spacing) / 2;
    const cardHeight = (this.height - margin * 2 - spacing) / 2;

    // Card colors - adjust for theme
    const cardColors = theme === 'light' 
      ? {
          peach: '#ff7f50',    // Coral
          teal: '#20b2aa',     // Light Sea Green
          sky: '#1e90ff',      // Dodger Blue
          mauve: '#9b59b6'     // Amethyst
        }
      : {
          peach: '#fab387',
          teal: '#94e2d5',
          sky: '#89dceb',
          mauve: '#cba6f7'
        };

    const cards = [
      {
        title: 'TOTAL DA SEMANA',
        value: stats.summary?.weeklyTotal || 0,
        icon: 'bars',
        color: cardColors.peach,
        x: margin,
        y: margin
      },
      {
        title: 'PARTICIPANTES ÚNICOS',
        value: stats.summary?.uniqueUsers || 0,
        icon: 'people',
        color: cardColors.teal,
        x: margin + cardWidth + spacing,
        y: margin
      },
      {
        title: 'POSTS HOJE',
        value: stats.summary?.tootCount || 0,
        icon: 'pen',
        color: cardColors.sky,
        x: margin,
        y: margin + cardHeight + spacing
      },
      {
        title: 'HASHTAG ATUAL',
        value: `#${stats.hashtag || 'desconhecida'}`,
        icon: 'hash',
        color: cardColors.mauve,
        x: margin + cardWidth + spacing,
        y: margin + cardHeight + spacing,
        isHashtag: true
      }
    ];

    cards.forEach(card => {
      this._drawCard(ctx, card, cardWidth, cardHeight, colors);
    });

    const imageBuffer = canvas.toBuffer('image/png');
    const altText = this.generateAltText(stats);
    
    return {
      imageBuffer,
      altText
    };
  }

  /**
   * Draw a single card on the canvas
   * @private
   * @param {Object} colors - Theme colors
   */
  _drawCard(ctx, card, width, height, colors) {
    const radius = 24;

    // Draw card background (rounded rectangle)
    ctx.beginPath();
    ctx.moveTo(card.x + radius, card.y);
    ctx.lineTo(card.x + width - radius, card.y);
    ctx.quadraticCurveTo(card.x + width, card.y, card.x + width, card.y + radius);
    ctx.lineTo(card.x + width, card.y + height - radius);
    ctx.quadraticCurveTo(card.x + width, card.y + height, card.x + width - radius, card.y + height);
    ctx.lineTo(card.x + radius, card.y + height);
    ctx.quadraticCurveTo(card.x, card.y + height, card.x, card.y + height - radius);
    ctx.lineTo(card.x, card.y + radius);
    ctx.quadraticCurveTo(card.x, card.y, card.x + radius, card.y);
    ctx.closePath();
    ctx.fillStyle = colors.cardColor;

    // Add subtle shadow for light theme (must be set BEFORE fill)
    if (colors.backgroundColor === '#f5f5f5') {
      ctx.shadowColor = 'rgba(0, 0, 0, 0.1)';
      ctx.shadowBlur = 10;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 2;
    }

    ctx.fill();

    // Reset shadow immediately after fill
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;

    // Icon Circle (top-left)
    const iconCenterX = card.x + 75;
    const iconCenterY = card.y + 75;
    const iconRadius = 35;

    ctx.beginPath();
    ctx.arc(iconCenterX, iconCenterY, iconRadius, 0, Math.PI * 2);
    ctx.fillStyle = card.color + '33'; // 20% opacity
    ctx.fill();

    // Authored vector icon (no emoji: DejaVu has no emoji glyphs and they render
    // as broken shapes in the PNG)
    ctx.save();
    this._drawIcon(ctx, card.icon, iconCenterX, iconCenterY, card.color);
    ctx.restore();

    // Value
    ctx.fillStyle = card.isHashtag ? card.color : colors.textColor;
    ctx.font = card.isHashtag ? canvasFont('bold', 36) : canvasFont('bold', 56);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    // Fit the value: shrink first, then truncate with an ellipsis
    let valueText = String(card.value);
    const maxValueWidth = width - 80;
    let valueFontSize = card.isHashtag ? 36 : 56;
    while (
      ctx.measureText(valueText).width > maxValueWidth &&
      valueFontSize > (card.isHashtag ? 24 : 36)
    ) {
      valueFontSize -= 4;
      ctx.font = canvasFont('bold', valueFontSize);
    }
    if (ctx.measureText(valueText).width > maxValueWidth) {
      while (valueText.length > 1 && ctx.measureText(valueText + '...').width > maxValueWidth) {
        valueText = valueText.slice(0, -1);
      }
      valueText += '...';
    }
    ctx.fillText(valueText, card.x + 40, card.y + 170);

    // Title (anchored to the card's bottom edge — consistent rhythm, no dead zone)
    ctx.fillStyle = colors.subTextColor;
    ctx.font = canvasFont('bold', 18);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(card.title, card.x + 40, card.y + height - 40);
  }

  /**
   * Draw a vector icon centered at (cx, cy)
   * @private
   * @param {CanvasRenderingContext2D} ctx
   * @param {string} type - bars | people | pen | hash
   * @param {number} cx
   * @param {number} cy
   * @param {string} color
   */
  _drawIcon(ctx, type, cx, cy, color) {
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    switch (type) {
      case 'bars': {
        // Three ascending bars, bottom-aligned
        const barWidth = 8;
        const gap = 6;
        const heights = [16, 26, 36];
        const totalWidth = barWidth * 3 + gap * 2;
        let bx = cx - totalWidth / 2;
        heights.forEach(h => {
          ctx.beginPath();
          ctx.roundRect(bx, cy + 18 - h, barWidth, h, 3);
          ctx.fill();
          bx += barWidth + gap;
        });
        break;
      }
      case 'people': {
        // Two figures: head + dome-shaped shoulders, back one slightly higher
        const drawPerson = (px, py, r) => {
          ctx.beginPath();
          ctx.arc(px, py, r * 0.55, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.arc(px, py + r * 1.5, r, Math.PI, 0);
          ctx.closePath();
          ctx.fill();
        };
        drawPerson(cx - 9, cy - 6, 11);
        drawPerson(cx + 9, cy - 9, 10);
        break;
      }
      case 'pen': {
        // Diagonal pen: shaft + tip
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(-Math.PI / 4);
        ctx.beginPath();
        ctx.roundRect(-14, -6, 22, 12, 4);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(8, -6);
        ctx.lineTo(17, 0);
        ctx.lineTo(8, 6);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(-20, 8);
        ctx.lineTo(-14, 8);
        ctx.stroke();
        ctx.restore();
        break;
      }
      case 'hash': {
        // Text glyph: the hashtag symbol itself
        ctx.font = canvasFont('bold', 34);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('#', cx, cy + 2);
        break;
      }
      default:
        break;
    }
  }
}

export const imageGenerator = new ImageGeneratorService();
