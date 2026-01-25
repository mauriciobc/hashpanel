import { describe, it, expect } from 'vitest';
import { createCanvas, loadImage } from 'canvas';
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

      // Gerar com tema dark (padrão)
      const darkResult = await service.generateDashboardImage(stats);
      
      // Gerar com tema light (explícito) para comparação
      const lightResult = await service.generateDashboardImage(stats, { theme: 'light' });

      // Verificar que ambos geram buffers válidos
      expect(Buffer.isBuffer(darkResult.imageBuffer)).toBe(true);
      expect(Buffer.isBuffer(lightResult.imageBuffer)).toBe(true);
      expect(darkResult.imageBuffer.length).toBeGreaterThan(0);
      expect(lightResult.imageBuffer.length).toBeGreaterThan(0);
      
      // Verificar que as imagens são diferentes (tema aplicado corretamente)
      expect(darkResult.imageBuffer).not.toEqual(lightResult.imageBuffer);
      
      // Decodificar as imagens e verificar que as cores de fundo são diferentes
      const darkImage = await loadImage(darkResult.imageBuffer);
      const lightImage = await loadImage(lightResult.imageBuffer);
      
      // Criar canvas temporários para ler pixels
      const tempCanvas = createCanvas(1, 1);
      const tempCtx = tempCanvas.getContext('2d');
      
      // Ler pixel do canto superior esquerdo (deve ter a cor de fundo)
      tempCtx.drawImage(darkImage, 0, 0);
      const darkPixel = tempCtx.getImageData(0, 0, 1, 1).data;
      
      tempCtx.clearRect(0, 0, 1, 1);
      tempCtx.drawImage(lightImage, 0, 0);
      const lightPixel = tempCtx.getImageData(0, 0, 1, 1).data;
      
      // Verificar que os pixels são diferentes (cores de fundo diferentes)
      // Dark theme: #1e1e2e (RGB: 30, 30, 46)
      // Light theme: #f5f5f5 (RGB: 245, 245, 245)
      expect(darkPixel[0]).not.toBe(lightPixel[0]); // R diferente
      expect(darkPixel[1]).not.toBe(lightPixel[1]); // G diferente
      expect(darkPixel[2]).not.toBe(lightPixel[2]); // B diferente
      
      // Verificar valores específicos do tema dark (aproximados devido a compressão PNG)
      // Dark theme deve ter valores baixos (escuro)
      expect(darkPixel[0]).toBeLessThan(50); // R < 50
      expect(darkPixel[1]).toBeLessThan(50); // G < 50
      expect(darkPixel[2]).toBeLessThan(50); // B < 50
      
      // Light theme deve ter valores altos (claro)
      expect(lightPixel[0]).toBeGreaterThan(200); // R > 200
      expect(lightPixel[1]).toBeGreaterThan(200); // G > 200
      expect(lightPixel[2]).toBeGreaterThan(200); // B > 200
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
