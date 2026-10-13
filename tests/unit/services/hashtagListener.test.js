import { describe, it, expect, beforeEach } from 'vitest';
import { HashtagListener } from '../../../src/services/hashtagListener.js';

describe('HashtagListener', () => {
  let listener;

  beforeEach(() => {
    listener = new HashtagListener();
  });

  describe('extractHashtags', () => {
    it('deve extrair hashtag simples do conteúdo', () => {
      const content = '<p>Teste com <a href="#" class="hashtag">#<span>tercinema</span></a></p>';
      const result = listener.extractHashtags(content);
      
      expect(result).toEqual(['tercinema']);
    });

    it('deve extrair múltiplas hashtags', () => {
      const content = '<p>Teste com #tercinema e #sextaserie</p>';
      const result = listener.extractHashtags(content);
      
      expect(result).toEqual(['tercinema', 'sextaserie']);
    });

    it('deve retornar array vazio quando não há hashtags', () => {
      const content = '<p>Post sem hashtags</p>';
      const result = listener.extractHashtags(content);
      
      expect(result).toEqual([]);
    });

    it('deve ignorar hashtags do próprio bot (#hashpanel, #bot)', () => {
      const content = '<p>#tercinema #hashpanel #bot</p>';
      const result = listener.extractHashtags(content);
      
      expect(result).toEqual(['tercinema']);
    });

    it('deve converter hashtags para lowercase', () => {
      const content = '<p>#TerCinema #SEXTASERIE</p>';
      const result = listener.extractHashtags(content);
      
      expect(result).toEqual(['tercinema', 'sextaserie']);
    });

    it('deve lidar com HTML complexo', () => {
      const content = `
        <p>
          <span class="h-card">
            <a href="https://mastodon.social/@bot" class="u-url mention">@bot</a>
          </span> 
          Ei, me mostra dados da 
          <a href="https://mastodon.social/tags/tercinema" class="mention hashtag">#<span>tercinema</span></a>!
        </p>
      `;
      const result = listener.extractHashtags(content);
      
      expect(result).toEqual(['tercinema']);
    });

    it('deve suportar caracteres acentuados e Unicode', () => {
      const content = '<p>#músicabrasileira #açúcar #café</p>';
      const result = listener.extractHashtags(content);
      
      expect(result).toContain('músicabrasileira');
      expect(result).toContain('açúcar');
      expect(result).toContain('café');
    });

    it('deve lidar com hashtags no meio de texto', () => {
      const content = '<p>Olá @bot, pode analisar a #tercinema para mim? Obrigado!</p>';
      const result = listener.extractHashtags(content);
      
      expect(result).toEqual(['tercinema']);
    });

    it('deve extrair hashtags mesmo com emojis ao redor', () => {
      const content = '<p>🎬 #tercinema 🍿 e #sextaserie 📺</p>';
      const result = listener.extractHashtags(content);
      
      expect(result).toEqual(['tercinema', 'sextaserie']);
    });

    it('deve lidar com hashtags duplicadas', () => {
      const content = '<p>#tercinema é legal! Eu gosto de #tercinema</p>';
      const result = listener.extractHashtags(content);
      
      // Retorna ambas ocorrências (o código não remove duplicatas)
      expect(result).toHaveLength(2);
      expect(result[0]).toBe('tercinema');
      expect(result[1]).toBe('tercinema');
    });

    it('deve ignorar # seguido de números apenas', () => {
      const content = '<p>#123 não é hashtag válida, mas #tag123 é</p>';
      const result = listener.extractHashtags(content);
      
      expect(result).toEqual(['tag123']);
      expect(result).not.toContain('123');
    });

    it('deve ignorar hashtags apenas com dígitos e underscore', () => {
      const content = '<p>#_123 #12_34 #a1 #1a</p>';
      const result = listener.extractHashtags(content);

      expect(result).toEqual(['a1', '1a']);
    });

    it('deve aceitar hashtag de uma única letra', () => {
      const content = '<p>#a</p>';
      const result = listener.extractHashtags(content);

      expect(result).toEqual(['a']);
    });

    it('deve retornar vazio para # sozinho', () => {
      const content = '<p>#  sozinho</p>';
      const result = listener.extractHashtags(content);

      expect(result).toEqual([]);
    });
  });
});
