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
  // combinado com tema verde).
  const SCENES = [
    { id: "green",  name: "Verde",     css: "linear-gradient(120deg,#0a0f0a 0%,#12240d 45%,#1f4a17 78%,#37731f 100%)", theme: "#3aa11a" },
    { id: "blue",   name: "Azul",      css: "linear-gradient(120deg,#08203a 0%,#0e3a63 50%,#1f6fb0 100%)", theme: "#1f7fd0" },
    { id: "aero",   name: "Aero",      css: "linear-gradient(120deg,#0a3a5a 0%,#1f7fb0 50%,#8fd0f0 100%)", theme: "#2bb0e0" },
    { id: "purple", name: "Roxo",      css: "linear-gradient(120deg,#1a0a2a 0%,#3a1560 55%,#7b3fd0 100%)", theme: "#7b3fd0" },
    { id: "pink",   name: "Rosa",      css: "linear-gradient(120deg,#2a0a1a 0%,#8a1e55 55%,#e05a9a 100%)", theme: "#3aa11a" },
    { id: "sunset", name: "Pôr do sol", css: "linear-gradient(120deg,#3a1010 0%,#a03a1a 50%,#e0902a 100%)", theme: "#e0902a" },
    { id: "teal",   name: "Turquesa",  css: "linear-gradient(120deg,#04201f 0%,#0a4a47 55%,#1f9e94 100%)", theme: "#1f9e94" },
    { id: "graphite", name: "Grafite", css: "linear-gradient(120deg,#0a0a0a 0%,#242424 60%,#3d3d3d 100%)", theme: "#6b7280" },
    { id: "royal",  name: "Royal",     css: "linear-gradient(120deg,#0a1444 0%,#1c2f8a 55%,#3f6fe0 100%)", theme: "#3f6fe0" },
  ];

  function find(id) {
    return SCENES.find((s) => s.id === id);
  }
  function css(id) {
    const s = find(id);
    return s ? s.css : SCENES[0].css;
  }
  function theme(id) {
    const s = find(id);
    return (s && s.theme) || SCENES[0].theme;
  }

  // Mistura uma cor hex com branco (0 = cor pura, 1 = branco puro).
  function pastel(hex, whiteRatio) {
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const mix = (c) => Math.round(c + (255 - c) * whiteRatio);
    return "rgb(" + mix(r) + "," + mix(g) + "," + mix(b) + ")";
  }

  return { list: SCENES, find, css, theme, pastel };
})();
