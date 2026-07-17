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
  };

  // A propriedade "volume" de <audio> trava em 1.0 (100%) — não tem
  // como pedir mais alto que isso por ali. Pra tocar de verdade acima
  // do volume "cheio" do arquivo original, precisa da Web Audio API
  // (um GainNode aplica o ganho por cima do áudio decodificado, sem
  // esse teto). 2 = dobro da amplitude (~+6dB).
  const VOLUME_GAIN = 2;

  const buffers = {};
  let ctx = null;
  let enabled = true;

  function getContext() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    if (!ctx) ctx = new Ctx();
    // Navegadores só deixam o áudio rodar de verdade depois de algum
    // gesto do usuário na página — "resume()" aqui não força nada
    // sozinho, só religa assim que o primeiro clique/toque acontecer.
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    return ctx;
  }

  // Baixa e decodifica os 3 sons uma vez só, guardados prontos pra
  // tocar na hora (sem esperar rede) — se um arquivo não existir ou
  // não decodificar, só aquele fica de fora (os outros continuam
  // funcionando) e play() cai no <audio> comum como reserva.
  async function preload() {
    const context = getContext();
    if (!context) return;
    await Promise.all(
      Object.entries(sounds).map(async ([key, src]) => {
        try {
          const res = await fetch(src);
          const arrayBuffer = await res.arrayBuffer();
          buffers[key] = await context.decodeAudioData(arrayBuffer);
        } catch (_) { /* fica de fora do cache; play() usa o reserva */ }
      })
    );
  }

  function play(name) {
    if (!enabled) return;
    const src = sounds[name];
    if (!src) return;

    const context = getContext();
    const buffer = context && buffers[name];
    if (context && buffer) {
      try {
        const source = context.createBufferSource();
        source.buffer = buffer;
        const gain = context.createGain();
        gain.gain.value = VOLUME_GAIN;
        source.connect(gain);
        gain.connect(context.destination);
        source.start(0);
        return;
      } catch (_) { /* cai pro reserva abaixo */ }
    }

    // Reserva (Web Audio indisponível, ou o preload ainda não
    // terminou de decodificar esse som): toca no volume máximo do
    // <audio> comum — sem o dobro de ganho, mas ainda toca.
    try {
      const audio = new Audio(src);
      audio.volume = 1;
      const p = audio.play();
      if (p && p.catch) p.catch(() => {}); // ignora bloqueio de autoplay
    } catch (_) { /* silencioso */ }
  }

  const setEnabled = (v) => { enabled = Boolean(v); };

  return { preload, play, setEnabled };
})();
