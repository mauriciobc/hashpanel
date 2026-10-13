import { createCanvas } from 'canvas';
import { logger } from '../utils/logger.js';

/**
 * Service to generate dashboard images using canvas
 */
export class ImageGeneratorService {
  constructor() {
    this.width = 800;
    this.height = 800;
    
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
        icon: '📊',
        color: cardColors.peach,
        x: margin,
        y: margin
      },
      {
        title: 'PARTICIPANTES ÚNICOS',
        value: stats.summary?.uniqueUsers || 0,
        icon: '👥',
        color: cardColors.teal,
        x: margin + cardWidth + spacing,
        y: margin
      },
      {
        title: 'POSTS HOJE',
        value: stats.summary?.tootCount || 0,
        icon: '📝',
        color: cardColors.sky,
        x: margin,
        y: margin + cardHeight + spacing
      },
      {
        title: 'HASHTAG ATUAL',
        value: `#${stats.hashtag || 'desconhecida'}`,
        icon: '#',
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

    // Icon Circle
    const iconX = card.x + 40;
    const iconY = card.y + 40;
    const iconRadius = 35;
    
    ctx.beginPath();
    ctx.arc(iconX + iconRadius, iconY + iconRadius, iconRadius, 0, Math.PI * 2);
    ctx.fillStyle = card.color + '33'; // 20% opacity
    ctx.fill();

    // Draw Icon/Text for Icon
    ctx.fillStyle = card.color;
    ctx.font = 'bold 32px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(card.icon, iconX + iconRadius, iconY + iconRadius);

    // Value
    ctx.fillStyle = card.isHashtag ? card.color : colors.textColor;
    ctx.font = card.isHashtag ? 'bold 36px Arial' : 'bold 56px Arial';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    
    // Handle long hashtags
    let valueText = String(card.value);
    if (card.isHashtag && valueText.length > 15) {
        valueText = valueText.substring(0, 12) + '...';
    }
    ctx.fillText(valueText, card.x + 40, card.y + 130);

    // Title
    ctx.fillStyle = colors.subTextColor;
    ctx.font = 'bold 18px Arial';
    ctx.fillText(card.title, card.x + 40, card.y + 210);
  }
}

export const imageGenerator = new ImageGeneratorService();
