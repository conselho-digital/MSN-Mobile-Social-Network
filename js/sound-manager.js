/* ============================================================
   sound-manager.js
   Reprodução dos efeitos sonoros clássicos do MSN.
   Os arquivos .mp3 ficam em assets/sounds/. Se não existirem,
   as falhas são silenciosas (não quebram o app).
   ============================================================ */

const SoundManager = (() => {
  const sounds = {
    login: "assets/sounds/login.mp3",
    message: "assets/sounds/message.mp3",
    nudge: "assets/sounds/nudge.mp3",
    logout: "assets/sounds/logout.mp3",
  };

  const cache = {};
  let enabled = true;

  function preload() {
    Object.entries(sounds).forEach(([key, src]) => {
      const audio = new Audio(src);
      audio.preload = "auto";
      cache[key] = audio;
    });
  }

  function play(name) {
    if (!enabled) return;
    const src = sounds[name];
    if (!src) return;
    try {
      const audio = cache[name] ? cache[name].cloneNode() : new Audio(src);
      audio.volume = 0.7;
      const p = audio.play();
      if (p && p.catch) p.catch(() => {}); // ignora bloqueio de autoplay
    } catch (_) { /* silencioso */ }
  }

  const setEnabled = (v) => { enabled = Boolean(v); };

  return { preload, play, setEnabled };
})();
