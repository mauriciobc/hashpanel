import { describe, it, expect } from 'vitest';
import { ImageGeneratorService } from '../../../src/services/imageGenerator.js';

describe('ImageGeneratorService', () => {
  const service = new ImageGeneratorService();

  describe('generateAltText', () => {
    it('deve gerar texto ALT descritivo com todos os dados', () => {
      const stats = {
        hashtag: 'tercinema',
        summary: {
          weeklyTotal: 150,
          uniqueUsers: 45,
          tootCount: 23
        }
      };

      const altText = service.generateAltText(stats);

      expect(altText).toContain('Dashboard HashPanel para #tercinema');
      expect(altText).toContain('Total da semana - 150 posts');
      expect(altText).toContain('Participantes únicos - 45 usuários');
      expect(altText).toContain('Posts hoje - 23 posts');
      expect(altText).toContain('Hashtag atual - #tercinema');
    });

    it('deve usar singular para valores unitários', () => {
      const stats = {
        hashtag: 'teste',
        summary: {
          weeklyTotal: 1,
          uniqueUsers: 1,
          tootCount: 1
        }
      };

      const altText = service.generateAltText(stats);

      expect(altText).toContain('1 post');
      expect(altText).toContain('1 usuário');
      expect(altText).not.toContain('1 posts');
      expect(altText).not.toContain('1 usuários');
    });

    it('deve lidar com valores zero', () => {
      const stats = {
        hashtag: 'vazia',
        summary: {
          weeklyTotal: 0,
          uniqueUsers: 0,
          tootCount: 0
        }
      };

      const altText = service.generateAltText(stats);

      expect(altText).toContain('0 posts');
      expect(altText).toContain('0 usuários');
    });

    it('deve lidar com dados ausentes usando valores padrão', () => {
      const stats = {
        hashtag: 'incompleta',
        summary: {}
      };

      const altText = service.generateAltText(stats);

      expect(altText).toContain('Dashboard HashPanel');
      expect(altText).toContain('0 posts');
      expect(altText).toContain('0 usuários');
    });

    it('deve estruturar a descrição em 6 partes claras', () => {
      const stats = {
        hashtag: 'teste',
        summary: {
          weeklyTotal: 100,
          uniqueUsers: 30,
          tootCount: 15
        }
      };

      const altText = service.generateAltText(stats);

      // Verifica estrutura
      expect(altText).toMatch(/Dashboard HashPanel.*Dados organizados em 4 cards.*Card 1.*Card 2.*Card 3.*Card 4/);
    });

    it('deve mencionar todos os 4 cards na descrição', () => {
      const stats = {
        hashtag: 'completo',
        summary: {
          weeklyTotal: 200,
          uniqueUsers: 50,
          tootCount: 30
        }
      };

      const altText = service.generateAltText(stats);

      expect(altText).toContain('Card 1');
      expect(altText).toContain('Card 2');
      expect(altText).toContain('Card 3');
      expect(altText).toContain('Card 4');
    });

    it('deve preservar caracteres especiais na hashtag', () => {
      const stats = {
        hashtag: 'músicabrasileira',
        summary: {
          weeklyTotal: 10,
          uniqueUsers: 5,
          tootCount: 3
        }
      };

      const altText = service.generateAltText(stats);

      expect(altText).toContain('#músicabrasileira');
    });
  });

  describe('generateDashboardImage', () => {
    it('deve retornar objeto com imageBuffer e altText', async () => {
      const stats = {
        hashtag: 'teste',
        summary: {
          weeklyTotal: 100,
          uniqueUsers: 30,
          tootCount: 15
        }
      };

      const result = await service.generateDashboardImage(stats);

      expect(result).toHaveProperty('imageBuffer');
      expect(result).toHaveProperty('altText');
      expect(Buffer.isBuffer(result.imageBuffer)).toBe(true);
      expect(typeof result.altText).toBe('string');
    });

    it('deve gerar texto ALT consistente com os dados da imagem', async () => {
      const stats = {
        hashtag: 'tercinema',
        summary: {
          weeklyTotal: 150,
          uniqueUsers: 45,
          tootCount: 23
        }
      };

      const result = await service.generateDashboardImage(stats);

      expect(result.altText).toContain('#tercinema');
      expect(result.altText).toContain('150');
      expect(result.altText).toContain('45');
      expect(result.altText).toContain('23');
    });

    it('deve gerar imagem com tema dark por padrão', async () => {
      const stats = {
        hashtag: 'teste',
        summary: {
          weeklyTotal: 10,
          uniqueUsers: 5,
          tootCount: 3
        }
      };

      const result = await service.generateDashboardImage(stats);

      expect(Buffer.isBuffer(result.imageBuffer)).toBe(true);
      expect(result.imageBuffer.length).toBeGreaterThan(0);
    });

    it('deve gerar imagem com tema light quando especificado', async () => {
      const stats = {
        hashtag: 'teste',
        summary: {
          weeklyTotal: 10,
          uniqueUsers: 5,
          tootCount: 3
        }
      };

      const result = await service.generateDashboardImage(stats, { theme: 'light' });

      expect(Buffer.isBuffer(result.imageBuffer)).toBe(true);
      expect(result.imageBuffer.length).toBeGreaterThan(0);
    });
  });
});
