# Solução de Proxy de Imagens - Tech Lead Approach

## 📋 Problema Identificado

As imagens dos toots do Mastodon não estavam carregando no preview customizado devido a:

1. **CORS (Cross-Origin Resource Sharing)**: Servidores de CDN do Mastodon bloqueiam requisições diretas do navegador
2. **Hotlinking Protection**: Alguns servidores bloqueiam requisições que não vêm de referrers autorizados
3. **Políticas de Segurança**: Navegadores bloqueiam recursos de origens diferentes por segurança

## ✅ Solução Implementada: Backend Image Proxy

### Arquitetura

```
Frontend (Browser) → Backend API (/api/media/proxy) → Mastodon CDN → Backend → Frontend
```

### Por que esta solução?

1. **Resolve CORS**: O backend faz a requisição, não o navegador
2. **Segurança**: Validação de URLs, whitelist de domínios
3. **Performance**: Cache de imagens (1 hora TTL)
4. **Rate Limiting**: Proteção contra abuso
5. **Escalabilidade**: Pode ser migrado para Redis/CDN no futuro

## 🔧 Implementação

### Backend (`src/server/routes/media.js`)

**Características:**
- ✅ Validação de URL (apenas HTTP/HTTPS)
- ✅ Whitelist de domínios permitidos
- ✅ Cache em memória (1 hora TTL, max 100 itens)
- ✅ Rate limiting (lightRateLimit: 100 req/5min)
- ✅ Timeout de 10 segundos
- ✅ Limite de tamanho (10MB)
- ✅ Validação de Content-Type
- ✅ Headers de cache apropriados

**Endpoint:**
```
GET /api/media/proxy?url={encoded_image_url}&cache=true
```

**Exemplo:**
```
GET /api/media/proxy?url=https%3A%2F%2Fi.cdn.ursal.zone%2Fcache%2Fmedia_attachments%2Ffiles%2F115%2F790%2F575%2F539%2F295%2F579%2Foriginal%2F3bd1f75891f67f2d.webp
```

### Frontend (`public/index.html`)

**Mudança:**
- Antes: `src="${imgUrl}"` (requisição direta)
- Depois: `src="${API_BASE}/media/proxy?url=${encodeURIComponent(imgUrl)}"` (via proxy)

## 🔒 Segurança

### Validações Implementadas

1. **Protocolo**: Apenas HTTP/HTTPS
2. **Domínios**: Whitelist de CDNs do Mastodon
3. **Content-Type**: Apenas `image/*`
4. **Tamanho**: Máximo 10MB
5. **Rate Limiting**: 100 requisições por 5 minutos por IP (lightRateLimit)

### Whitelist de Domínios

```javascript
const allowedDomains = [
  'cdn.ursal.zone',
  'i.cdn.ursal.zone',
  'files.mastodon.social',
  'media.mastodon.social',
  'cdn.mastodon.social'
];
```

**Nota**: Domínios não-whitelisted são logados mas permitidos (para flexibilidade).

## 📊 Performance

### Cache Strategy

- **TTL**: 1 hora
- **Storage**: In-memory Map (pode migrar para Redis)
- **Max Items**: 100 (cleanup automático)
- **Headers**: `Cache-Control: public, max-age=3600`

### Otimizações Futuras

1. **Redis Cache**: Para múltiplas instâncias
2. **CDN Integration**: CloudFlare/CloudFront na frente
3. **Image Optimization**: Resize/compress no proxy
4. **Lazy Loading**: Já implementado no frontend

## 🚀 Como Usar

### Para Desenvolvedores

1. **Node.js 18+**: Usa `fetch` nativo
2. **Node.js < 18**: Instalar `node-fetch` (fallback automático)

### Para Usuários

Transparente - as imagens carregam automaticamente via proxy.

## 📝 Logs e Monitoramento

O endpoint loga:
- ✅ Requisições de proxy
- ✅ Cache hits/misses
- ✅ Erros de fetch
- ✅ Timeouts
- ✅ Domínios não-whitelisted

## 🔄 Alternativas Consideradas

### ❌ CORS Headers no CDN
- **Problema**: Não temos controle sobre CDNs do Mastodon
- **Solução**: Não aplicável

### ❌ Service Worker
- **Problema**: Complexidade, não resolve CORS
- **Solução**: Não aplicável

### ❌ iframe com embed
- **Problema**: Algumas instâncias não retornam iframe
- **Solução**: Já implementado como fallback

### ✅ Backend Proxy (Escolhido)
- **Vantagens**: Controle total, segurança, cache, escalável
- **Desvantagens**: Custo de banda do servidor

## 🎯 Próximos Passos (Opcional)

1. **Redis Cache**: Para produção multi-instância
2. **Image CDN**: CloudFlare Images ou similar
3. **Compression**: WebP/AVIF conversion
4. **Metrics**: Prometheus/Grafana para monitoramento
5. **Whitelist Configurável**: Via environment variables

## 📚 Referências

- [MDN: CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS)
- [Express Rate Limiting](https://express-rate-limit.mintlify.app/)
- [Node.js Fetch API](https://nodejs.org/api/globals.html#fetch)

---

**Implementado por**: Tech Lead
**Data**: 2025-12-27
**Status**: ✅ Produção Ready
