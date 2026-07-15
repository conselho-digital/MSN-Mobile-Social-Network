/* ============================================================
   scenes.js
   Catálogo de cenários (fundo do topo do Dashboard) e suas cores
   de tema pareadas. Compartilhado entre dashboard.js (que pinta o
   Dashboard) e app.js (que aplica a mesma cor na tela de login,
   por conta, quando ela é selecionada no dropdown de e-mails).
   ============================================================ */

const MSNScenes = (() => {
  // Cada cenário também tem uma "theme" (cor de tema) pareada, que tinge
  // o restante da tela abaixo do banner — igual ao MSN clássico, onde a
  // cor de baixo nem sempre é a mesma do banner (ex.: cenário rosa
  // combinado com tema verde). O cenário (imagem/degradê) só pinta a
  // parte de CIMA (do cabeçalho até a barra de busca); a cor de tema
  // continua pintando tudo abaixo da busca, sem mudanças.
  //
  // "image" é opcional: aponta para assets/scenes/<id>.jpg. Se o
  // arquivo ainda não foi enviado, o degradê de "css" aparece no lugar
  // (a imagem é apenas uma camada por cima do degradê — ver bg()).
  const SCENES = [
    { id: "green",  name: "Verde",     css: "linear-gradient(120deg,#0a0f0a 0%,#12240d 45%,#1f4a17 78%,#37731f 100%)", theme: "#3aa11a", image: "assets/scenes/green.jpg" },
    { id: "blue",   name: "Azul",      css: "linear-gradient(120deg,#08203a 0%,#0e3a63 50%,#1f6fb0 100%)", theme: "#1f7fd0", image: "assets/scenes/blue.jpg" },
    { id: "aero",   name: "Aero",      css: "linear-gradient(120deg,#0a3a5a 0%,#1f7fb0 50%,#8fd0f0 100%)", theme: "#2bb0e0", image: "assets/scenes/aero.jpg" },
    { id: "purple", name: "Roxo",      css: "linear-gradient(120deg,#1a0a2a 0%,#3a1560 55%,#7b3fd0 100%)", theme: "#7b3fd0", image: "assets/scenes/purple.jpg" },
    { id: "pink",   name: "Rosa",      css: "linear-gradient(120deg,#2a0a1a 0%,#8a1e55 55%,#e05a9a 100%)", theme: "#3aa11a", image: "assets/scenes/pink.jpg" },
    { id: "sunset", name: "Pôr do sol", css: "linear-gradient(120deg,#3a1010 0%,#a03a1a 50%,#e0902a 100%)", theme: "#e0902a", image: "assets/scenes/sunset.jpg" },
    { id: "teal",   name: "Turquesa",  css: "linear-gradient(120deg,#04201f 0%,#0a4a47 55%,#1f9e94 100%)", theme: "#1f9e94", image: "assets/scenes/teal.jpg" },
    { id: "graphite", name: "Grafite", css: "linear-gradient(120deg,#0a0a0a 0%,#242424 60%,#3d3d3d 100%)", theme: "#6b7280", image: "assets/scenes/graphite.jpg" },
    { id: "royal",  name: "Royal",     css: "linear-gradient(120deg,#0a1444 0%,#1c2f8a 55%,#3f6fe0 100%)", theme: "#3f6fe0", image: "assets/scenes/royal.jpg" },
  ];

  function find(id) {
    return SCENES.find((s) => s.id === id);
  }
  // Valor bruto do degradê (sem a imagem) — usado como fallback.
  function css(id) {
    const s = find(id);
    return s ? s.css : SCENES[0].css;
  }
  // Fundo completo pronto para usar em `background`: a imagem (se
  // existir) por cima do degradê, para que uma imagem ainda não
  // enviada simplesmente não apareça e o degradê continue visível.
  //
  // Importante: quando este valor é aplicado como custom property via
  // JS (element.style.setProperty("--scene", ...)) e consumido por uma
  // regra em css/style.css (var(--scene)), o navegador resolve url()
  // relativas com base no CSS onde o var() é USADO — não em onde a
  // propriedade foi definida nem na página atual. Por isso resolvemos
  // a URL de forma absoluta aqui (via document.baseURI), senão o
  // caminho quebraria (viraria algo como "css/assets/scenes/...").
  function resolveUrl(path) {
    try { return new URL(path, document.baseURI).href; } catch (_) { return path; }
  }
  function bg(id) {
    const s = find(id) || SCENES[0];
    if (s.image) {
      // Aspas simples: este valor é usado dentro de um atributo HTML
      // style="..." (aspas duplas) ao montar as miniaturas do seletor
      // de cenário — aspas duplas aqui colidiriam com o atributo.
      return "url('" + resolveUrl(s.image) + "') center/cover no-repeat, " + s.css;
    }
    return s.css;
  }
  function theme(id) {
    const s = find(id);
    return (s && s.theme) || SCENES[0].theme;
  }
  // Só a URL absoluta da imagem do cenário (sem o degradê), ou null se
  // este cenário não tiver imagem configurada. Usado pela tela de login
  // para montar sua própria camada de fundo (com posição/tamanho
  // próprios, diferentes do cabeçalho do Dashboard).
  function image(id) {
    const s = find(id);
    return s && s.image ? resolveUrl(s.image) : null;
  }

  // Mistura uma cor hex com branco (0 = cor pura, 1 = branco puro).
  function pastel(hex, whiteRatio) {
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const mix = (c) => Math.round(c + (255 - c) * whiteRatio);
    return "rgb(" + mix(r) + "," + mix(g) + "," + mix(b) + ")";
  }

  // ------------------------------------------------------------
  // Esquema de cores: escolha INDEPENDENTE do cenário (a segunda
  // seção do diálogo clássico "Selecione um esquema de cores").
  // Guardado em profiles.color_scheme. Enquanto for null, o app usa
  // a cor pareada automaticamente ao cenário (theme(id) acima).
  // Só 8 cores aqui para caberem numa linha só — "Mais cores..." abre
  // o seletor nativo (input type=color), e aí color_scheme guarda o
  // hex escolhido diretamente (ver colorSchemeHex abaixo).
  // ------------------------------------------------------------
  const COLOR_SCHEMES = [
    { id: "graphite", hex: "#3d3d3d" },
    { id: "blue",     hex: "#4a90d9" },
    { id: "lavender", hex: "#8f7fd6" },
    { id: "teal",     hex: "#3fc1c9" },
    { id: "green",    hex: "#5cb85c" },
    { id: "yellow",   hex: "#e8c547" },
    { id: "orange",   hex: "#e08a3c" },
    { id: "pink",     hex: "#e07ab8" },
  ];
  // Aceita tanto um id da paleta acima quanto um hex direto (#rrggbb),
  // vindo do seletor nativo "Mais cores...".
  function colorSchemeHex(id) {
    if (!id) return null;
    if (id.charAt(0) === "#") return id;
    const c = COLOR_SCHEMES.find((x) => x.id === id);
    return c ? c.hex : null;
  }
  // Cor de tema efetiva: o esquema de cores escolhido manualmente, se
  // houver; senão a cor pareada automaticamente ao cenário.
  function effectiveTheme(sceneId, colorSchemeId) {
    return colorSchemeHex(colorSchemeId) || theme(sceneId);
  }

  return {
    list: SCENES, find, css, bg, theme, image, pastel,
    colorSchemes: COLOR_SCHEMES, colorSchemeHex, effectiveTheme,
  };
})();
