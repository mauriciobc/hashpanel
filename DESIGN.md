---
name: Hashpanel
description: Painel comunitário de estatísticas de hashtags diárias do Mastodon — minimalista em preto, com cor apenas como destaque
colors:
  preto-base: "#000000"
  superficie-cartao: "#0b0b0e"
  superficie-hover: "#131318"
  superficie-borda: "rgba(255, 255, 255, 0.09)"
  borda-forte: "rgba(255, 255, 255, 0.16)"
  acento-base: "#6d8cff"
  acento-soft: "rgba(109, 140, 255, 0.14)"
  acento-line: "rgba(109, 140, 255, 0.32)"
  acento-texto: "#9db2ff"
  brilho-b: "#8f7bff"
  brilho-c: "#4f6fe8"
  positivo: "#3ecf8e"
  negativo: "#f2555a"
  atencao: "#e0b341"
  branco: "#f5f5f7"
  cinza-nevoa: "#a1a1aa"
  cinza-apagado: "#6b6b76"
  cinza-tenue: "#45454e"
typography:
  display:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "clamp(1.75rem, 4vw, 2.5rem)"
    fontWeight: 800
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  value:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "clamp(1.75rem, 4vw, 2.25rem)"
    fontWeight: 800
    lineHeight: 1
  title:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "clamp(1.15rem, 2.5vw, 1.5rem)"
    fontWeight: 700
    lineHeight: 1.3
  body:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "clamp(0.75rem, 1.5vw, 0.9rem)"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0.05em"
  micro:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "clamp(0.75rem, 1.5vw, 0.85rem)"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "0.05em"
  pill:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "clamp(0.75rem, 1.2vw, 0.85rem)"
    fontWeight: 500
    lineHeight: 1.3
  caption:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "clamp(0.95rem, 2vw, 1.1rem)"
    fontWeight: 400
    lineHeight: 1.5
  icon:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "1.25rem"
    fontWeight: 700
  code:
    fontFamily: "'Fira Code', 'Monaco', monospace"
    fontSize: "0.9em"
    fontWeight: 400
  display-compact:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "clamp(1.5rem, 5vw, 2rem)"
    fontWeight: 800
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  ui:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "clamp(0.8rem, 1.5vw, 0.9rem)"
    fontWeight: 500
    lineHeight: 1.4
  glyph-empty:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "3rem"
  body-wide:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.6
rounded:
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
spacing:
  sm: "0.5rem"
  md: "1rem"
  lg: "1.5rem"
  xl: "3rem"
surface:
  base: "#000000"
  card: "#0b0b0e"
  cardHover: "#131318"
  border: "rgba(255, 255, 255, 0.09)"
  borderStrong: "rgba(255, 255, 255, 0.16)"
accent:
  base: "#6d8cff"
  soft: "rgba(109, 140, 255, 0.14)"
  line: "rgba(109, 140, 255, 0.32)"
  text: "#9db2ff"
  glowA: "#6d8cff"
  glowB: "#8f7bff"
  glowC: "#4f6fe8"
semantic:
  positive: "#3ecf8e"
  negative: "#f2555a"
  warning: "#e0b341"
motion:
  easeOut: "cubic-bezier(0.16, 1, 0.3, 1)"
  fast: "200ms"
  base: "300ms"
  slow: "600ms"
  borderSpin: "2.5s linear infinite"
components:
  button-primary:
    backgroundColor: "{colors.acento-base}"
    textColor: "#05060a"
    rounded: "{rounded.sm}"
    padding: "0.5rem 1rem"
  button-secondary:
    backgroundColor: "transparent"
    borderColor: "{colors.borda-forte}"
    textColor: "{colors.cinza-nevoa}"
    rounded: "{rounded.sm}"
    padding: "0.5rem 1rem"
  hashtag-pill-active:
    backgroundColor: "{colors.acento-soft}"
    borderColor: "{colors.acento-line}"
    textColor: "{colors.acento-texto}"
    rounded: "{rounded.xl}"
    padding: "0.4rem 0.85rem"
  surface-card:
    backgroundColor: "{colors.superficie-cartao}"
    borderColor: "{colors.superficie-borda}"
    rounded: "{rounded.lg}"
    padding: "1.5rem"
---

# Design System: Hashpanel

## Overview

**Creative North Star: "Preto, e só o essencial em cor"**

O HashPanel é uma página sobre dados. O fundo é preto absoluto, as superfícies são um degrau acima do preto, e a cor aparece apenas onde carrega significado: a hashtag do dia, o número em foco, o estado ativo, a borda viva no hover. Nada compete com o conteúdo.

**Key Characteristics**

**Key Characteristics:**
- Fundo preto absoluto `#000000` — sem aurora, sem ruído, sem gradiente de fundo
- Superfícies um degrau acima do preto (`#0b0b0e`), com borda de 1px a 9% de branco
- Uma cor só de acento (`#6d8cff`), usada como marcação — nunca como decoração
- Borda viva: anel de gradiente giratório (2.5s) só no hover, com luz que transborda
- Tipografia Inter: números em branco puro, sem gradiente — o dado é o destaque
- Cantos contidos (6–12px), pills full-round

## Colors

Paleta noturna elétrica: neutros profundos e translúcidos dão o palco, e um conjunto de gradientes saturados carrega as cores em contextos com papel semântico.

### Primary
- **Indigo-Neon** (#667eea): Cor de identidade. Preenche botões primários (em gradiente com o Violeta-Noite), ícones de cartão, cabeçalhos de tabela, pills ativas de hashtag, foco de hover. Também existe em tons translúcidos: 15% (fundo de pill), 25-35% (hover de linha, thead), 50% (borda da thead).
- **Violeta-Noite** (#764ba2): segunda metade do gradiente de identidade; também halo radial no canto inferior-direito do body em 15%.

### Secondary
- **Magenta-Neon** (#f093fb) / **Coral-Quente** (#f5576c): gradiente secundário `secondary-gradient` para categorias variadas.
- **Céu-Elétrico** (#4facfe) / **Ciano-Brilho** (#00f2fe): `success-gradient` — KPIs de sucesso e indicadores positivos.
- **Rosa-Laser** (#fa709a) / **Amarelo-Sol** (#fee140): `warning-gradient` — KPIs de aviso.
- **Vermelho-Alerta** (#ff6b6b) / (#ee5a6f): `danger-gradient` — Rótulo e estado de erro, estado de danger.

### Neutral
- **Meia-Noite** (#0f0c29): fundo do body; nuun com halos radiais indigo/violeta de 15%.
- **1a1538** (#1a1538): fundo secundário mais claro (segunda camada de profundidade).
- **Vidro-Fundo** (rgba(255,255,255,0.08)): preenchimento padrão de cartões e status-bar; sobe para 13% no hover.
- **Branco** (#ffffff): texto primário e conteúdo de tabela; numerais KPI em gradiente branco→azul-gelo (`#e0e7ff`).
- **Cinza-Nevoa** (#a0aec0): texto secundário, subtítulos, labels.
- **Cinza-Apagado** (#718096): texto mudo; estado mais distante.
- **Borda-Vidro** (rgba(255,255,255,0.1)): borda padrão de cartões, divisores e separadores.
- **Glifo-Vidro** (#ccd6f6): glifo dos chips de vidro fantasma dos KPIs (azul gelo dessaturado, lê sobre vidro sem gritar).
- **Cid-Indigo** (#a9b7de): labels dos cartões KPI em vidro — secundária tingida de indigo em vez de cinza puro.
- **Escuro-Modal** (rgba(0,0,0,0.8)) e **Escuro-Overlays** (rgba(0,0,0,0.3/0.35)): camadas que preenchem o vidro e restauram AA sobre gradientes claros (padrão estabelecido nas regras de contraste).

### Suporte semântico
- **Verde-Status** (#43e97b): ponto de status "conectado" e hashtags inline no conteúdo de toots (`rgba(67,233,123,0.15)` de fundo).
- **Verde-Hover** (#5bff99): hover de hashtag inline.
- **Ciano-Menta** (#38f9d7): segunda ponta do `info-gradient`.
- **Coral-Apagado** (#ee5a6f): segunda ponta do `danger-gradient`.
- **Indigo-Hover** (#8b9cff): hover de links dentro de tabelas e de conteúdo de toots; também a cor do focus ring (outline 2px).
- **Tinta-Tabela** (#0f1424): texto escuro sobre badges de gradiente claro (relevance/trending) onde branco ia a 2.42:1 — motivo documentado.
- **Rosa-Hover** (#ffb3ff): hover de menções em toots.
- **Monte-Acabado** e **Amarelo-Grafico** (rgb(243,202,64)): paleta de bordas dos datasets do Chart.js; cores vivas de *traço* de gráfico, não de texto.

### Named Rules
**A Regra do Preto.** A cor é acionada por estado, nunca por padrão. Em repouso, tudo é preto e cinza: fundo `#000000`, cartão `#0b0b0e`, borda a 9% de branco. Só o hover, o foco e o estado ativo acendem o acento.

**A Regra da Cor Marcada.** A cor nunca pinta uma superfície grande. Ela marca: a hashtag do dia, o número em foco, o pill ativo, a borda viva no hover, a tendência (verde/vermelho). Se um elemento não está dizendo alguma coisa, ele fica em escala de cinza.

**A Regra do Anel.** A borda viva é um anel de 2px recortado por máscara (`content-box` + `exclude`), não uma camada pintada. Por isso a cor aparece **só na borda** — o interior do cartão permanece preto puro.

## Typography

**Display Font:** Inter (fallback system-ui: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif)
**Body Font:** Inter (mesma família, pesos 300–800)
**Code Font:** Fira Code → Monaco → monospace (código em toots; não é webfont-carregada — usa a instalada)

**Character:** Única família, papel cênico: pesos 800 carregam os números e títulos como letreiros (muitas vezes pintados de gradiente via `background-clip: text`), enquanto 400–500 conduzem leitura corrida. Hierarchy vem de peso e gradiente, não de tipos diferentes.

### Hierarchy
- **Display** (800, clamp(1.75rem→2.5rem), 1.2, tracking -0.02em): h1 do dashboard, pintado com `primary-gradient` (texto-transparente); no ≤768px usa o Display-Compact clamp(1.5rem→2rem).
- **Value** (800, clamp(1.75rem→2.25rem), 1): números KPI, em gradiente branco→azul-gelo (#e0e7ff) e hashtags KPI em `primary-gradient`.
- **Title** (700, clamp(1.15rem→1.5rem), 1.3): títulos de cartão de conteúdo (h3), branco sólido.
- **Body** (400, 16px base, 1.6): corpo geral; a base é responsiva — 17px no ≥1400px, 15px no ≤768px, 14px no ≤576px (documentada comoparte do sistema para o painel denso).
- **Caption** (400, clamp(0.95rem→1.1rem), 1.5): parágrafos de cabeçalho do dashboard.
- **Label** (500, fluxo 0.75–0.95rem, tracking 0.05em, UPPERCASE): labels KPI e cabeçalhos de coluna de tabela; família responsiva documentada por clamp — `0.75–0.9rem` (label), `0.75–0.85rem` (micro/badges), `0.8–0.9rem` (botões e status-info), `0.75–0.85rem` (pills).
- **Icon** (700, 1.25rem; 1.1rem no ≤768px): glifo dentro dos chips de vidro e indicadores — tamanho de glifo, não de leitura.
- **Glyph-Empty** (3rem, 50% opacidade): ícone dos estados vazios.
- **UI** (500, clamp(0.8rem→0.9rem), 1.4): textos de controle — botões de refresh, status-info e estados vazios de interface.
- **Code** (Fira Code / Monaco / monospace, 0.9em): código e pre em toots — monospace para código, nunca como fantasia.

### Named Rules
**A Regra do Número.** Números e títulos grandes são brancos puros — nunca gradiente. O gradiente de texto dilui a leitura e compete com o dado. A cor entra só quando o número precisa ser distinguished do resto (a hashtag do dia).

## Layout

Grid bento de 12 colunas com gap 1.25rem, container máximo 1600px, body com padding 1.5rem. Linha superior: faixa de status (grid `1fr auto`; quebra em coluna ≤992px). KPIs ocupam `span 3` cada na linha 1; cartões de conteúdo `span 6` a dois (Top Toots e Trending Tags) ou `span 12` full-width. Ritmo vertical: status 2rem abaixo do header (header com margin 3rem), blocos com margin 2rem abaixo. Padding interno padrão de cartão de 1.5rem; status-bar e daily-hashtags-card mais compactos (1rem 1.5rem). Tabelas com padding de célula generoso (1.25rem 1rem), thead 1rem.

## Elevation & Depth

Profundidade por três camadas, cada uma com um papel e nunca substituindo a outra:

1. **degrau de valor** — a superfície é um degrau mais clara que o fundo (`#0b0b0e` sobre `#000000`). É isso que separa as camadas; não há névoa nem desfoque;
2. **sombra ambiental** — preta, discreta, dá assentamento (`0 1px 2px rgba(0,0,0,0.6)` em repouso; no hover, um par de sombras do acento: uma curta e nítida, outra larga e difusa, que é a luz que transborda);
3. **borda viva** — anel de gradiente giratório de 2px, só no hover, com a mesma luz difusa escapando para fora do cartão.

Regra prática: a luz nunca toca o conteúdo. Ela vive na borda e fora dela.





### Shadow Vocabulary
- **surface** (`0 1px 2px rgba(0,0,0,0.6)`): repouso de toda superfície.
- **surface-hover** (`0 0 12px -2px rgba(109,140,255,0.55)` + `0 0 40px 4px rgba(109,140,255,0.22)`): a luz do hover — um halo curto e nítido mais um largo e difuso, ambos fora da caixa.
- **shadow-xl** (`0 20px 50px rgba(0,0,0,0.6)`): modais e sobreposições.

### Named Rules
**A Regra do Brilho Sussurro.** Nenhum halo zero-spread engrossado: o glow é um aro de 1px (0.28 de repouso, 0.5 no hover) mais uma ambience de raio grande e alpha ≤ 0.1–0.2 — luz que se sussurra, nunca que inunda. Halo não vive sob texto; a rotação do anel conic é ≥10s (deriva, não estroboscópio); `prefers-reduced-motion` desliga tudo.

## Shapes

Identidade geométrica: cantos generosos e frequentemente full-round tokens com significado. Cartões e superfícies usam `radius-lg` (16px); elementos de ação e ícones usam `radius-md` (12px); pills e hashtags são full-round via `radius-xl` (24px) — o formato de "cápsula" signala preview/clique/badge. Chips inline (código e hashtags em toots) e o thumb do scrollbar usam `radius-sm` (8px). Bordas sempre de 1px translúcido (10% branco); a borda neon do hover é construída com anel conic mascarado de 2px, não com border real.

## Components

### Botões
- **Shape:** cantos contidos (6px), altura compacta (padding 0.5rem vertical).
- **Primary:** fundo de acento sólido, texto quase-preto, fonte 600; ícone SVG 16px à esquerda quando presente.
- **Hover / Focus:** o contorno acende em acento; ícone de refresh gira 180deg.
- **Secondary:** fundo transparente, borda a 16% de branco, texto cinza-nevoa; hover clareia o texto.

### Pills (hashtags)
- **Style:** cápsula full-round (24px), fundo transparente, borda a 8% de branco, texto cinza-nevoa 500, ponto-indizador 6px atual.
- **State:** ativa recebe fundo de acento a 14%, borda de acento e texto em acento; hover sobe 1px e clareia; estado de loading é ghost.

### Cards (KPI e conteúdo)
- **Corner Style:** 12px (radius-lg).
- **Background:** `#0b0b0e` sólido, um degrau acima do preto; hover `#131318`.
- **Shadow Strategy:** repouso `0 1px 2px` preto. No hover, a luz: anel de gradiente giratório de 2px (máscara `content-box` + `exclude`) mais duas sombras do acento — uma curta, outra larga e difusa.
- **Border:** 1px a 9% de branco; fica transparente no hover, quando o anel assume.
- **Internal Padding:** 1.5rem KPI/conteúdo; 1rem 1.5rem nos cartões compactos de status.

### Ícones de cartão
- 32px quadrado, 6px de raio, contorno de 1px a 8% de branco, sem preenchimento; emoji ou SVG dentro em cinza apagado.
- indicador de status com glow verde pulsante (pulse 2s infinite).

### Tabelas
- thead transparente com borda inferior de 1px, labels uppercase a 0.09em em cinza apagado.
- Zebra tr em branco 5% / 8%; hover da linha em indigo translúcido 25% com scale(1.01).
- Links internos em indigo-neon; badges de relevância/tendência com cores semânticas dos gradientes.

### Modais
- backdrop escurecido; painel sólido `#0b0b0e` com shadow-xl e radius-lg; footer com separador; botões primary/secondary iguais ao padrão de botões.

## Do's and Don'ts

### Do:
- **Do** manter o fundo em preto absoluto e as superfícies um degrau acima: a hierarquia vem do valor, não da cor.
- **Do** usar o acento só para marcar: hashtag do dia, pill ativo, borda viva, tendência.
- **Do** manter os números em branco puro, com `font-variant-numeric: tabular-nums` para alinhamento em coluna.
- **Do** recortar a borda viva com máscara (`content-box` + `exclude`) para a cor ficar **só na borda**.
- **Do** manter toda a copy em pt-BR com voz comunitária.

### Don't:
- **Don't** pintar superfície com cor: se o elemento não está dizendo nada, ele fica em escala de cinza.
- **Don't** usar gradiente em texto de leitura nem em número — dilui o dado.
- **Don't** usar `transform` para elevar um cartão que tem pseudo-camadas com `z-index: -1`: o transform cria um contexto de empilhamento e prende as camadas dentro do cartão. Use `top`.
- **Don't** aplicar aura colorida em texto ou sobre o conteúdo — a luz vive na borda e fora dela.
- **Don't** inventar cores fora do acento e das três semânticas.
