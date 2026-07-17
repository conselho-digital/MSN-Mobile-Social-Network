/* ============================================================
   dashboard.js
   Lista de contatos: perfil próprio, contatos agrupados por
   status, edição de nome/mensagem pessoal, busca e logout.
   ============================================================ */

const Dashboard = (() => {
  const STATUS_LABEL = {
    online: "Disponível",
    busy: "Ocupado",
    away: "Ausente",
    invisible: "Invisível",
    offline: "Offline",
  };
  // Pra quem está vendo — nunca pro dono da conta (profile.status
  // continua mostrando "Invisível" de verdade só pra ele mesmo, ver
  // renderProfile) — um contato invisível deve aparecer exatamente
  // como offline: mesmo rótulo, mesma cor de moldura, mesma posição
  // na lista (grupo "Offline"). Ponto único de normalização pra não
  // vazar o status real em algum lugar novo no futuro.
  //
  // Além disso, se o contato não tem NENHUM aparelho/aba com conexão
  // em tempo real ativa agora (ver presenceOnlineIds/subscribePresence
  // em supabase-client.js), força "offline" mesmo que profiles.status
  // ainda diga "online" — isso cobre internet caindo, aba fechando ou
  // logout, casos em que ninguém atualiza a coluna status "avisando"
  // que ficou offline (a conexão simplesmente para de existir).
  function contactVisibleStatus(status, contactId) {
    // Prioridade máxima: quem me bloqueou, ou quem eu escolhi "aparecer
    // offline" no menu de segurar apertado, sempre me vê offline — não
    // é sobre conectividade, é uma escolha deliberada (minha ou dele)
    // que não pode ser sobreposta por presença/status real (ver
    // forcedOfflineReasons/get_forced_offline_contacts em
    // supabase/contact_settings.sql).
    if (contactId && forcedOfflineReasons.has(String(contactId))) return "offline";
    if (status === "invisible") return "offline";
    if (presenceReady && contactId && !presenceOnlineIds.has(String(contactId))) return "offline";
    return status;
  }
  // contact_id (string) -> "blocked" | "appear_offline", carregado uma
  // vez no load() (ver refreshForcedOffline) — "blocked" quer dizer que
  // ESSE contato me bloqueou (não o contrário).
  let forcedOfflineReasons = new Map();
  async function refreshForcedOffline() {
    try {
      const rows = await MSNSupabase.getForcedOfflineContacts();
      const map = new Map();
      (rows || []).forEach((r) => {
        // "blocked" tem prioridade sobre "appear_offline" se as duas
        // razões existirem ao mesmo tempo pro mesmo contato — não muda
        // o resultado visível (as duas viram "offline" do mesmo jeito),
        // só a mensagem do banner amarelo (ver renderChatHeader).
        const prev = map.get(r.contact_id);
        if (!prev || r.reason === "blocked") map.set(r.contact_id, r.reason);
      });
      forcedOfflineReasons = map;
    } catch (_) {}
  }
  // Gradiente/animação da moldura da foto por status — compartilhado
  // com a tela de login em js/scenes.js (MSNScenes.frameGradient /
  // MSNScenes.updateStatusFrame).
  const frameGradient = MSNScenes.frameGradient;

  // Foto de exibição padrão (bonequinho clássico, compartilhada com a
  // tela de login em js/scenes.js) e galeria de exemplos prontos
  // ("Selecione uma Imagem para Exibição", igual ao Messenger).
  const DEFAULT_AVATAR = MSNScenes.defaultAvatar;
  const AVATAR_GALLERY = Array.from({ length: 30 }, (_, i) => "assets/avatars/profile" + (i + 1) + ".webp");

  // Cenários (fundo do topo) e cores de tema: catálogo compartilhado
  // em js/scenes.js (usado também pela tela de login).
  const SCENES = MSNScenes.list;
  const sceneBg = MSNScenes.bg;
  const pastel = MSNScenes.pastel;

  // Cenário "custom" (enviado pela pessoa via "Procurar...") não está
  // no catálogo fixo — usa a URL enviada em vez de procurar por id.
  // Sempre inclui a camada de tingimento (transparente aqui — só o
  // cenário padrão Céu Azul é recolorido, ver MSNScenes.bg) pra manter
  // a mesma contagem de camadas que background-blend-mode espera.
  function resolveSceneBg(sceneId, customUrl, tintHex) {
    if (sceneId === "custom" && customUrl) {
      return "linear-gradient(transparent,transparent), url('" + customUrl + "') center/cover no-repeat, " + SCENES[0].css;
    }
    return sceneBg(sceneId, tintHex);
  }

  // ---------- Contraste automático do texto do cabeçalho ----------
  // O nome/status/mensagem pessoal ficam ilegíveis em cenários claros
  // (ex.: "Grafite Urbano", parede de concreto). Em vez de fixar cor
  // por cenário, mede o brilho médio da imagem (canvas) e alterna a
  // classe "is-light-scene" no cabeçalho — funciona também para
  // cenários customizados enviados pela pessoa.
  // Um token por cabeçalho (não um só global) — o do Dashboard e o da
  // janela de conversa amostram fotos diferentes ao mesmo tempo às
  // vezes (ex.: abrir uma conversa logo após o Dashboard carregar), e
  // um token compartilhado faria um cancelar o resultado do outro.
  const brightnessTokens = new WeakMap();
  function sampleBrightness(url, cb) {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const w = 16, h = 16;
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        const data = ctx.getImageData(0, 0, w, h).data;
        let sum = 0, count = 0;
        for (let i = 0; i < data.length; i += 4) {
          sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          count++;
        }
        cb(sum / count);
      } catch (_) {
        cb(null); // canvas contaminado (sem CORS) — não dá pra medir
      }
    };
    img.onerror = () => cb(null);
    img.src = url;
  }
  // "header" é o elemento de verdade (.dash-header ou .chat-header) —
  // reaproveitado pelos dois, cada um com seu próprio token acima.
  function updateHeaderTextContrast(header, sceneId, customUrl) {
    if (!header) return;
    const url = sceneId === "custom" && customUrl ? customUrl : MSNScenes.image(sceneId);

    // Pré-calculado (ver isLight em scenes.js), aplica na hora — sem
    // isso o texto ficava branco (ilegível em cenários claros) por um
    // instante toda vez que o cabeçalho carregava, até a amostragem
    // abaixo (que depende de baixar a foto) terminar.
    const known = MSNScenes.isLightScene(sceneId);
    if (known !== null) header.classList.toggle("is-light-scene", known);

    const token = (brightnessTokens.get(header) || 0) + 1;
    brightnessTokens.set(header, token);
    if (!url) {
      header.classList.remove("is-light-scene");
      return;
    }
    // Continua rodando por cima do valor pré-calculado — é o único
    // jeito de saber a resposta certa pra cenário customizado (imagem
    // enviada pela pessoa, sem isLight fixo), e serve de conferência
    // pros demais.
    sampleBrightness(url, (avg) => {
      if (brightnessTokens.get(header) !== token || avg === null) return;
      header.classList.toggle("is-light-scene", avg > 150);
    });
  }

  let profile = null;
  let contacts = [];
  let groups = [];
  let bound = false;
  let currentFilter = "";
  let contactsSubscribed = false;
  // Quem tem pelo menos um aparelho/aba com conexão em tempo real
  // ativa agora (ver subscribePresence em supabase-client.js).
  // "presenceReady" começa false pra não piscar todo mundo "offline"
  // antes da primeira sincronização chegar — até lá, contactVisibleStatus
  // confia só em profiles.status, igual antes desse recurso existir.
  let presenceOnlineIds = new Set();
  let presenceReady = false;
  // IDs de quem esta conta bloqueou — usado só pra filtrar a lista
  // principal quando "Mostrar contatos bloqueados" (Opções > Layout)
  // estiver desligado (ver renderContacts).
  let blockedContactIds = new Set();
  async function refreshBlockedIds() {
    try {
      const blocked = await MSNSupabase.getBlockedUsers();
      blockedContactIds = new Set((blocked || []).map((p) => String(p.id)));
    } catch (_) {}
  }

  /* ---------- Registro de dropdowns ----------
     Menu do nick, "Adicionar" e "Modo de exibição" são independentes
     entre si — sem isso, dava pra abrir dois ao mesmo tempo (abrir um
     não fechava o outro que já estava aberto). Cada dropdown registra
     sua própria função de fechar aqui; abrir qualquer um deles fecha
     todos os outros primeiro. */
  const openDropdownClosers = [];
  function registerDropdown(closeFn) {
    openDropdownClosers.push(closeFn);
  }
  function closeOtherDropdowns(exceptCloseFn) {
    openDropdownClosers.forEach((close) => { if (close !== exceptCloseFn) close(); });
  }

  /* ---------- "Ausente" automático por inatividade ----------
     Preferência local (não depende de coluna nova no Supabase — só
     controla o comportamento deste dispositivo, como "Modo de
     exibição"). Fica "away" sozinho depois de X minutos sem nenhuma
     interação NA TELA DO DASHBOARD (não existe tela de conversa ainda
     — quando existir, este mesmo checkOnce() já vai parar de contar
     assim que a pessoa sair do Dashboard). Qualquer troca de status
     manual pelo menu do nick cancela o auto-away e volta a valer. */
  let autoAwayEnabled = true;
  let autoAwayMinutes = 5;
  let isAutoAway = false;
  let lastActivityAt = Date.now();

  function loadAutoAwayPrefs() {
    try {
      const raw = localStorage.getItem("msn:autoAwayEnabled");
      autoAwayEnabled = raw === null ? true : raw === "true";
      const mins = parseInt(localStorage.getItem("msn:autoAwayMinutes"), 10);
      if (mins > 0) autoAwayMinutes = mins;
    } catch (_) {}
  }
  function saveAutoAwayPrefs() {
    try {
      localStorage.setItem("msn:autoAwayEnabled", String(autoAwayEnabled));
      localStorage.setItem("msn:autoAwayMinutes", String(autoAwayMinutes));
    } catch (_) {}
  }

  function markActivity() {
    lastActivityAt = Date.now();
  }

  function isDashboardActive() {
    const screen = document.getElementById("screen-dashboard");
    return !!screen && screen.classList.contains("screen--active");
  }

  function checkAutoAway() {
    if (!autoAwayEnabled || !profile || isAutoAway) return;
    if (!isDashboardActive()) return;
    if (profile.status !== "online") return;
    const idleMs = Date.now() - lastActivityAt;
    if (idleMs < autoAwayMinutes * 60 * 1000) return;

    isAutoAway = true;
    profile.status = "away";
    renderProfile();
    MSNSupabase.updateMyProfile({ status: "away" }).catch(() => {});
  }

  function startIdleWatch() {
    loadAutoAwayPrefs();
    ["click", "touchstart", "keydown", "mousemove", "scroll"].forEach((evt) =>
      document.addEventListener(evt, markActivity, { passive: true }));
    setInterval(checkAutoAway, 15000);
  }

  // Foto de exibição: a enviada/escolhida, ou assets/avatars/standard.webp
  // como padrão (mesmo desenho do bonequinho clássico do MSN).
  function avatarMarkup(url) {
    return '<img class="avatar-img" src="' + esc(url || DEFAULT_AVATAR) + '" alt="" />';
  }

  // Moldura com a cor do status (compartilhada entre a foto do cabeçalho
  // e os avatares da lista de contatos — ver .status-frame* no CSS).
  function statusFrameMarkup(avatarUrl, status) {
    return (
      '<span class="status-frame__photo" data-avatar-url="' + esc(avatarUrl || "") + '">' +
      avatarMarkup(avatarUrl) +
      "</span>" +
      '<span class="status-frame__ring" aria-hidden="true">' +
      '<span class="status-frame__tint" style="background:' + frameGradient(status) +
      '" data-status="' + esc(status) + '"></span>' +
      '<span class="status-frame__tint--next"></span>' +
      '<img src="assets/avatars/login.webp" class="status-frame__luma" alt="" />' +
      "</span>"
    );
  }

  const updateStatusFrame = MSNScenes.updateStatusFrame;

  // Ícone "bonequinho" clássico — um dos modos de exibição do avatar
  // (Opções > Layout / dropdown "Modo de exibição"), recolorido via
  // CSS conforme o status (ver .contact-classic-icon).
  function classicIconMarkup(status) {
    return '<span class="contact-classic-icon" data-status="' + esc(status) + '" aria-hidden="true"></span>';
  }

  // Ícone de status "pequeno" — o mesmo usado no dropdown "Entrar
  // como:" da tela de login (ver .signin-as .status-dot), reaproveitado
  // como avatar em miniatura no modo de exibição "tiny".
  function statusIconMarkup(status) {
    return '<span class="contact-status-icon-img" data-status="' + esc(status) + '" aria-hidden="true"></span>';
  }

  // Arrastar o banner do cenário pra baixo recarrega a página — um
  // gesto de "puxar para atualizar" restrito só a essa área (não à
  // lista de contatos nem ao resto da tela), pra não competir com a
  // rolagem normal em nenhum outro lugar.
  function bindSceneBannerPullToRefresh() {
    const header = document.querySelector(".dash-header");
    if (!header) return;
    const THRESHOLD = 70;
    let startY = null;
    let dragging = false;

    header.addEventListener("touchstart", (e) => {
      if (e.touches.length !== 1) return;
      startY = e.touches[0].clientY;
      dragging = true;
    }, { passive: true });

    header.addEventListener("touchmove", (e) => {
      if (!dragging || startY === null) return;
      const delta = e.touches[0].clientY - startY;
      header.style.transform = delta > 0 ? "translateY(" + Math.min(delta * 0.4, 50) + "px)" : "";
    }, { passive: true });

    const endDrag = (e) => {
      if (!dragging) return;
      dragging = false;
      const touch = e.changedTouches && e.changedTouches[0];
      const delta = touch && startY !== null ? touch.clientY - startY : 0;
      header.style.transform = "";
      startY = null;
      if (delta > THRESHOLD) location.reload();
    };
    header.addEventListener("touchend", endDrag);
    header.addEventListener("touchcancel", endDrag);
  }

  function esc(s) {
    return String(s || "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  /* ---------- Compressão de imagem antes do envio ----------
     Em vez de simplesmente recusar uma foto grande demais, tenta
     reduzir ela (via <canvas>) até caber no limite — recomprime pra
     WEBP (que já costuma sair bem menor que JPEG/PNG na mesma
     qualidade visual) e, se ainda não couber, vai diminuindo a
     qualidade e depois as dimensões, algumas vezes, até caber ou
     desistir e devolver o melhor resultado que conseguiu. */
  const UPLOAD_HARD_LIMIT_BYTES = 20 * 1024 * 1024; // acima disso nem tenta processar
  const COMPRESS_MAX_DIM = 1600; // lado maior, em pixels
  const COMPRESS_EXT_BY_TYPE = { "image/webp": "webp", "image/jpeg": "jpg", "image/png": "png" };

  function loadImageBitmapFrom(file) {
    if (window.createImageBitmap) {
      return createImageBitmap(file).catch(() => loadImageViaTag(file));
    }
    return loadImageViaTag(file);
  }
  function loadImageViaTag(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Não foi possível ler a imagem.")); };
      img.src = url;
    });
  }
  function canvasToBlob(source, width, height, quality) {
    return new Promise((resolve, reject) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(source, 0, 0, width, height);
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("Não foi possível processar a imagem."))),
        "image/webp",
        quality
      );
    });
  }

  // Só comprime se precisar (arquivo já cabe no limite = devolve como
  // veio). Se qualquer etapa falhar (navegador sem suporte a
  // canvas.toBlob("image/webp", ...), por exemplo), devolve o arquivo
  // original — quem chamou decide se tenta enviar assim mesmo.
  async function compressImageIfNeeded(file, maxBytes) {
    if (file.size <= maxBytes) return file;
    const source = await loadImageBitmapFrom(file);
    let width = source.width || source.naturalWidth;
    let height = source.height || source.naturalHeight;
    if (!width || !height) return file;
    if (width > COMPRESS_MAX_DIM || height > COMPRESS_MAX_DIM) {
      const scale = COMPRESS_MAX_DIM / Math.max(width, height);
      width = Math.round(width * scale);
      height = Math.round(height * scale);
    }
    let quality = 0.85;
    let blob = await canvasToBlob(source, width, height, quality);
    let attempts = 0;
    while (blob.size > maxBytes && attempts < 6) {
      attempts++;
      if (quality > 0.5) {
        quality -= 0.15;
      } else {
        width = Math.round(width * 0.8);
        height = Math.round(height * 0.8);
      }
      blob = await canvasToBlob(source, width, height, quality);
    }
    const ext = COMPRESS_EXT_BY_TYPE[blob.type] || "jpg";
    const baseName = (file.name || "imagem").replace(/\.[^.]+$/, "");
    return new File([blob], baseName + "." + ext, { type: blob.type });
  }

  /* ---------- Abre o dashboard ---------- */
  async function show() {
    UIManager.showScreen("screen-dashboard");
    if (!bound) { bindEvents(); bound = true; }
    await load();
  }

  async function load() {
    try {
      let chatBgRows;
      [profile, contacts, groups, , , chatBgRows] = await Promise.all([
        MSNSupabase.getMyProfile(),
        MSNSupabase.getContacts(),
        MSNSupabase.getGroups(),
        refreshBlockedIds(),
        refreshForcedOffline(),
        MSNSupabase.getChatBackgrounds().catch(() => []),
      ]);
      mergeChatBackgroundsFromServer(chatBgRows);
      // Aplica o status escolhido na tela de login, se houver
      const chosen = sessionStorage.getItem("msn:status");
      if (chosen && profile && profile.status !== chosen) {
        profile.status = chosen;
        MSNSupabase.updateMyProfile({ status: chosen }).catch(() => {});
      }
      renderProfile();
      renderGroupShells();
      renderContacts(currentFilter);
      subscribeContactUpdates();
      subscribePresenceUpdates();
      maybeRequestNotificationPermission();
    } catch (err) {
      console.error("Falha ao carregar o dashboard:", err);
    }
  }

  // Só notificações são pedidas de forma proativa, e só ao abrir o
  // Dashboard (nunca nas telas de login/cadastro) — e só se o
  // dispositivo ainda não tiver decidido nada ("default"). Câmera,
  // microfone, localização e armazenamento só são pedidos quando a
  // pessoa liga manualmente em Opções > Alertas, ou quando o recurso
  // que precisa deles for usado de verdade.
  let notificationPermissionRequested = false;
  function maybeRequestNotificationPermission() {
    if (typeof Notification === "undefined") return;
    if (Notification.permission !== "default") return;
    // Marca antes de perguntar (não depois que a promise resolve) —
    // a resposta pode demorar (a pessoa pode nem responder na hora), e
    // Notification.permission só muda quando ela responde. Sem essa
    // trava, chamar load() de novo nesse meio-tempo perguntaria duas
    // vezes.
    if (notificationPermissionRequested) return;
    notificationPermissionRequested = true;
    Notification.requestPermission().catch(() => {});
  }

  // Escuta em tempo real mudanças de status/nome/foto dos contatos já
  // adicionados, pra lista (e a cor da moldura) atualizar sozinha —
  // só assina uma vez por sessão.
  function subscribeContactUpdates() {
    if (contactsSubscribed) return;
    contactsSubscribed = true;
    MSNSupabase.subscribeContacts((updated) => {
      const c = contacts.find((x) => x.id === updated.id);
      if (!c) return; // não é um dos nossos contatos, ignora
      // O tempo real lê "profiles" direto (sem passar pela máscara de
      // get_contact_profiles(), ver getContacts() em
      // supabase-client.js) — se esse contato me bloqueou, ignora foto/
      // cenário/cor do tema vindos por aqui, senão a atualização "ao
      // vivo" vazaria por essa porta mesmo com o carregamento inicial
      // mascarado.
      const masked = { ...updated };
      if (forcedOfflineReasons.get(String(updated.id)) === "blocked") {
        delete masked.avatar_url;
        delete masked.scene;
        delete masked.color_scheme;
        delete masked.scene_image_url;
        delete masked.sub_nick;
      }
      Object.assign(c, masked);
      renderContacts(currentFilter);
      if (currentChatContact && currentChatContact.id === c.id) renderChatHeader();
    });
  }

  let presenceSubscribed = false;
  // Assina o canal de presença (ver subscribePresence em
  // supabase-client.js) — cada sincronização traz a lista atual de
  // quem tem pelo menos uma conexão em tempo real ativa agora, usada
  // por contactVisibleStatus pra forçar "offline" em quem perdeu a
  // conexão de verdade (internet caiu, aba fechou, deslogou) mesmo que
  // profiles.status ainda diga outra coisa.
  function subscribePresenceUpdates() {
    if (presenceSubscribed) return;
    presenceSubscribed = true;
    MSNSupabase.subscribePresence((onlineIds) => {
      // Só depois da primeira sincronização (senão soaria um "login"
      // pra cada contato que já estava online ao abrir o Dashboard).
      if (presenceReady) {
        const newlyOnline = [...onlineIds].filter((id) => !presenceOnlineIds.has(id));
        notifyContactsCameOnline(newlyOnline);
      }
      presenceOnlineIds = onlineIds;
      presenceReady = true;
      renderContacts(currentFilter);
      if (currentChatContact) renderChatHeader();
    }).catch(() => {});
  }

  // Som de "entrou" (reaproveita o mesmo áudio do login, ver
  // sound-manager.js) quando um contato meu fica online — respeita
  // "silenciar notificações desse contato" e nunca toca pra quem está
  // em forcedOfflineReasons (me bloqueou, ou aparece offline pra mim de
  // propósito — nesses casos nem deveria "aparecer" ficando online).
  function notifyContactsCameOnline(newlyOnlineIds) {
    if (!newlyOnlineIds || !newlyOnlineIds.length) return;
    const anyAudible = newlyOnlineIds.some((id) => {
      const c = contacts.find((x) => String(x.id) === String(id));
      if (!c || c.is_muted) return false;
      if (forcedOfflineReasons.has(String(id))) return false;
      return true;
    });
    if (anyAudible) SoundManager.play("login");
  }

  /* ---------- Perfil próprio ---------- */
  function renderProfile() {
    if (!profile) return;
    const status = profile.status || "online";
    document.getElementById("my-name-text").textContent = profile.display_name || "Sem nome";
    document.getElementById("my-status-label").textContent = STATUS_LABEL[status] || "Disponível";

    const avatar = document.querySelector(".my-avatar");
    if (avatar) {
      const ring = avatar.querySelector(".status-frame__ring");
      if (!ring) {
        // Primeira renderização: monta a moldura inteira.
        avatar.innerHTML = statusFrameMarkup(profile.avatar_url, status);
      } else {
        // Já existe: só atualiza a cor (com a onda) e a foto se mudou.
        updateStatusFrame(ring, status);
        const photoWrap = avatar.querySelector(".status-frame__photo");
        if (photoWrap && photoWrap.dataset.avatarUrl !== (profile.avatar_url || "")) {
          photoWrap.innerHTML = avatarMarkup(profile.avatar_url);
          photoWrap.dataset.avatarUrl = profile.avatar_url || "";
        }
      }
    }

    // Cenário (fundo do topo, com imagem se enviada) + cor de tema:
    // usa o esquema de cores escolhido manualmente (color_scheme), ou
    // a cor pareada automaticamente ao cenário se nada foi escolhido.
    const header = document.querySelector(".dash-header");
    if (header) {
      const tintHex = MSNScenes.colorSchemeHex(profile.color_scheme);
      header.style.setProperty("--scene", resolveSceneBg(profile.scene, profile.scene_image_url, tintHex));
      // A linha/sombra na base do banner (ver .dash-header no CSS) foi
      // pensada pra separar o cenário do resto — no cenário padrão
      // (degradê escuro) ela aparecia como uma linha escura feia por
      // cima do próprio degradê, então some só nesse caso.
      header.classList.toggle("is-default-scene", !profile.scene || profile.scene === SCENES[0].id);
    }
    updateHeaderTextContrast(header, profile.scene, profile.scene_image_url);

    const screen = document.getElementById("screen-dashboard");
    if (screen) {
      const theme = MSNScenes.effectiveTheme(profile.scene, profile.color_scheme);
      // Misturas mais saturadas que antes (0.92/0.8/0.62 → 0.78/0.6/0.4)
      // — em cores já claras (ex.: amarelo, rosa-claro) a versão antiga
      // ficava quase idêntica ao branco, sem dar pra perceber a cor no
      // fundo do Dashboard.
      screen.style.setProperty("--tint-light", pastel(theme, 0.78));
      screen.style.setProperty("--tint-mid", pastel(theme, 0.6));
      screen.style.setProperty("--tint-strong", pastel(theme, 0.4));
      // Ponta forte do degradê do banner de convite/topo-e-fim da lista
      // de contatos — metade da intensidade de novo (0.575 → 0.7875:
      // a "força" da cor, 1-0.575=0.425, foi cortada pela metade de
      // novo, 0.2125, ainda forte demais nesses dois lugares).
      screen.style.setProperty("--tint-vivid", pastel(theme, 0.7875));
      // Escurecida — legível como texto (ex.: placeholder da busca)
      // sobre o fundo claro tingido, ao contrário de --tint-strong.
      screen.style.setProperty("--tint-text", MSNScenes.shade(theme, 0.35));
    }

    const subInput = document.getElementById("my-subnick-input");
    if (subInput && document.activeElement !== subInput) {
      subInput.value = profile.sub_nick || "";
    }
  }

  /* ---------- Preferências de Layout (Opções > Layout) ----------
     Tudo aqui é preferência local (localStorage), não depende de
     coluna nova no Supabase.

     Tamanho/estilo do avatar dos contatos: 4 modos (ver
     .contact-item__avatar[data-mode] no CSS) — "huge" (tamanho da
     própria foto de exibição), "large" (padrão de sempre, 38px),
     "classic" (ícone bonequinho colorido pelo status) e "tiny" (ícone
     de status da tela de login). Favoritos e "Outros contatos"
     (grupos + Disponível + Offline) guardam o modo separadamente
     (favSize/otherSize) — o dropdown "Modo de exibição" na barra de
     ferramentas é só um atalho que seta os dois de uma vez, pra não
     ter um terceiro estado pra manter sincronizado. */
  const SIZE_MODES = ["huge", "large", "classic", "tiny"];
  // Converte valores antigos (de antes dessa tela ganhar 4 modos) pro
  // equivalente mais próximo, pra quem já tinha uma preferência salva
  // não cair num valor inválido.
  function normalizeSizeMode(v) {
    if (SIZE_MODES.indexOf(v) !== -1) return v;
    if (v === "normal" || v === "md" || v === "lg") return v === "lg" ? "huge" : "large";
    if (v === "small" || v === "sm") return "tiny";
    return "large";
  }

  let showFavoritesGroup = true;
  let showGroupsSection = true;
  let showBlockedContacts = true;
  let favSize = "large";
  let otherSize = "large";
  let labelBy = "name";
  let showStatusLabel = false;
  let sortBy = "status";

  function loadLayoutPrefs() {
    try {
      const get = (k, d) => { const v = localStorage.getItem(k); return v === null ? d : v; };
      showFavoritesGroup = get("msn:showFavorites", "true") === "true";
      showGroupsSection = get("msn:showGroups", "true") === "true";
      showBlockedContacts = get("msn:showBlocked", "true") === "true";
      favSize = normalizeSizeMode(get("msn:favSize", "large"));
      otherSize = normalizeSizeMode(get("msn:otherSize", "large"));
      labelBy = get("msn:labelBy", "name");
      showStatusLabel = get("msn:showStatusLabel", "false") === "true";
      sortBy = get("msn:sortBy", "status");
    } catch (_) {}
  }
  function saveLayoutPrefs() {
    try {
      localStorage.setItem("msn:showFavorites", String(showFavoritesGroup));
      localStorage.setItem("msn:showGroups", String(showGroupsSection));
      localStorage.setItem("msn:showBlocked", String(showBlockedContacts));
      localStorage.setItem("msn:favSize", favSize);
      localStorage.setItem("msn:otherSize", otherSize);
      localStorage.setItem("msn:labelBy", labelBy);
      localStorage.setItem("msn:showStatusLabel", String(showStatusLabel));
      localStorage.setItem("msn:sortBy", sortBy);
    } catch (_) {}
  }

  // Aplica visibilidade — o tamanho/estilo do avatar é decidido por
  // item em renderContacts()/fillList() (cada seção usa favSize ou
  // otherSize), não precisa de classe no container.
  function applyLayoutVisuals() {
    const favGroup = document.getElementById("group-favorites");
    if (favGroup) favGroup.hidden = !showFavoritesGroup;
    const groupsWrap = document.getElementById("contact-groups-dynamic");
    if (groupsWrap) groupsWrap.hidden = !showGroupsSection;
    syncViewModeMenu();
  }

  // O dropdown "Modo de exibição" da barra de ferramentas reflete o
  // modo dos Favoritos como referência (os dois seletores de Opções >
  // Layout podem divergir entre si; aqui é só um atalho pra setar os
  // dois de uma vez, ver bindEvents).
  function syncViewModeMenu() {
    const radio = document.querySelector('input[name="view-mode"][value="' + favSize + '"]');
    if (radio) radio.checked = true;
  }

  function loadLayoutPrefsIntoForm() {
    document.getElementById("opt-show-favorites").checked = showFavoritesGroup;
    document.getElementById("opt-show-groups").checked = showGroupsSection;
    document.getElementById("opt-show-blocked").checked = showBlockedContacts;
    document.getElementById("opt-label-by").value = labelBy;
    document.getElementById("opt-show-status-label").checked = showStatusLabel;
    document.getElementById("opt-sort-by").value = sortBy;
    const favRadio = document.querySelector('input[name="size-favorites"][value="' + favSize + '"]');
    if (favRadio) favRadio.checked = true;
    const otherRadio = document.querySelector('input[name="size-other"][value="' + otherSize + '"]');
    if (otherRadio) otherRadio.checked = true;
  }

  function commitLayoutPrefs() {
    showFavoritesGroup = document.getElementById("opt-show-favorites").checked;
    showGroupsSection = document.getElementById("opt-show-groups").checked;
    showBlockedContacts = document.getElementById("opt-show-blocked").checked;
    labelBy = document.getElementById("opt-label-by").value;
    showStatusLabel = document.getElementById("opt-show-status-label").checked;
    sortBy = document.getElementById("opt-sort-by").value;
    const favRadio = document.querySelector('input[name="size-favorites"]:checked');
    favSize = favRadio ? favRadio.value : "large";
    const otherRadio = document.querySelector('input[name="size-other"]:checked');
    otherSize = otherRadio ? otherRadio.value : "large";
    saveLayoutPrefs();
    applyLayoutVisuals();
    renderContacts(currentFilter);
  }

  /* ---------- Preferências de Mensagens (Opções > Mensagens) ----------
     Ainda não existe janela de conversa no app — essas preferências só
     ficam guardadas (localStorage) prontas pra quando o chat for
     construído; "Manter um histórico" já liga/desliga "Mostrar minha
     última conversa" de verdade, igual ao cliente clássico. */
  const MESSAGE_PREF_KEYS = {
    showEmoticons: "opt-show-emoticons",
    showTimestamps: "opt-show-timestamps",
    allowNudges: "opt-allow-nudges",
    autoPlayWinks: "opt-auto-play-winks",
    autoPlayVoice: "opt-auto-play-voice",
    keepHistory: "opt-keep-history",
    showLastConversation: "opt-show-last-conversation",
  };
  let messagePrefs = {
    showEmoticons: true,
    showTimestamps: false,
    allowNudges: true,
    autoPlayWinks: true,
    autoPlayVoice: true,
    keepHistory: false,
    showLastConversation: false,
  };

  function loadMessagePrefs() {
    try {
      Object.keys(messagePrefs).forEach((key) => {
        const raw = localStorage.getItem("msn:msg:" + key);
        if (raw !== null) messagePrefs[key] = raw === "true";
      });
    } catch (_) {}
  }
  function saveMessagePrefs() {
    try {
      Object.keys(messagePrefs).forEach((key) => {
        localStorage.setItem("msn:msg:" + key, String(messagePrefs[key]));
      });
    } catch (_) {}
  }

  function updateLastConversationCheckbox() {
    const keepHistoryEl = document.getElementById(MESSAGE_PREF_KEYS.keepHistory);
    const lastConvEl = document.getElementById(MESSAGE_PREF_KEYS.showLastConversation);
    if (!keepHistoryEl || !lastConvEl) return;
    lastConvEl.disabled = !keepHistoryEl.checked;
    if (!keepHistoryEl.checked) lastConvEl.checked = false;
  }

  function loadMessagePrefsIntoForm() {
    Object.keys(MESSAGE_PREF_KEYS).forEach((key) => {
      const el = document.getElementById(MESSAGE_PREF_KEYS[key]);
      if (el) el.checked = messagePrefs[key];
    });
    updateLastConversationCheckbox();
  }

  function commitMessagePrefs() {
    Object.keys(MESSAGE_PREF_KEYS).forEach((key) => {
      const el = document.getElementById(MESSAGE_PREF_KEYS[key]);
      if (el) messagePrefs[key] = el.checked;
    });
    saveMessagePrefs();
  }

  /* ---------- Pessoas bloqueadas (Opções > Privacidade) ---------- */
  async function renderBlockedList() {
    const list = document.getElementById("options-blocked-list");
    const empty = document.getElementById("options-blocked-empty");
    if (!list) return;
    list.innerHTML = "";
    let blocked = [];
    try {
      blocked = await MSNSupabase.getBlockedUsers();
    } catch (_) {}

    empty.hidden = blocked.length !== 0;
    blocked.forEach((person) => {
      const li = document.createElement("li");
      li.className = "options-blocked-item";
      li.dataset.id = person.id;
      const name = document.createElement("span");
      name.textContent = person.display_name || person.email || "Pessoa";
      const unblockBtn = document.createElement("button");
      unblockBtn.type = "button";
      unblockBtn.className = "scene-dialog__browse";
      unblockBtn.textContent = "Desbloquear";
      unblockBtn.addEventListener("click", async () => {
        try {
          await MSNSupabase.unblockUser(person.id);
          renderBlockedList();
          await refreshBlockedIds();
          renderContacts(currentFilter);
        } catch (_) {}
      });
      li.appendChild(name);
      li.appendChild(unblockBtn);
      list.appendChild(li);
    });
  }

  async function blockPersonByEmail() {
    const input = document.getElementById("opt-block-email");
    const msg = document.getElementById("opt-block-message");
    const val = input.value.trim();
    msg.hidden = true;
    if (!val) {
      msg.textContent = "Digite o e-mail da pessoa.";
      msg.hidden = false;
      return;
    }
    try {
      await MSNSupabase.blockUserByEmail(val);
      input.value = "";
      renderBlockedList();
      await refreshBlockedIds();
      renderContacts(currentFilter);
    } catch (err) {
      msg.textContent = err.message || "Não foi possível bloquear.";
      msg.hidden = false;
    }
  }

  /* ---------- Conta (Opções > Segurança) ----------
     Trocar e-mail e senha usam supabase.auth.updateUser() direto do
     navegador. Excluir conta chama a função delete_my_account() no
     banco (ver supabase/account_management.sql) — o app nunca tem a
     service_role key, então apagar de auth.users só é possível assim
     (a função roda com privilégio elevado só internamente, e só apaga
     a PRÓPRIA conta de quem chamou). */
  function loadSecurityIntoForm() {
    document.getElementById("opt-new-email").value = "";
    document.getElementById("opt-new-password").value = "";
    document.getElementById("opt-new-password2").value = "";
    document.getElementById("opt-delete-confirm").value = "";
    ["opt-email-message", "opt-password-message", "opt-delete-message"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.hidden = true;
    });
    updateDeleteAccountButtonState();
  }

  async function changeAccountEmail() {
    const input = document.getElementById("opt-new-email");
    const msg = document.getElementById("opt-email-message");
    const val = input.value.trim();
    msg.hidden = true;
    msg.classList.remove("modal__message--info");
    if (!val) {
      msg.textContent = "Digite o novo e-mail.";
      msg.hidden = false;
      return;
    }
    try {
      await MSNSupabase.updateEmail(val);
      input.value = "";
      msg.textContent = "Enviamos um link de confirmação para o novo e-mail. A troca só vale depois de confirmar.";
      msg.classList.add("modal__message--info");
      msg.hidden = false;
    } catch (err) {
      msg.textContent = err.message || "Não foi possível trocar o e-mail.";
      msg.hidden = false;
    }
  }

  async function changeAccountPassword() {
    const pass1 = document.getElementById("opt-new-password");
    const pass2 = document.getElementById("opt-new-password2");
    const msg = document.getElementById("opt-password-message");
    msg.hidden = true;
    msg.classList.remove("modal__message--info");
    if (!pass1.value || pass1.value.length < 6) {
      msg.textContent = "A senha deve ter pelo menos 6 caracteres.";
      msg.hidden = false;
      return;
    }
    if (pass1.value !== pass2.value) {
      msg.textContent = "As senhas não coincidem.";
      msg.hidden = false;
      return;
    }
    try {
      await MSNSupabase.updatePassword(pass1.value);
      pass1.value = "";
      pass2.value = "";
      msg.textContent = "Senha alterada com sucesso.";
      msg.classList.add("modal__message--info");
      msg.hidden = false;
    } catch (err) {
      msg.textContent = err.message || "Não foi possível trocar a senha.";
      msg.hidden = false;
    }
  }

  // O botão de excluir só liga depois de digitar o próprio e-mail da
  // conta — barreira contra clique acidental num botão sem volta, mais
  // específica que uma palavra fixa (confirma que é a conta certa).
  function updateDeleteAccountButtonState() {
    const input = document.getElementById("opt-delete-confirm");
    const btn = document.getElementById("opt-delete-account-btn");
    if (!input || !btn) return;
    const myEmail = (profile && profile.email) || "";
    btn.disabled = !myEmail || input.value.trim().toLowerCase() !== myEmail.toLowerCase();
  }

  async function deleteAccountFlow() {
    const msg = document.getElementById("opt-delete-message");
    msg.hidden = true;
    const email = profile && profile.email;
    try {
      await MSNSupabase.deleteMyAccount();
    } catch (err) {
      msg.textContent = err.message || "Não foi possível excluir a conta.";
      msg.hidden = false;
      return;
    }
    closeOptionsDialog();
    await doSignOut();
    try { App.forgetAccount(email); } catch (_) {}
  }

  /* ---------- Permissões do dispositivo (Opções > Alertas) ----------
     Estado de verdade do navegador (Permissions API / Notification /
     Storage), não é uma preferência do app — só mostra o que já está
     concedido/bloqueado no dispositivo. */
  const PERMISSION_LIST = [
    { name: "notifications", label: "Notificações" },
    { name: "camera", label: "Câmera" },
    { name: "microphone", label: "Microfone" },
    { name: "geolocation", label: "Localização" },
    { name: "persistent-storage", label: "Armazenamento" },
  ];
  const PERMISSION_STATE_LABEL = {
    granted: "Permitido",
    denied: "Bloqueado",
    prompt: "Não perguntado ainda",
    unsupported: "Não suportado",
  };
  async function queryPermissionState(name) {
    // Notificações: nem todo navegador aceita "notifications" via
    // permissions.query (Safari, por ex.) — Notification.permission
    // funciona em mais lugares e cobre o mesmo estado.
    if (name === "notifications" && typeof Notification !== "undefined") {
      const perm = Notification.permission; // "granted" | "denied" | "default"
      return perm === "default" ? "prompt" : perm;
    }
    // Armazenamento: "persistent-storage" via Permissions API funciona
    // no Chrome; navigator.storage.persisted() é o fallback (relata se
    // já está concedido, sem estado "denied" — só sim/ainda não).
    if (name === "persistent-storage" && (!navigator.permissions || !navigator.permissions.query)) {
      if (navigator.storage && navigator.storage.persisted) {
        try {
          const persisted = await navigator.storage.persisted();
          return persisted ? "granted" : "prompt";
        } catch (_) { return "unsupported"; }
      }
      return "unsupported";
    }
    if (!navigator.permissions || !navigator.permissions.query) return "unsupported";
    try {
      const status = await navigator.permissions.query({ name });
      return status.state; // "granted" | "denied" | "prompt"
    } catch (_) {
      return "unsupported";
    }
  }
  // Dispara o pedido de verdade do navegador pra cada permissão — cada
  // uma usa a própria API (não existe um "requestPermission" genérico).
  // Câmera/microfone precisam abrir o stream pra disparar o pedido;
  // fecha na hora, já que é só pra decidir a permissão, não pra usar
  // de verdade agora.
  async function requestBrowserPermission(name) {
    if (name === "notifications" && typeof Notification !== "undefined") {
      await Notification.requestPermission();
      return;
    }
    if ((name === "camera" || name === "microphone") && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      try {
        const constraints = name === "camera" ? { video: true } : { audio: true };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        stream.getTracks().forEach((t) => t.stop());
      } catch (_) {}
      return;
    }
    if (name === "geolocation" && navigator.geolocation) {
      await new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(() => resolve(), () => resolve(), { timeout: 8000 });
      });
      return;
    }
    if (name === "persistent-storage" && navigator.storage && navigator.storage.persist) {
      try { await navigator.storage.persist(); } catch (_) {}
    }
  }

  async function renderPermissions() {
    const list = document.getElementById("options-permissions-list");
    if (!list) return;
    list.innerHTML = PERMISSION_LIST.map((p) =>
      '<li class="options-permission-item" data-permission="' + p.name + '">' +
      "<span>" + esc(p.label) + "</span>" +
      '<span class="options-permission-right">' +
      '<span class="options-permission-badge">…</span>' +
      '<label class="options-permission-switch">' +
      '<input type="checkbox" disabled />' +
      '<span class="options-permission-switch__track"></span>' +
      "</label>" +
      "</span>" +
      "</li>"
    ).join("");

    await Promise.all(PERMISSION_LIST.map(async (p) => {
      const state = await queryPermissionState(p.name);
      const li = list.querySelector('[data-permission="' + p.name + '"]');
      if (!li) return;
      const badge = li.querySelector(".options-permission-badge");
      badge.textContent = PERMISSION_STATE_LABEL[state] || PERMISSION_STATE_LABEL.unsupported;
      badge.className = "options-permission-badge options-permission-badge--" + state;

      const toggle = li.querySelector('input[type="checkbox"]');
      toggle.checked = state === "granted";
      // Só dá pra "ligar" quando ainda não foi perguntado — depois de
      // permitido/bloqueado, o próprio navegador não deixa perguntar
      // de novo por JS (tem que mudar nas configurações do site).
      toggle.disabled = state !== "prompt";
      toggle.onchange = async () => {
        if (!toggle.checked) return;
        toggle.disabled = true;
        badge.textContent = "Perguntando…";
        // Geolocalização não tem um limite de tempo embutido pra
        // pessoa responder o pedido — sem isso, se ela nunca responder,
        // a chave ficaria travada "desligando" pra sempre. 20s é só uma
        // rede de segurança pra sempre voltar a mostrar o estado atual.
        const timeout = new Promise((resolve) => setTimeout(resolve, 20000));
        await Promise.race([requestBrowserPermission(p.name), timeout]);
        renderPermissions();
      };
    }));
  }

  // Cria (ou recria) a "casca" de cada grupo próprio dentro de
  // #contact-groups-dynamic — chamado só quando a lista de grupos muda
  // (load()/depois de criar um grupo), não a cada busca. O preenchimento
  // de membros fica com renderContacts()/fillList(), que roda mais
  // vezes, pra não perder o estado de aberto/fechado à toa.
  function renderGroupShells() {
    const wrap = document.getElementById("contact-groups-dynamic");
    if (!wrap) return;
    wrap.innerHTML = groups.map((g) =>
      '<div class="contact-group contact-group--other" data-group="custom-' + esc(String(g.id)) + '">' +
      '<button type="button" class="contact-group__header" aria-expanded="true">' +
      '<span class="group-caret"></span>' +
      '<img class="group-icon" src="assets/icons/gruposimg.webp" alt="" aria-hidden="true" />' +
      '<span class="group-title">' + esc(g.name) + '</span>' +
      '<span class="group-count" id="count-group-' + esc(String(g.id)) + '">(0/0)</span>' +
      "</button>" +
      '<div class="contact-group__collapse">' +
      '<ul class="contact-group__list" id="list-group-' + esc(String(g.id)) + '"></ul>' +
      "</div></div>"
    ).join("");
    // Cabeçalhos novos precisam do mesmo listener de colapsar/expandir
    // que os grupos estáticos (Favoritos/Disponível/Offline) já têm.
    wrap.querySelectorAll(".contact-group__header").forEach((h) => {
      h.addEventListener("click", () => {
        const open = h.getAttribute("aria-expanded") === "true";
        h.setAttribute("aria-expanded", String(!open));
      });
    });
  }

  /* ---------- Lista de contatos ----------
     Favoritos e membros de um grupo próprio são "puxados" pra fora de
     Disponível/Offline — um contato só aparece numa dessas seções por
     vez (Favoritos > Grupo > Disponível/Offline, nessa prioridade),
     igual ao cliente clássico, evitando duplicar o mesmo contato em
     mais de um lugar. */
  function renderContacts(filter = "") {
    const q = filter.trim().toLowerCase();
    const matches = (c) => {
      if (!showBlockedContacts && blockedContactIds.has(String(c.id))) return false;
      return !q || (c.display_name || "").toLowerCase().includes(q);
    };
    const isOnline = (c) => ["online", "busy", "away"].includes(contactVisibleStatus(c.status, c.id));

    // Só "puxa" contatos pra fora de Disponível/Offline quando a
    // respectiva seção está de fato visível (Opções > Layout) — senão
    // um contato favoritado/agrupado sumiria da lista inteira ao
    // desligar "Mostrar favoritos"/"Mostrar grupos", em vez de só
    // voltar a aparecer no lugar de sempre.
    const favorites = showFavoritesGroup ? contacts.filter((c) => matches(c) && c.is_favorite) : [];
    const favoriteIds = new Set(favorites.map((c) => String(c.id)));

    const claimedIds = new Set(favoriteIds);
    groups.forEach((g) => {
      const memberIds = (g.member_ids || []).map(String);
      const members = showGroupsSection
        ? contacts.filter((c) => matches(c) && !claimedIds.has(String(c.id)) && memberIds.includes(String(c.id)))
        : [];
      members.forEach((c) => claimedIds.add(String(c.id)));
      fillList("list-group-" + g.id, members, otherSize);
      const groupOnline = members.filter(isOnline).length;
      const countEl = document.getElementById("count-group-" + g.id);
      if (countEl) countEl.textContent = "(" + groupOnline + "/" + members.length + ")";
    });

    let online = [];
    let offline = [];
    contacts.forEach((c) => {
      if (!matches(c) || claimedIds.has(String(c.id))) return;
      if (isOnline(c)) online.push(c);
      else offline.push(c);
    });

    const byName = (a, b) => (a.display_name || "").localeCompare(b.display_name || "");
    const onlineTitle = document.querySelector('[data-group="online"] .group-title');
    const offlineGroup = document.querySelector('[data-group="offline"]');
    if (sortBy === "name") {
      // "Organizar por Nome": uma lista só, em ordem alfabética, sem
      // separar por status — junta tudo no bloco de "Disponível"
      // (relabelado) e esconde o de "Offline".
      online = online.concat(offline).sort(byName);
      offline = [];
      if (onlineTitle) onlineTitle.textContent = "Contatos";
      if (offlineGroup) offlineGroup.hidden = true;
    } else {
      online.sort(byName);
      offline.sort(byName);
      if (onlineTitle) onlineTitle.textContent = "Disponível";
      if (offlineGroup) offlineGroup.hidden = false;
    }

    fillList("list-favorites", favorites, favSize);
    fillList("list-online", online, otherSize);
    fillList("list-offline", offline, otherSize);
    const favOnline = favorites.filter(isOnline).length;
    document.getElementById("count-favorites").textContent = "(" + favOnline + "/" + favorites.length + ")";
    document.getElementById("count-online").textContent = "(" + online.length + ")";
    document.getElementById("count-offline").textContent = "(" + offline.length + ")";

    const empty = document.getElementById("contacts-empty");
    empty.hidden = contacts.length !== 0;
  }

  // Marca/desmarca um contato como favorito e re-renderiza (pra ele
  // saltar pra dentro/fora do grupo Favoritos na hora).
  async function toggleFavorite(id) {
    const c = contacts.find((x) => String(x.id) === String(id));
    if (!c) return;
    c.is_favorite = !c.is_favorite;
    renderContacts(currentFilter);
    try { await MSNSupabase.setFavorite(c.id, c.is_favorite); } catch (_) {}
  }

  // Silenciar/aparecer offline: mesma ideia de toggleFavorite acima,
  // só que sem precisar re-renderizar a lista toda — quem muda de
  // aparência aqui é o menu de contexto (ver renderContactCtxMenu),
  // não o <li> em si.
  async function toggleMuted(id) {
    const c = contacts.find((x) => String(x.id) === String(id));
    if (!c) return;
    c.is_muted = !c.is_muted;
    try { await MSNSupabase.setContactMuted(c.id, c.is_muted); } catch (_) {}
  }
  async function toggleAppearOffline(id) {
    const c = contacts.find((x) => String(x.id) === String(id));
    if (!c) return;
    c.appear_offline = !c.appear_offline;
    try { await MSNSupabase.setAppearOffline(c.id, c.appear_offline); } catch (_) {}
  }

  /* ---------- Menu de contexto: segurar um contato apertado ----------
     Abre um dropdown no ponto exato onde o dedo/mouse ficou parado,
     com opções pessoais sobre aquele contato (favoritar, silenciar
     notificações, aparecer offline só pra ele) — de propósito SEM
     opção de bloquear aqui (isso fica em Opções > Privacidade, pra não
     virar uma ação acidental de segurar demais um contato). */
  const CTX_MENU_HOLD_MS = 500;
  const CTX_MENU_MOVE_TOLERANCE = 10;
  let ctxMenuContactId = null;
  let ctxHoldTimer = null;
  let ctxHoldStart = null;
  // Depois que segurar apertado abre o menu, o "pointerup" que solta o
  // dedo/mouse ainda dispara um "click" logo em seguida — sem essa
  // trava, esse click abriria a conversa com o contato bem embaixo do
  // menu recém-aberto. Fica ligada só até o próximo click no documento.
  let ctxMenuJustOpened = false;

  function closeContactCtxMenu() {
    const menu = document.getElementById("contact-ctx-menu");
    if (menu) menu.hidden = true;
    ctxMenuContactId = null;
  }

  function renderContactCtxMenu() {
    const c = contacts.find((x) => String(x.id) === String(ctxMenuContactId));
    if (!c) return;
    const items = [
      ["favorite", c.is_favorite, c.is_favorite ? "Remover dos favoritos" : "Adicionar aos favoritos"],
      ["mute", c.is_muted, c.is_muted ? "Reativar notificações" : "Silenciar notificações"],
      ["appear-offline", c.appear_offline, c.appear_offline ? "Parar de aparecer offline" : "Aparecer offline para este contato"],
    ];
    items.forEach(([action, checked, label]) => {
      const item = document.querySelector('.ctx-menu__item[data-action="' + action + '"]');
      if (!item) return;
      item.classList.toggle("is-checked", !!checked);
      const labelEl = document.getElementById("ctx-label-" + action);
      if (labelEl) labelEl.textContent = label;
    });
  }

  function positionContactCtxMenu(x, y) {
    const menu = document.getElementById("contact-ctx-menu");
    if (!menu) return;
    const margin = 8;
    const rect = menu.getBoundingClientRect();
    let left = Math.min(x, window.innerWidth - rect.width - margin);
    let top = Math.min(y, window.innerHeight - rect.height - margin);
    left = Math.max(margin, left);
    top = Math.max(margin, top);
    menu.style.left = left + "px";
    menu.style.top = top + "px";
  }

  function openContactCtxMenu(id, x, y) {
    ctxMenuContactId = id;
    const menu = document.getElementById("contact-ctx-menu");
    if (!menu) return;
    menu.hidden = false;
    renderContactCtxMenu();
    positionContactCtxMenu(x, y);
    ctxMenuJustOpened = true;
    if (navigator.vibrate) navigator.vibrate(15);
  }

  function cancelCtxHold() {
    if (ctxHoldTimer) clearTimeout(ctxHoldTimer);
    ctxHoldTimer = null;
    ctxHoldStart = null;
  }

  // Detecta "segurar apertado" via Pointer Events (unifica toque e
  // mouse) — dispara o menu depois de CTX_MENU_HOLD_MS parado no mesmo
  // contato; qualquer arrasto maior que a tolerância (rolando a lista,
  // por exemplo) cancela em vez de abrir o menu.
  function bindContactLongPress() {
    const container = document.getElementById("contacts-container");
    if (!container) return;
    container.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      const item = e.target.closest(".contact-item[data-id]");
      if (!item || e.target.closest(".contact-item__fav")) return;
      cancelCtxHold();
      ctxHoldStart = { x: e.clientX, y: e.clientY, id: item.dataset.id };
      ctxHoldTimer = setTimeout(() => {
        openContactCtxMenu(ctxHoldStart.id, ctxHoldStart.x, ctxHoldStart.y);
        cancelCtxHold();
      }, CTX_MENU_HOLD_MS);
    });
    container.addEventListener("pointermove", (e) => {
      if (!ctxHoldStart) return;
      const dx = e.clientX - ctxHoldStart.x;
      const dy = e.clientY - ctxHoldStart.y;
      if (Math.hypot(dx, dy) > CTX_MENU_MOVE_TOLERANCE) cancelCtxHold();
    });
    ["pointerup", "pointercancel", "pointerleave"].forEach((evt) => {
      container.addEventListener(evt, cancelCtxHold);
    });
    // Impede o menu do navegador (copiar/compartilhar imagem) de
    // competir com o nosso próprio menu de segurar apertado.
    container.addEventListener("contextmenu", (e) => {
      if (e.target.closest(".contact-item[data-id]")) e.preventDefault();
    });

    document.getElementById("contact-ctx-menu").addEventListener("click", (e) => {
      const item = e.target.closest(".ctx-menu__item[data-action]");
      if (!item || !ctxMenuContactId) return;
      const id = ctxMenuContactId;
      const action = item.dataset.action;
      if (action === "favorite") { toggleFavorite(id); }
      else if (action === "mute") { toggleMuted(id); }
      else if (action === "appear-offline") { toggleAppearOffline(id); }
      renderContactCtxMenu();
    });
    document.addEventListener("click", (e) => {
      const menu = document.getElementById("contact-ctx-menu");
      if (menu && !menu.hidden && !e.target.closest("#contact-ctx-menu")) closeContactCtxMenu();
    });
    window.addEventListener("scroll", closeContactCtxMenu, true);
  }

  // Atualiza os <li> existentes no lugar (em vez de recriar tudo com
  // innerHTML) sempre que possível — assim a cor da moldura consegue
  // animar quando o status de um contato muda, ao invés de só "trocar"
  // de uma vez (nó novo = sem transição pra animar a partir de onde
  // estava).
  function fillList(id, list, mode) {
    const ul = document.getElementById(id);
    const existing = new Map();
    ul.querySelectorAll(".contact-item[data-id]").forEach((li) => existing.set(li.dataset.id, li));

    list.forEach((c) => {
      const key = String(c.id);
      let li = existing.get(key);
      if (li) {
        updateContactItem(li, c, mode);
        existing.delete(key);
      } else {
        li = contactItem(c, mode);
      }
      ul.appendChild(li); // garante a ordem da lista atual
    });

    // Sobrou no mapa = não está mais na lista (offline mudou de grupo,
    // contato removido, ou saiu do filtro de busca).
    existing.forEach((li) => li.remove());
  }

  function contactItem(c, mode) {
    const li = document.createElement("li");
    li.dataset.id = c.id;
    li.innerHTML =
      '<div class="contact-item__avatar"></div>' +
      '<div class="contact-item__body">' +
      '<div class="contact-item__name"></div>' +
      "</div>" +
      '<button type="button" class="contact-item__fav"></button>';
    updateContactItem(li, c, mode);
    return li;
  }

  function updateContactItem(li, c, mode) {
    // Um contato invisível aparece como offline pra qualquer outra
    // pessoa — ver contactVisibleStatus. Tudo abaixo usa "status"
    // (normalizado), nunca c.status direto.
    const status = contactVisibleStatus(c.status, c.id);
    const isOnline = ["online", "busy", "away"].includes(status);
    li.className = "contact-item " + (isOnline ? "contact-item--" + status : "contact-item--offline");

    const avatarBox = li.querySelector(".contact-item__avatar");
    if (avatarBox) {
      // Risco vermelho na diagonal por cima do avatar, igual ao
      // cliente clássico — ver .contact-item__avatar.is-blocked no CSS.
      avatarBox.classList.toggle("is-blocked", blockedContactIds.has(String(c.id)));
      avatarBox.dataset.mode = mode;
      // Trocar de modo (Opções > Layout / "Modo de exibição") exige
      // remontar o miolo — cada um tem uma estrutura diferente por
      // dentro (foto+moldura / ícone clássico / ícone de status), ao
      // contrário de uma simples atualização de status.
      const current = avatarBox.dataset.renderedMode;
      if (current !== mode) {
        avatarBox.dataset.renderedMode = mode;
        if (mode === "classic") avatarBox.innerHTML = classicIconMarkup(status);
        else if (mode === "tiny") avatarBox.innerHTML = statusIconMarkup(status);
        else avatarBox.innerHTML = statusFrameMarkup(c.avatar_url, status);
      } else if (mode === "classic") {
        const icon = avatarBox.querySelector(".contact-classic-icon");
        if (icon) icon.dataset.status = status;
      } else if (mode === "tiny") {
        const img = avatarBox.querySelector(".contact-status-icon-img");
        if (img) img.dataset.status = status;
      } else {
        const ring = avatarBox.querySelector(".status-frame__ring");
        if (ring) updateStatusFrame(ring, status);
        const photoWrap = avatarBox.querySelector(".status-frame__photo");
        if (photoWrap && photoWrap.dataset.avatarUrl !== (c.avatar_url || "")) {
          photoWrap.innerHTML = avatarMarkup(c.avatar_url);
          photoWrap.dataset.avatarUrl = c.avatar_url || "";
        }
      }
    }

    const nameEl = li.querySelector(".contact-item__name");
    if (nameEl) {
      let label = (labelBy === "email" && c.email) ? c.email : c.display_name;
      if (showStatusLabel) label += " (" + (STATUS_LABEL[status] || "") + ")";
      nameEl.textContent = label;
    }

    const body = li.querySelector(".contact-item__body");
    let subEl = li.querySelector(".contact-item__sub");
    if (c.sub_nick) {
      if (!subEl) {
        subEl = document.createElement("div");
        subEl.className = "contact-item__sub";
        body.appendChild(subEl);
      }
      subEl.textContent = c.sub_nick;
    } else if (subEl) {
      subEl.remove();
    }

    const favBtn = li.querySelector(".contact-item__fav");
    if (favBtn) {
      favBtn.classList.toggle("is-favorite", !!c.is_favorite);
      favBtn.setAttribute("aria-label", c.is_favorite ? "Remover dos favoritos" : "Adicionar aos favoritos");
    }
  }

  /* ---------- Menu do nick: seleção e ações ---------- */
  function markSelectedStatus() {
    const s = profile ? profile.status : "online";
    document.querySelectorAll(".my-menu__status").forEach((it) => {
      it.classList.toggle("is-selected", it.dataset.status === s);
    });
  }

  function handleMenuAction(action) {
    switch (action) {
      case "signout":
        doSignOut();
        break;
      case "change-name":
        openOptionsDialog();
        break;
      case "change-picture":
        changePicture();
        break;
      case "change-scene":
        openScenePicker();
        break;
      case "options":
        openOptionsDialog();
        break;
    }
  }

  /* ---------- Alterar imagem para exibição ----------
     Abre o diálogo "Selecione uma Imagem para Exibição" (galeria de
     exemplos, igual ao Messenger clássico) em vez de ir direto pro
     seletor de arquivo — "Procurar..." dentro do diálogo é que abre
     o upload. Clicar só faz prévia; "OK" salva e fecha; "Fechar"/X
     descartam e voltam ao que estava salvo (mesmo padrão do seletor
     de cenário). */
  let stagedAvatarUrl = null;

  function changePicture() {
    openAvatarPicker();
  }

  function openAvatarPicker() {
    stagedAvatarUrl = profile ? profile.avatar_url || null : null;
    const grid = document.getElementById("avatar-grid");
    grid.innerHTML = AVATAR_GALLERY.map((url) =>
      '<button type="button" class="avatar-swatch' + (url === stagedAvatarUrl ? " is-selected" : "") +
      '" data-avatar="' + esc(url) + '" style="background-image:url(\'' + url + "')\"></button>"
    ).join("");

    grid.querySelectorAll(".avatar-swatch").forEach((sw) => {
      sw.addEventListener("click", () => {
        stagedAvatarUrl = sw.dataset.avatar || null;
        grid.querySelectorAll(".avatar-swatch").forEach((x) => x.classList.remove("is-selected"));
        sw.classList.add("is-selected");
        previewAvatar(stagedAvatarUrl);
      });
    });

    previewAvatar(stagedAvatarUrl);
    document.getElementById("avatar-picker").hidden = false;
  }

  // Aplica a foto só visualmente (na moldura do cabeçalho, colorida
  // pelo status de verdade, e no painel de prévia do diálogo — esse
  // último sem cor de status, só a foto + moldura original, igual à
  // tela de login, já que o status não é o que importa ao escolher
  // uma foto), sem salvar.
  function previewAvatar(url) {
    const photoWrap = document.querySelector(".my-avatar .status-frame__photo");
    if (photoWrap) {
      photoWrap.innerHTML = avatarMarkup(url);
      photoWrap.dataset.avatarUrl = url || "";
    }
    const previewFrame = document.getElementById("avatar-preview-frame");
    if (previewFrame) {
      const previewPhoto = previewFrame.querySelector(".avatar-img");
      if (previewPhoto) {
        previewPhoto.src = url || DEFAULT_AVATAR;
      } else {
        previewFrame.innerHTML =
          avatarMarkup(url) +
          '<img src="assets/avatars/login.webp" class="signin-avatar-plain__frame" alt="" />';
      }
    }
  }

  // Botão "Remover": volta pra foto padrão (equivale a avatar_url nulo).
  function removeAvatarSelection() {
    stagedAvatarUrl = null;
    const grid = document.getElementById("avatar-grid");
    if (grid) grid.querySelectorAll(".avatar-swatch").forEach((x) => x.classList.remove("is-selected"));
    previewAvatar(null);
  }

  function closeAvatarPicker() {
    if (profile) previewAvatar(profile.avatar_url || null);
    document.getElementById("avatar-picker").hidden = true;
  }

  async function commitAvatarPicker() {
    document.getElementById("avatar-picker").hidden = true;
    if (!profile || stagedAvatarUrl === (profile.avatar_url || null)) return;
    profile.avatar_url = stagedAvatarUrl;
    renderProfile();
    try { await MSNSupabase.updateMyProfile({ avatar_url: stagedAvatarUrl }); } catch (_) {}
  }

  // Envio de uma foto própria ("Procurar..." dentro do diálogo). Acima
  // de 3 MB, comprime pra WEBP em vez de recusar — só recusa mesmo se
  // passar de UPLOAD_HARD_LIMIT_BYTES (imagem grande demais até pra
  // tentar processar no navegador).
  async function onAvatarSelected(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = ""; // permite reenviar o mesmo arquivo
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      return infoModal("Foto de exibição", "Selecione um arquivo de imagem.");
    }
    if (file.size > UPLOAD_HARD_LIMIT_BYTES) {
      return infoModal("Foto de exibição", "Essa imagem é grande demais (máx. 20 MB).");
    }
    let uploadFile = file;
    if (file.size > 3 * 1024 * 1024) {
      try { uploadFile = await compressImageIfNeeded(file, 3 * 1024 * 1024); } catch (_) {}
    }

    // Prévia imediata
    const previewUrl = URL.createObjectURL(uploadFile);
    stagedAvatarUrl = previewUrl;
    document.querySelectorAll("#avatar-grid .avatar-swatch").forEach((x) => x.classList.remove("is-selected"));
    previewAvatar(previewUrl);

    try {
      const url = await MSNSupabase.uploadAvatar(uploadFile);
      stagedAvatarUrl = url;
      previewAvatar(url);
    } catch (err) {
      infoModal("Foto de exibição", MSNSupabase.friendlyError(err, "Não foi possível enviar a imagem."));
    }
  }

  /* ---------- Alterar cenário + esquema de cores ----------
     Duas escolhas independentes no mesmo diálogo, como no clássico:
     - Cenário: fundo do topo (até a barra de busca) — uma das opções
       prontas, ou uma imagem própria enviada via "Procurar...".
     - Esquema de cores: cor que tinge o resto da tela — uma das 8
       prontas, ou qualquer cor via "Mais cores..." (seletor nativo).
       Se nada for escolhido, continua usando a cor pareada ao cenário.
     Clicar só faz uma prévia (nada salvo ainda). "Aplicar" salva sem
     fechar; "OK" salva e fecha; "Fechar"/X descarta e volta ao que
     estava salvo. */
  let stagedScene = null;
  let stagedColorScheme = null;
  let stagedCustomImageUrl = null;
  // "profile" = cenário/tema da conta (mostrado pros outros); "chatBackground"
  // = plano de fundo pessoal das janelas de conversa (só eu vejo, ver
  // getPersonalChatBackground/setPersonalChatBackground mais abaixo).
  let scenePickerMode = "profile";
  // Estado de antes de abrir o diálogo, pra "Fechar"/X conseguirem
  // desfazer mesmo depois de um "Aplicar" (que já salva de verdade —
  // ver commitScene/revertScene). Guarda tanto o modo "profile" quanto
  // o "chatBackground", já que o usuário pode reabrir o diálogo em
  // qualquer um dos dois modos.
  let originalScene = null;
  let originalColorScheme = null;
  let originalCustomImageUrl = null;
  let originalChatBackground = null;

  // Cada modo usa seu próprio diálogo: "profile" reaproveita o
  // #scene-picker de sempre (cenário da conta + esquema de cores);
  // "chatBackground" usa o #bg-dialog dedicado (só a galeria de planos
  // de fundo + Procurar/Remover — sem seção de cor, ver screenshot do
  // cliente clássico enviado). Mesmo assim toda a lógica de seleção
  // (bindSceneTileClicks/commitScene/revertScene) é compartilhada.
  function sceneDialogOverlay() {
    return document.getElementById(scenePickerMode === "chatBackground" ? "bg-dialog" : "scene-picker");
  }
  function sceneDialogGrid() {
    return document.getElementById(scenePickerMode === "chatBackground" ? "bg-grid" : "scene-grid");
  }

  function openScenePicker(mode) {
    scenePickerMode = mode || "profile";
    const isChatBg = scenePickerMode === "chatBackground";
    const overlay = sceneDialogOverlay();
    const grid = sceneDialogGrid();
    const colorGrid = isChatBg ? null : document.getElementById("color-scheme-grid");
    if (isChatBg) {
      const bg = currentChatContact ? getPersonalChatBackground(currentChatContact.id) : null;
      originalChatBackground = bg
        ? { scene: bg.scene, colorScheme: bg.colorScheme || null, sceneImageUrl: bg.sceneImageUrl || null }
        : null;
      // Sem escolha pessoal ainda: abre com "Padrão" selecionado (não um
      // cenário qualquer) — mais claro sobre o que está em vigor agora.
      stagedScene = (bg && bg.scene) || "";
      stagedColorScheme = (bg && bg.colorScheme) || null;
      stagedCustomImageUrl = (bg && bg.sceneImageUrl) || null;
    } else {
      originalScene = (profile && profile.scene) || SCENES[0].id;
      originalColorScheme = (profile && profile.color_scheme) || null;
      originalCustomImageUrl = (profile && profile.scene_image_url) || null;
      stagedScene = originalScene;
      stagedColorScheme = originalColorScheme;
      stagedCustomImageUrl = originalCustomImageUrl;
    }

    grid.innerHTML =
      (isChatBg ? noneSwatchHtml(stagedScene === "") : "") +
      SCENES.map((s) =>
        '<button type="button" class="scene-swatch' + (s.id === stagedScene ? " is-selected" : "") +
        '" data-scene="' + s.id + '" style="background:' + sceneBg(s.id) +
        '" aria-label="' + esc(s.name) + '" title="' + esc(s.name) + '"></button>'
      ).join("");
    if (stagedScene === "custom" && stagedCustomImageUrl) {
      grid.insertAdjacentHTML("afterbegin", customTileHtml(stagedCustomImageUrl, true));
    }
    bindSceneTileClicks(grid);

    if (colorGrid) {
      colorGrid.innerHTML = MSNScenes.colorSchemes.map((c) =>
        '<button type="button" class="color-swatch' + (c.id === stagedColorScheme ? " is-selected" : "") +
        '" data-color-scheme="' + c.id + '" style="background:' + c.hex +
        '" aria-label="' + esc(c.id) + '"></button>'
      ).join("");
      bindColorSwatchClicks(colorGrid);
    }

    updateCurrentColorSwatch();

    // "Plano de fundo padrão": pré-visualização de verdade (a cor do
    // tema do contato agora), não um ícone de exemplo fixo — é pra
    // onde "Padrão"/"Nenhum" resolve nesta conversa específica.
    if (isChatBg) {
      const preview = document.getElementById("bg-default-preview");
      if (preview && currentChatContact) {
        preview.style.background = MSNScenes.effectiveTheme(currentChatContact.scene, currentChatContact.color_scheme);
      }
    }

    overlay.hidden = false;
  }

  // "Padrão": sem plano de fundo próprio pra essa conversa — usa a cor
  // do tema do contato (ver applyChatBackground). Só existe no diálogo
  // de Plano de Fundo (a conta sempre tem um cenário próprio, nunca
  // "nenhum").
  function noneSwatchHtml(selected) {
    return (
      '<button type="button" class="scene-swatch scene-swatch--none' + (selected ? " is-selected" : "") +
      '" data-scene="" aria-label="Padrão (cor do tema do contato)" title="Padrão (cor do tema do contato)"></button>'
    );
  }

  // Marca "Nenhum"/"Padrão" como selecionado no grid do diálogo de
  // Plano de Fundo, sem salvar ainda (só "OK"/"Aplicar" salvam de
  // verdade — ver commitScene) — usado tanto por "Remover" quanto por
  // "Definir padrão" (ver bindEvents), que dão no mesmo resultado
  // nesta conversa: "padrão" é a cor do tema do contato.
  function stageNoneInBgDialog() {
    stagedScene = "";
    stagedColorScheme = null;
    stagedCustomImageUrl = null;
    const grid = document.getElementById("bg-grid");
    if (!grid) return;
    grid.querySelectorAll(".scene-swatch").forEach((x) => x.classList.remove("is-selected"));
    const none = grid.querySelector(".scene-swatch--none");
    if (none) none.classList.add("is-selected");
    const custom = grid.querySelector('.scene-swatch[data-scene="custom"]');
    if (custom) custom.remove();
  }

  function customTileHtml(url, selected) {
    return (
      '<button type="button" class="scene-swatch' + (selected ? " is-selected" : "") +
      '" data-scene="custom" style="background:url(\'' + url + "') center/cover no-repeat\"" +
      ' aria-label="Personalizado" title="Personalizado"></button>'
    );
  }

  // Clicar num cenário/cor só marca a seleção dentro do diálogo (não
  // altera o Dashboard de verdade) — só "OK"/"Aplicar" aplicam e
  // salvam de fato (ver commitScene).
  function bindSceneTileClicks(grid) {
    grid.querySelectorAll(".scene-swatch").forEach((sw) => {
      sw.addEventListener("click", () => {
        stagedScene = sw.dataset.scene;
        grid.querySelectorAll(".scene-swatch").forEach((x) => x.classList.remove("is-selected"));
        sw.classList.add("is-selected");
        // Trocar de cenário volta a cor do tema pra automática (a cor
        // predominante já pareada com esse cenário em scenes.js — ver
        // MSNScenes.effectiveTheme) — o usuário não precisa escolher
        // uma cor toda vez, mas ainda pode clicar numa se quiser.
        stagedColorScheme = null;
        const colorGrid = document.getElementById("color-scheme-grid");
        if (colorGrid) {
          colorGrid.querySelectorAll(".color-swatch").forEach((x) => x.classList.remove("is-selected"));
        }
        updateCurrentColorSwatch();
      });
    });
  }

  function bindColorSwatchClicks(colorGrid) {
    colorGrid.querySelectorAll(".color-swatch").forEach((sw) => {
      sw.addEventListener("click", () => {
        // Clicar na cor já selecionada desmarca (volta ao par automático).
        stagedColorScheme = sw.dataset.colorScheme === stagedColorScheme ? null : sw.dataset.colorScheme;
        colorGrid.querySelectorAll(".color-swatch").forEach((x) => x.classList.remove("is-selected"));
        if (stagedColorScheme) sw.classList.add("is-selected");
        updateCurrentColorSwatch();
      });
    });
  }

  // Envio de um cenário/plano de fundo próprio ("Procurar...") — mesmo
  // fluxo pros dois diálogos, só muda o grid alvo (ver sceneDialogGrid).
  // Acima de 4 MB, comprime pra WEBP em vez de recusar — só recusa
  // mesmo se passar de UPLOAD_HARD_LIMIT_BYTES.
  async function onSceneImageSelected(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    const dialogLabel = scenePickerMode === "chatBackground" ? "Plano de Fundo" : "Cenário";
    if (!file.type.startsWith("image/")) {
      return infoModal(dialogLabel, "Selecione um arquivo de imagem.");
    }
    if (file.size > UPLOAD_HARD_LIMIT_BYTES) {
      return infoModal(dialogLabel, "Essa imagem é grande demais (máx. 20 MB).");
    }
    let uploadFile = file;
    if (file.size > 4 * 1024 * 1024) {
      try { uploadFile = await compressImageIfNeeded(file, 4 * 1024 * 1024); } catch (_) {}
    }

    const previewUrl = URL.createObjectURL(uploadFile);
    stagedScene = "custom";
    stagedCustomImageUrl = previewUrl;

    const grid = sceneDialogGrid();
    const existing = grid.querySelector('.scene-swatch[data-scene="custom"]');
    grid.querySelectorAll(".scene-swatch").forEach((x) => x.classList.remove("is-selected"));
    if (existing) {
      existing.style.background = "url('" + previewUrl + "') center/cover no-repeat";
      existing.classList.add("is-selected");
    } else {
      grid.insertAdjacentHTML("afterbegin", customTileHtml(previewUrl, true));
      bindSceneTileClicks(grid);
    }
    updateCurrentColorSwatch();

    try {
      const url = await MSNSupabase.uploadSceneImage(uploadFile);
      stagedCustomImageUrl = url;
      const tile = grid.querySelector('.scene-swatch[data-scene="custom"]');
      if (tile) tile.style.background = "url('" + url + "') center/cover no-repeat";
    } catch (err) {
      infoModal(dialogLabel, MSNSupabase.friendlyError(err, "Não foi possível enviar a imagem."));
    }
  }

  // Pré-visualização dentro do próprio diálogo (a bolinha "cor atual"
  // ao lado de "Mais cores...") — não altera o Dashboard de verdade.
  // Clicar num cenário/cor só fica "staged" (stagedScene/
  // stagedColorScheme) até "OK"/"Aplicar" (ver commitScene).
  function updateCurrentColorSwatch() {
    const sw = document.getElementById("color-scheme-current");
    if (!sw) return;
    sw.style.background = MSNScenes.effectiveTheme(stagedScene, stagedColorScheme);
  }

  // Salva de verdade o cenário e o esquema de cores escolhidos — na
  // conta (mode "profile", visível pros outros) ou só como plano de
  // fundo pessoal das conversas (mode "chatBackground", local, ninguém
  // mais vê).
  async function commitScene() {
    if (scenePickerMode === "chatBackground") {
      if (!currentChatContact) return;
      setPersonalChatBackground(currentChatContact.id, stagedScene, stagedColorScheme, stagedCustomImageUrl);
      addRecentChatScene(stagedScene);
      applyChatBackground();
      return;
    }
    if (!profile) return;
    const patch = {};
    if (stagedScene && stagedScene !== profile.scene) patch.scene = stagedScene;
    if (stagedColorScheme !== profile.color_scheme) patch.color_scheme = stagedColorScheme;
    if (stagedScene === "custom" && stagedCustomImageUrl !== profile.scene_image_url) {
      patch.scene_image_url = stagedCustomImageUrl;
    }
    if (!Object.keys(patch).length) return;

    Object.assign(profile, patch);
    renderProfile();
    try { await MSNSupabase.updateMyProfile(patch); } catch (_) {}
  }

  // "Fechar"/X descartam qualquer coisa aplicada nesta passagem pelo
  // diálogo — mesmo que "Aplicar" já tenha salvo de verdade (ver
  // commitScene) — e voltam ao cenário/cor que estavam ativos antes de
  // abrir o diálogo (ver originalScene/originalColorScheme/
  // originalCustomImageUrl/originalChatBackground, guardados em
  // openScenePicker).
  async function revertScene() {
    if (scenePickerMode === "chatBackground") {
      if (!currentChatContact) return;
      const cur = getPersonalChatBackground(currentChatContact.id);
      const curScene = cur && cur.scene;
      const curColor = (cur && cur.colorScheme) || null;
      const origScene = originalChatBackground && originalChatBackground.scene;
      const origColor = (originalChatBackground && originalChatBackground.colorScheme) || null;
      const origImageUrl = (originalChatBackground && originalChatBackground.sceneImageUrl) || null;
      if (curScene !== origScene || curColor !== origColor) {
        setPersonalChatBackground(currentChatContact.id, origScene, origColor, origImageUrl);
        applyChatBackground();
      }
      return;
    }
    if (!profile) return;
    const patch = {};
    if (profile.scene !== originalScene) patch.scene = originalScene;
    if (profile.color_scheme !== originalColorScheme) patch.color_scheme = originalColorScheme;
    if (profile.scene_image_url !== originalCustomImageUrl) patch.scene_image_url = originalCustomImageUrl;
    if (!Object.keys(patch).length) return;

    Object.assign(profile, patch);
    renderProfile();
    try { await MSNSupabase.updateMyProfile(patch); } catch (_) {}
  }

  // Fecha o diálogo, desfazendo qualquer "Aplicar" feito nesta
  // passagem (ver revertScene).
  async function closeScenePicker() {
    await revertScene();
    sceneDialogOverlay().hidden = true;
  }

  /* ============================================================
     JANELA DE CONVERSA
     ------------------------------------------------------------
     Dois visuais independentes:
     - Banner do topo (.chat-header): sempre o cenário/foto do
       CONTATO — simétrico, quando essa pessoa fala comigo ela vê o
       MEU cenário no topo dela (ver applyChatHeaderScene). Não dá
       pra escolher, é sempre de quem eu tô conversando.
     - "Plano de Fundo" (atrás do texto das mensagens, .chat-thread):
       se eu nunca escolhi um pra ESSA conta específica (ou limpei a
       escolha), mostra só a COR de tema dela (sólida, sem foto). Se
       eu escolhi um, mostra esse — só EU vejo, e só nessa conversa
       (guardado por contato). Fica em cache local (localStorage, pra
       aplicar na hora, sem esperar rede) e também é salvo em
       public.chat_backgrounds (ver supabase/chat_backgrounds.sql) pra
       acompanhar a conta em qualquer aparelho — carregado uma vez ao
       abrir o Dashboard (ver load()/mergeChatBackgroundsFromServer).
     ============================================================ */
  // Um plano de fundo pessoal por contato: { "<contactId>": { scene,
  // colorScheme, sceneImageUrl } }. Sem entrada pra um contato = usa a
  // cor do tema dele (ver applyChatBackground).
  function getChatBackgrounds() {
    try {
      const raw = localStorage.getItem("msn:chatBackgrounds");
      return raw ? JSON.parse(raw) : {};
    } catch (_) { return {}; }
  }
  function getPersonalChatBackground(contactId) {
    if (!contactId) return null;
    return getChatBackgrounds()[contactId] || null;
  }
  // scene=null limpa a escolha pra esse contato (volta a usar a cor do
  // tema dele). Grava local na hora (síncrono) e manda pro Supabase em
  // segundo plano (não bloqueia a UI nem tem retry — se falhar, o
  // cache local já refletiu a escolha, e o próximo load() tenta
  // sincronizar nesse aparelho de novo mais tarde).
  function setPersonalChatBackground(contactId, scene, colorScheme, sceneImageUrl) {
    if (!contactId) return;
    const imageUrl = scene === "custom" ? (sceneImageUrl || null) : null;
    try {
      const all = getChatBackgrounds();
      if (scene) all[contactId] = { scene, colorScheme: colorScheme || null, sceneImageUrl: imageUrl };
      else delete all[contactId];
      localStorage.setItem("msn:chatBackgrounds", JSON.stringify(all));
    } catch (_) {}
    MSNSupabase.setChatBackground(contactId, scene || null, colorScheme || null, imageUrl).catch(() => {});
  }

  // Traz os planos de fundo salvos no Supabase pra dentro do cache
  // local (chamado uma vez ao carregar o Dashboard — ver load()) —
  // assim uma escolha feita em outro aparelho aparece aqui também.
  // Sobrescreve o cache local por contato (o servidor é quem manda);
  // não afeta contatos sem linha salva ainda no servidor.
  function mergeChatBackgroundsFromServer(rows) {
    if (!Array.isArray(rows) || !rows.length) return;
    try {
      const all = getChatBackgrounds();
      rows.forEach((r) => {
        if (!r || !r.contact_id) return;
        all[r.contact_id] = {
          scene: r.scene || null,
          colorScheme: r.color_scheme || null,
          sceneImageUrl: r.scene_image_url || null,
        };
      });
      localStorage.setItem("msn:chatBackgrounds", JSON.stringify(all));
    } catch (_) {}
  }

  // "Recentemente usados" no menu do plano de fundo (botão 🖌) — uma
  // lista só, compartilhada entre conversas (igual ao cliente
  // clássico), mais recente primeiro.
  const RECENT_CHAT_SCENES_MAX = 6;
  function getRecentChatScenes() {
    try {
      const raw = localStorage.getItem("msn:recentChatScenes");
      return raw ? JSON.parse(raw) : [];
    } catch (_) { return []; }
  }
  function addRecentChatScene(sceneId) {
    if (!sceneId || sceneId === "custom") return;
    try {
      const list = getRecentChatScenes().filter((id) => id !== sceneId);
      list.unshift(sceneId);
      localStorage.setItem("msn:recentChatScenes", JSON.stringify(list.slice(0, RECENT_CHAT_SCENES_MAX)));
    } catch (_) {}
  }

  let currentChatContact = null;
  let chatMessagesSubscribed = false;
  let chatNudgeSubscribed = false;

  // Cenário do CONTATO no banner do topo da conversa — sempre o dele,
  // sem opção de trocar (ver comentário acima). O texto (nome/status/
  // frase pessoal) fica por cima da foto, empurrado pra direita (ver
  // margin-left de .chat-header__info no CSS) — por isso ainda precisa
  // do contraste dinâmico (is-light-scene), igual ao .dash-header.
  function applyChatHeaderScene() {
    const header = document.querySelector(".chat-header");
    if (!header || !currentChatContact) return;
    const c = currentChatContact;
    const sceneId = c.scene || SCENES[0].id;
    const tintHex = MSNScenes.colorSchemeHex(c.color_scheme);
    header.style.setProperty("--chat-scene", resolveSceneBg(sceneId, c.scene_image_url, tintHex));
    updateHeaderTextContrast(header, sceneId, c.scene_image_url);
    // Mesma cor de tema do banner também embaixo (borda da caixa de
    // composição) — pra dar a sensação de "moldura" colorida na janela
    // inteira, não só no topo (ver .chat-compose no CSS).
    const body = document.querySelector(".chat-body");
    if (body) body.style.setProperty("--chat-theme", MSNScenes.effectiveTheme(sceneId, c.color_scheme));
  }

  // Resolve e aplica o "Plano de Fundo" (atrás do texto das
  // mensagens) da conversa atualmente aberta.
  function applyChatBackground() {
    const thread = document.getElementById("chat-thread");
    if (!thread || !currentChatContact) return;
    const myBg = getPersonalChatBackground(currentChatContact.id);
    if (myBg && myBg.scene) {
      const tintHex = MSNScenes.colorSchemeHex(myBg.colorScheme);
      // MSNScenes.bg()/resolveSceneBg() devolvem um valor pra
      // propriedade "background" (shorthand) — não pra
      // "background-image" sozinha (ver .dash-header, mesma técnica).
      thread.style.background = resolveSceneBg(myBg.scene, myBg.sceneImageUrl, tintHex);
    } else {
      // Sem escolha pessoal pra esse contato: só a cor do tema dele,
      // sólida (a foto/cenário fica reservada pro banner do topo).
      thread.style.background = MSNScenes.effectiveTheme(currentChatContact.scene, currentChatContact.color_scheme);
    }
  }

  function chatStatusFrameMarkup(avatarUrl, status) {
    return statusFrameMarkup(avatarUrl, status);
  }

  function renderChatHeader() {
    const c = currentChatContact;
    if (!c) return;
    // Mesma regra da lista de contatos: contato invisível aparece como
    // offline aqui também (ver contactVisibleStatus).
    const status = contactVisibleStatus(c.status, c.id);
    document.getElementById("chat-titlebar-text").textContent = c.email || c.display_name || "";
    document.getElementById("chat-contact-name").textContent = c.display_name || c.email || "";
    document.getElementById("chat-contact-status").textContent = "(" + (STATUS_LABEL[status] || "Offline") + ")";
    const subnickEl = document.getElementById("chat-contact-subnick");
    if (subnickEl) {
      subnickEl.textContent = c.sub_nick || "";
      subnickEl.hidden = !c.sub_nick;
    }
    document.getElementById("chat-contact-avatar").innerHTML = chatStatusFrameMarkup(c.avatar_url, status || "offline");

    const myAvatar = document.getElementById("chat-my-avatar");
    myAvatar.innerHTML = chatStatusFrameMarkup(profile && profile.avatar_url, (profile && profile.status) || "online");

    const isOffline = !["online", "busy", "away"].includes(status);
    // "blocked" (ver forcedOfflineReasons/refreshForcedOffline): ESSE
    // contato me bloqueou — não é "parece estar offline" comum, é
    // bloqueio de verdade, então o aviso e a caixa de mensagem inteira
    // mudam (ver isBlockedByContact abaixo).
    const isBlockedByContact = forcedOfflineReasons.get(String(c.id)) === "blocked";
    const banner = document.getElementById("chat-offline-banner");
    banner.hidden = !isOffline;
    if (isOffline) {
      const textEl = document.getElementById("chat-offline-banner-text");
      textEl.innerHTML = "";
      if (isBlockedByContact) {
        textEl.appendChild(document.createTextNode(
          (c.email || c.display_name) + " bloqueou você. Não é possível enviar mensagens, imagens ou emoticons para esse contato, e ele não verá atualizações da sua foto, cenário ou cor do tema."
        ));
      } else {
        textEl.appendChild(document.createTextNode(
          (c.email || c.display_name) + " parece estar offline. As mensagens serão entregues quando esse contato entrar. "
        ));
        const mailLink = document.createElement("a");
        mailLink.href = "mailto:" + (c.email || "");
        mailLink.textContent = "Enviar um e-mail para este contato";
        textEl.appendChild(mailLink);
      }
    }

    // Com o contato offline, "Chamar a atenção" (nudge, ninguém do
    // outro lado pra tremer a tela na hora) e "Enviar uma imagem"
    // deveriam sumir da barra — só ficam emoji, fonte e plano de
    // fundo. TEMPORARIAMENTE desligado a pedido (deixar os dois
    // aparecerem sempre, mesmo offline, enquanto ainda estão sendo
    // construídos) — reative as duas linhas abaixo quando terminar.
    const nudgeBtn = document.getElementById("chat-nudge-btn");
    if (nudgeBtn) nudgeBtn.hidden = false; // era: isOffline
    const imageBtn = document.getElementById("chat-image-btn");
    if (imageBtn) imageBtn.hidden = false; // era: isOffline

    applyChatBlockedLockdown(isBlockedByContact);
  }

  // Trava a caixa de mensagem inteira quando o contato aberto me
  // bloqueou — diferente do "offline" comum (nudge/imagem continuam
  // ligados de propósito, ver comentário acima), aqui NADA pode ser
  // enviado: emoji, imagem, "chamar a atenção", plano de fundo, texto
  // e o botão Enviar. disabled=true (não só "hidden") pra também
  // bloquear o teclado/Enter, não só o clique no botão.
  function applyChatBlockedLockdown(isBlocked) {
    const compose = document.querySelector(".chat-compose");
    if (compose) compose.classList.toggle("is-blocked-lockdown", isBlocked);
    ["chat-input", "chat-send-btn", "chat-emoji-btn", "chat-image-btn", "chat-nudge-btn", "chat-bg-btn"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.disabled = isBlocked;
    });
    if (isBlocked) {
      document.getElementById("chat-emoji-picker").hidden = true;
      document.getElementById("chat-bg-picker").hidden = true;
    }
  }

  // Só guardamos texto puro no banco (ver supabase/schema.sql) — GIFs e
  // emojis não são armazenados como tal, são reconstruídos aqui na hora
  // de exibir: um link de imagem vira uma tag <img>, e um "emoticon" de
  // texto (":)" etc.) vira o emoji de verdade. Assim a mensagem
  // continua sendo só texto pra qualquer finalidade (busca, limpeza
  // automática por idade — ver supabase/retention.sql).
  const CHAT_MEDIA_URL_RE = /^https?:\/\/\S+\.(gif|png|jpe?g|webp)(\?\S*)?$/i;
  const EMOTICON_RULES = [
    { re: /:'\(/g, emoji: "😢" },
    { re: /:-?\)/g, emoji: "🙂" },
    { re: /:-?\(/g, emoji: "🙁" },
    { re: /:-?[Dd]/g, emoji: "😀" },
    { re: /;-?\)/g, emoji: "😉" },
    { re: /:-?[Pp]/g, emoji: "😛" },
    { re: /:-?[Oo]/g, emoji: "😮" },
    { re: /<3/g, emoji: "❤️" },
    { re: /\bxd\b/gi, emoji: "😆" },
  ];
  function applyEmoticons(text) {
    return EMOTICON_RULES.reduce((out, rule) => out.replace(rule.re, rule.emoji), text);
  }

  function chatMessageBubble(msg) {
    const li = document.createElement("li");
    const mine = String(msg.sender_id) === String(profile && profile.id);
    li.className = "chat-message " + (mine ? "chat-message--mine" : "chat-message--theirs");
    const content = msg.content || "";
    const mediaUrl = CHAT_MEDIA_URL_RE.test(content.trim()) ? content.trim() : null;
    if (mediaUrl) {
      const img = document.createElement("img");
      img.className = "chat-message__media";
      img.src = mediaUrl;
      img.alt = "";
      img.loading = "lazy";
      li.appendChild(img);
    } else {
      const text = document.createElement("span");
      text.textContent = applyEmoticons(content);
      li.appendChild(text);
    }
    const time = document.createElement("span");
    time.className = "chat-message__time";
    try {
      time.textContent = new Date(msg.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    } catch (_) {}
    li.appendChild(time);
    return li;
  }

  async function loadChatMessages() {
    const list = document.getElementById("chat-messages");
    list.innerHTML = "";
    if (!currentChatContact) return;
    try {
      const msgs = await MSNSupabase.getMessages(currentChatContact.id);
      msgs.forEach((m) => list.appendChild(chatMessageBubble(m)));
      scrollChatToBottom();
    } catch (_) {}
  }

  function scrollChatToBottom() {
    // Quem rola é a lista de mensagens (#chat-messages), não mais
    // #chat-thread — ele virou só a linha que também contém a
    // barrinha de esconder fotos, sempre visível (ver CSS).
    const messages = document.getElementById("chat-messages");
    if (messages) messages.scrollTop = messages.scrollHeight;
  }

  function subscribeChatRealtime() {
    if (chatMessagesSubscribed) return;
    MSNSupabase.subscribeMessages((msg) => {
      if (!currentChatContact) return;
      // As minhas próprias mensagens já aparecem na hora em
      // sendChatMessage() (assim que o envio confirma, sem esperar o
      // tempo real) — o subscribe não filtra por remetente no
      // Supabase (ver subscribeMessages em supabase-client.js), então
      // ecoa de volta pra mim também; sem este "return" cedo, a
      // mensagem aparecia duas vezes (uma da confirmação do envio,
      // outra do próprio eco). Esse listener cuida só das mensagens
      // QUE CHEGAM de quem eu estou conversando.
      if (String(msg.sender_id) === String(profile && profile.id)) return;
      const cid = String(currentChatContact.id);
      const involved = String(msg.sender_id) === cid && String(msg.receiver_id) === String(profile && profile.id);
      if (!involved) return;
      document.getElementById("chat-messages").appendChild(chatMessageBubble(msg));
      scrollChatToBottom();
      if (!currentChatContact.is_muted) SoundManager.play("message");
    });
    chatMessagesSubscribed = true;
  }

  function subscribeChatNudges() {
    if (chatNudgeSubscribed) return;
    MSNSupabase.subscribeNudges((nudge) => {
      if (!currentChatContact) return;
      if (String(nudge.sender_id) !== String(currentChatContact.id)) return;
      if (String(nudge.receiver_id) !== String(profile && profile.id)) return;
      triggerNudgeShake();
      if (!currentChatContact.is_muted) SoundManager.play("nudge");
    });
    chatNudgeSubscribed = true;
  }

  function triggerNudgeShake() {
    const win = document.getElementById("screen-chat");
    if (!win) return;
    win.classList.remove("nudge-shake");
    void win.offsetWidth;
    win.classList.add("nudge-shake");
    // Sem isso a classe ficava pra sempre no elemento — a animação (só
    // 0.6s, sem "infinite") não repetia sozinha enquanto a janela
    // continuava aberta, mas o CSS de tela usa display:none pra
    // esconder/mostrar (ver .screen/.screen--active): toda vez que a
    // conversa fechava e abria de novo, o navegador tratava como um
    // elemento "novo" aparecendo com a classe já aplicada e tocava a
    // animação de novo sozinha, sem clicar em nada — daí o tremor
    // "persistente" ao reabrir a conversa. Remove a classe assim que a
    // animação termina, então só treme quando alguém realmente manda
    // ou recebe um "Chamar a atenção".
    win.addEventListener("animationend", () => win.classList.remove("nudge-shake"), { once: true });
  }

  // Alguém que me bloqueou também nunca deve conseguir mandar nada pra
  // mim (server já recusa via RLS, ver supabase/security_hardening.sql
  // e contact_settings.sql — isso aqui é só pra nem tentar a chamada e
  // não deixar a caixa de texto "funcionando" visualmente por engano).
  function isChatLockedByBlock() {
    return !!(currentChatContact && forcedOfflineReasons.get(String(currentChatContact.id)) === "blocked");
  }

  async function sendChatMessage() {
    if (isChatLockedByBlock()) return;
    const input = document.getElementById("chat-input");
    const text = input.value.trim();
    if (!text || !currentChatContact) return;
    input.value = "";
    try {
      const msg = await MSNSupabase.sendMessage(currentChatContact.id, text);
      // Já mostra na hora (o realtime só ecoa mensagens de outras
      // pessoas de qualquer forma, já que o filtro do Supabase não
      // exclui o próprio remetente — evita duplicar aqui).
      document.getElementById("chat-messages").appendChild(chatMessageBubble({
        sender_id: (profile && profile.id) || "demo",
        content: text,
        created_at: (msg && msg.created_at) || new Date().toISOString(),
      }));
      scrollChatToBottom();
    } catch (_) {}
  }

  async function sendChatNudge() {
    if (!currentChatContact || isChatLockedByBlock()) return;
    triggerNudgeShake();
    try { await MSNSupabase.sendNudge(currentChatContact.id); } catch (_) {}
  }

  const CHAT_EMOJIS = ["😀","😂","😉","😍","😎","😭","😡","👍","👎","❤️","💔","🎉","🔥","⭐","☕","🎵","😴","🤔","😅","🙈","👋","✌️","🙏","💬"];
  function toggleEmojiPicker() {
    const picker = document.getElementById("chat-emoji-picker");
    const open = picker.hidden;
    if (open && !picker.childElementCount) {
      picker.innerHTML = CHAT_EMOJIS.map((e) => '<button type="button">' + e + "</button>").join("");
      picker.querySelectorAll("button").forEach((btn) => {
        btn.addEventListener("click", () => {
          const input = document.getElementById("chat-input");
          input.value += btn.textContent;
          input.focus();
        });
      });
    }
    picker.hidden = !open;
  }

  // Menu rápido "Seus Planos de Fundo" (botão 🖌) — mostra os últimos
  // cenários usados como plano de fundo em QUALQUER conversa (lista
  // compartilhada, igual ao cliente clássico) e a opção "nenhum"
  // (volta a usar a cor do tema do contato). Pra mais opções (cor
  // separada, cenário fora da lista de recentes), "Mostrar tudo..."
  // abre o diálogo completo de sempre.
  function toggleChatBgPicker() {
    const picker = document.getElementById("chat-bg-picker");
    const open = picker.hidden;
    if (open) renderChatBgPicker();
    picker.hidden = !open;
    if (open) positionChatBgPicker();
  }

  // Posiciona via "position: fixed" calculado em JS (não mais
  // "absolute" ancorado num ancestral) — mais confiável em telas
  // pequenas/teclado aberto, e nunca fica cortado por overflow de
  // algum elemento no meio do caminho até o botão. Ancorado pelo
  // canto superior direito do botão 🖌, com folga das bordas da tela.
  const CHAT_BG_PICKER_WIDTH = 268;
  function positionChatBgPicker() {
    const btn = document.getElementById("chat-bg-btn");
    const picker = document.getElementById("chat-bg-picker");
    if (!btn || !picker) return;
    const rect = btn.getBoundingClientRect();
    const margin = 8;
    let left = rect.right - CHAT_BG_PICKER_WIDTH;
    left = Math.max(margin, Math.min(left, window.innerWidth - CHAT_BG_PICKER_WIDTH - margin));
    picker.style.left = left + "px";
    picker.style.bottom = (window.innerHeight - rect.top + 6) + "px";
  }

  function renderChatBgPicker() {
    const grid = document.getElementById("chat-bg-recent-grid");
    if (!grid || !currentChatContact) return;
    const mine = getPersonalChatBackground(currentChatContact.id);
    const currentScene = mine ? mine.scene : null;

    const recentSwatches = getRecentChatScenes().map((id) => {
      const s = MSNScenes.find(id);
      if (!s) return "";
      const selected = currentScene === id;
      const img = MSNScenes.example(id) || MSNScenes.image(id);
      return (
        '<button type="button" class="chat-bg-picker__swatch' + (selected ? " is-selected" : "") +
        '" data-scene="' + id + '" style="background-image:url(\'' + img + '\')" title="' + esc(s.name) + '">' +
        (selected ? '<span class="chat-bg-picker__check">✓</span>' : "") +
        "</button>"
      );
    }).join("");

    const noneSelected = !currentScene;
    const noneSwatch =
      '<button type="button" class="chat-bg-picker__swatch chat-bg-picker__swatch--none' +
      (noneSelected ? " is-selected" : "") + '" data-scene="" title="Usar a cor do tema do contato">' +
      (noneSelected ? '<span class="chat-bg-picker__check">✓</span>' : "") +
      "</button>";

    grid.innerHTML = recentSwatches + noneSwatch;
    grid.querySelectorAll(".chat-bg-picker__swatch").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (!currentChatContact) return;
        const sceneId = btn.dataset.scene || null;
        setPersonalChatBackground(currentChatContact.id, sceneId, null);
        if (sceneId) addRecentChatScene(sceneId);
        applyChatBackground();
        document.getElementById("chat-bg-picker").hidden = true;
      });
    });
  }

  function openChat(contact) {
    currentChatContact = contact;
    UIManager.showScreen("screen-chat");
    renderChatHeader();
    applyChatHeaderScene();
    applyChatBackground();
    document.getElementById("chat-emoji-picker").hidden = true;
    document.getElementById("chat-bg-picker").hidden = true;
    document.getElementById("chat-input").value = "";
    loadChatMessages();
    subscribeChatRealtime();
    subscribeChatNudges();
    // Confere de novo se fui bloqueado nesse meio-tempo (desde o
    // último load() do Dashboard) — sem isso, um bloqueio recente só
    // travaria a caixa de mensagem na próxima vez que o Dashboard
    // inteiro recarregasse, não na hora de abrir essa conversa.
    refreshForcedOffline().then(() => {
      if (currentChatContact && currentChatContact.id === contact.id) renderChatHeader();
    });
    setTimeout(() => document.getElementById("chat-input").focus(), 30);
    // Empilha um estado só pra isso: o botão "voltar" do aparelho
    // (Android) volta pro Dashboard em vez de sair do app/PWA — ver o
    // listener de popstate em bindEvents, que faz a troca de tela de
    // verdade. O botão "X" da própria janela chama history.back() (não
    // troca de tela direto) pra passar pelo mesmo caminho e manter o
    // histórico do navegador consistente nos dois casos.
    try { history.pushState({ msnScreen: "chat" }, ""); } catch (_) {}
  }

  // Só a troca de tela de verdade — chamada pelo popstate (botão
  // voltar) depois que o navegador já saiu do estado "chat" sozinho.
  // Nunca chame direto pra fechar a janela por um clique (ver
  // chat-close em bindEvents, que usa history.back() em vez disso).
  function closeChat() {
    currentChatContact = null;
    UIManager.showScreen("screen-dashboard");
  }

  /* ---------- Opções ----------
     Só a categoria "Pessoal" tem conteúdo de verdade; as demais (Layout,
     Entrar, Mensagens...) abrem uma página em branco — mesmo padrão do
     cliente clássico, mas sem a funcionalidade por trás delas ainda.
     A lista de categorias fica recolhida por padrão (botão-toggle) pra
     poupar espaço na tela do mobile. */
  function openOptionsDialog() {
    document.getElementById("opt-display-name").value = profile ? profile.display_name || "" : "";
    document.getElementById("opt-sub-nick").value = profile ? profile.sub_nick || "" : "";
    document.getElementById("opt-auto-away").checked = autoAwayEnabled;
    document.getElementById("opt-auto-away-minutes").value = autoAwayMinutes;
    resetOptionsNav();
    document.getElementById("options-dialog").hidden = false;
  }

  function resetOptionsNav() {
    document.getElementById("options-nav").hidden = true;
    document.getElementById("options-nav-toggle").setAttribute("aria-expanded", "false");
    document.getElementById("options-nav-current").textContent = "Pessoal";
    document.querySelectorAll(".options-nav__item").forEach((it) =>
      it.classList.toggle("is-active", it.dataset.tab === "personal"));
    document.getElementById("options-pane-personal").hidden = false;
    document.getElementById("options-pane-layout").hidden = true;
    document.getElementById("options-pane-messages").hidden = true;
    document.getElementById("options-pane-alerts").hidden = true;
    document.getElementById("options-pane-privacy").hidden = true;
    document.getElementById("options-pane-security").hidden = true;
    document.getElementById("options-pane-blank").hidden = true;
  }

  function closeOptionsDialog() {
    document.getElementById("options-dialog").hidden = true;
  }

  // Salva nome/mensagem pessoal, "Ausente" automático (aba Pessoal) e
  // as preferências de Layout — sempre lê os dois formulários, mesmo
  // que só um esteja visível no momento (os valores continuam no DOM).
  async function commitOptions() {
    autoAwayEnabled = document.getElementById("opt-auto-away").checked;
    const minutesVal = parseInt(document.getElementById("opt-auto-away-minutes").value, 10);
    autoAwayMinutes = minutesVal > 0 ? minutesVal : autoAwayMinutes;
    document.getElementById("opt-auto-away-minutes").value = autoAwayMinutes;
    saveAutoAwayPrefs();
    // Desativar/aumentar o intervalo enquanto estava "away" por
    // inatividade não deveria manter o auto-away supostamente já
    // "vencido" — reinicia a contagem a partir de agora.
    markActivity();

    commitLayoutPrefs();
    commitMessagePrefs();

    if (!profile) return;
    const nameVal = document.getElementById("opt-display-name").value.trim();
    const subVal = document.getElementById("opt-sub-nick").value.trim();
    const patch = {};
    if (nameVal && nameVal !== profile.display_name) patch.display_name = nameVal;
    if (subVal !== (profile.sub_nick || "")) patch.sub_nick = subVal;
    if (!Object.keys(patch).length) return;

    Object.assign(profile, patch);
    renderProfile();
    try { await MSNSupabase.updateMyProfile(patch); } catch (_) {}
  }

  /* ---------- Adicionar um contato ----------
     Mesmo estilo visual do "Criar um grupo" (titlebar "Windows Live
     Messenger" + faixa com ícone), no lugar do modal genérico usado
     antes. */
  function openAddContactDialog() {
    const input = document.getElementById("add-contact-email-input");
    const msg = document.getElementById("add-contact-message");
    input.value = "";
    msg.hidden = true;
    document.getElementById("add-contact-dialog").hidden = false;
    setTimeout(() => input.focus(), 30);
  }

  function closeAddContactDialog() {
    document.getElementById("add-contact-dialog").hidden = true;
  }

  async function submitAddContact() {
    const input = document.getElementById("add-contact-email-input");
    const msg = document.getElementById("add-contact-message");
    const val = input.value.trim();
    if (!val) {
      msg.textContent = "Digite o e-mail do contato.";
      msg.hidden = false;
      return;
    }
    try {
      await MSNSupabase.addContactByEmail(val);
      await load();
      closeAddContactDialog();
    } catch (err) {
      msg.textContent = err.message || "Não foi possível adicionar.";
      msg.hidden = false;
    }
  }

  /* ---------- Criar um grupo ----------
     Nome do grupo + seleção dos contatos já adicionados. Clicar num
     contato alterna sua aparência para "selecionado" (visual de botão
     pressionado) — sem checkboxes, como pedido. */
  let selectedGroupMembers = null;

  function openGroupPicker() {
    selectedGroupMembers = new Set();
    const nameInput = document.getElementById("group-name-input");
    nameInput.value = "";
    const list = document.getElementById("group-contact-list");

    if (!contacts.length) {
      list.innerHTML = '<p class="group-contacts-empty">Você ainda não tem contatos adicionados.</p>';
    } else {
      list.innerHTML = contacts.map((c) =>
        '<button type="button" class="group-contact-btn" data-id="' + esc(c.id) + '">' +
        '<span class="group-contact-btn__avatar">' + avatarMarkup(c.avatar_url) + "</span>" +
        "<span>" + esc(c.display_name) + "</span></button>"
      ).join("");
      list.querySelectorAll(".group-contact-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          const id = btn.dataset.id;
          if (selectedGroupMembers.has(id)) {
            selectedGroupMembers.delete(id);
            btn.classList.remove("is-selected");
          } else {
            selectedGroupMembers.add(id);
            btn.classList.add("is-selected");
          }
        });
      });
    }

    document.getElementById("group-picker").hidden = false;
    setTimeout(() => nameInput.focus(), 30);
  }

  function closeGroupPicker() {
    document.getElementById("group-picker").hidden = true;
  }

  async function submitGroup() {
    const name = document.getElementById("group-name-input").value.trim();
    if (!name) {
      infoModal("Criar um grupo", "Digite um nome para o grupo.");
      return;
    }
    try {
      await MSNSupabase.createGroup(name, Array.from(selectedGroupMembers || []));
      closeGroupPicker();
      groups = await MSNSupabase.getGroups();
      renderGroupShells();
      renderContacts(currentFilter);
    } catch (err) {
      infoModal("Criar um grupo", err.message || "Não foi possível criar o grupo.");
    }
  }

  /* ---------- Convidar amigos (compartilhar link) ----------
     Compartilha o link do site (index.html), de onde a pessoa convidada
     pode instalar o app ("Adicionar App") ou entrar direto. */
  function inviteUrl() {
    return new URL("index.html", window.location.href).href;
  }

  async function shareInviteLink() {
    const url = inviteUrl();
    const name = (profile && profile.display_name) || "Um amigo";
    const shareData = {
      title: "MSN - Mobile Social Network",
      text: name + " te chamou para conversar no MSN! 💬",
      url: url,
    };

    if (navigator.share) {
      try { await navigator.share(shareData); } catch (_) { /* usuário cancelou */ }
      return;
    }

    try {
      await navigator.clipboard.writeText(url);
      infoModal("Convidar amigos", "Link copiado! Envie para seus amigos:\n" + url);
    } catch (_) {
      infoModal("Convidar amigos", "Copie o link e envie para seus amigos:\n" + url);
    }
  }

  async function doSignOut() {
    MSNSupabase.unsubscribeContacts();
    contactsSubscribed = false;
    // Sai do canal de presença antes de deslogar de fato — isso avisa
    // os outros na hora que esse aparelho não conta mais (ver
    // subscribePresence em supabase-client.js). Se ainda houver outro
    // aparelho/aba conectado nessa mesma conta, ela continua "online"
    // normalmente (a chave só some quando a última conexão cai).
    MSNSupabase.unsubscribePresence();
    presenceSubscribed = false;
    presenceReady = false;
    presenceOnlineIds = new Set();
    // Antes de sair, atualiza o cenário/tema/foto lembrados dessa conta
    // (caso tenham mudado durante a sessão) — assim a tela de login já
    // mostra a versão mais recente na próxima vez, e não só a que
    // existia no último login.
    try {
      if (profile) {
        App.updateRememberedTheme(profile.email, profile.scene, profile.color_scheme, profile.avatar_url);
      }
    } catch (_) {}
    try { await MSNSupabase.signOut(); } catch (_) {}
    // Ao sair, desliga o auto-login (mas mantém e-mail/senha lembrados).
    try { localStorage.setItem("msn:autoSignin", "false"); } catch (_) {}
    SoundManager.play("logout");
    UIManager.showScreen("screen-login");
  }

  /* ---------- Eventos ---------- */
  function bindEvents() {
    startIdleWatch();
    loadLayoutPrefs();
    applyLayoutVisuals();
    loadMessagePrefs();
    bindSceneBannerPullToRefresh();

    // Se a pessoa conceder uma permissão fora do app (ex.: configurações
    // de notificação do celular, com o app em segundo plano) e voltar
    // pra aba Alertas, a chave/badge não tinha como saber sozinha —
    // reconsulta o estado de verdade sempre que a aba volta a ficar
    // visível enquanto Alertas está aberta.
    const refreshPermissionsIfVisible = () => {
      if (document.visibilityState !== "visible") return;
      const pane = document.getElementById("options-pane-alerts");
      if (pane && !pane.hidden) renderPermissions();
    };
    document.addEventListener("visibilitychange", refreshPermissionsIfVisible);
    window.addEventListener("focus", refreshPermissionsIfVisible);

    // Menu do nick (status + ações do perfil)
    const menu = document.getElementById("my-menu");
    const nameBtn = document.getElementById("my-name-btn");
    const stToggle = document.getElementById("my-status-toggle");
    const nameRow = document.querySelector(".my-name-row");
    const closeMenu = () => {
      menu.hidden = true;
      stToggle.setAttribute("aria-expanded", "false");
      if (nameRow) nameRow.classList.remove("is-open");
    };
    const openMenu = (e) => {
      e.stopPropagation();
      const open = menu.hidden;
      closeOtherDropdowns(closeMenu);
      if (open) markSelectedStatus();
      menu.hidden = !open;
      stToggle.setAttribute("aria-expanded", String(open));
      if (nameRow) nameRow.classList.toggle("is-open", open);
    };
    nameBtn.addEventListener("click", openMenu);
    stToggle.addEventListener("click", openMenu);
    document.addEventListener("click", closeMenu);
    menu.addEventListener("click", (e) => e.stopPropagation());
    registerDropdown(closeMenu);

    // Itens de status — troca manual sempre prevalece sobre o
    // auto-away (cancela o "away" automático e reinicia a contagem).
    menu.querySelectorAll(".my-menu__status").forEach((item) => {
      item.addEventListener("click", async () => {
        closeMenu();
        if (!profile) return;
        isAutoAway = false;
        markActivity();
        profile.status = item.dataset.status;
        renderProfile();
        try { await MSNSupabase.updateMyProfile({ status: profile.status }); } catch (_) {}
      });
    });

    // Ações do menu
    menu.querySelectorAll("[data-action]").forEach((item) => {
      item.addEventListener("click", () => {
        closeMenu();
        handleMenuAction(item.dataset.action);
      });
    });

    // Editar mensagem pessoal (subnick) — direto no campo, sem overlay,
    // igual à barra de busca: digita e salva ao sair do campo/Enter.
    const subInput = document.getElementById("my-subnick-input");
    if (subInput) {
      const saveSubnick = async () => {
        const val = subInput.value.trim();
        if (!profile || val === (profile.sub_nick || "")) return;
        profile.sub_nick = val;
        try { await MSNSupabase.updateMyProfile({ sub_nick: val }); } catch (_) {}
      };
      subInput.addEventListener("blur", saveSubnick);
      subInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") subInput.blur();
        else if (e.key === "Escape") {
          subInput.value = profile ? profile.sub_nick || "" : "";
          subInput.blur();
        }
      });
    }

    // Adicionar (dropdown: contato / grupo)
    const addBtn = document.getElementById("btn-add-contact");
    const addMenu = document.getElementById("add-contact-menu");
    const closeAddMenu = () => {
      addMenu.hidden = true;
      addBtn.setAttribute("aria-expanded", "false");
    };
    addBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = addMenu.hidden;
      closeOtherDropdowns(closeAddMenu);
      addMenu.hidden = !open;
      addBtn.setAttribute("aria-expanded", String(open));
    });
    addMenu.addEventListener("click", (e) => e.stopPropagation());
    document.addEventListener("click", closeAddMenu);
    registerDropdown(closeAddMenu);
    addMenu.querySelectorAll("[data-action]").forEach((item) => {
      item.addEventListener("click", () => {
        closeAddMenu();
        if (item.dataset.action === "add-contact") openAddContactDialog();
        else if (item.dataset.action === "create-group") openGroupPicker();
      });
    });

    // Busca
    document.getElementById("contact-search").addEventListener("input", (e) => {
      currentFilter = e.target.value;
      renderContacts(currentFilter);
    });

    // Foto de exibição: clicar abre "Selecione uma Imagem para
    // Exibição" (galeria + "Procurar..." pra enviar uma própria)
    const avatarInput = document.getElementById("avatar-input");
    if (avatarInput) avatarInput.addEventListener("change", onAvatarSelected);

    const avatarBtn = document.getElementById("my-avatar-btn");
    if (avatarBtn) avatarBtn.addEventListener("click", changePicture);

    const avatarBrowse = document.getElementById("avatar-browse");
    if (avatarBrowse && avatarInput) avatarBrowse.addEventListener("click", () => avatarInput.click());

    // "Imagem da Webcam..." — mesmo fluxo de envio do "Procurar...",
    // mas o input tem capture="user" para abrir a câmera direto.
    const avatarWebcamInput = document.getElementById("avatar-webcam-input");
    if (avatarWebcamInput) avatarWebcamInput.addEventListener("change", onAvatarSelected);
    const avatarWebcam = document.getElementById("avatar-webcam");
    if (avatarWebcam && avatarWebcamInput) avatarWebcam.addEventListener("click", () => avatarWebcamInput.click());

    const avatarRemove = document.getElementById("avatar-remove");
    if (avatarRemove) avatarRemove.addEventListener("click", removeAvatarSelection);

    const avatarOk = document.getElementById("avatar-ok");
    if (avatarOk) avatarOk.addEventListener("click", commitAvatarPicker);
    const avatarClose = document.getElementById("avatar-close");
    if (avatarClose) avatarClose.addEventListener("click", closeAvatarPicker);
    const avatarX = document.getElementById("avatar-dialog-x");
    if (avatarX) avatarX.addEventListener("click", closeAvatarPicker);

    // Seletor de cenário: OK (salva e fecha) / Aplicar (salva, mantém
    // aberto) / Fechar e X (descartam a prévia e fecham)
    const sceneOk = document.getElementById("scene-ok");
    if (sceneOk) sceneOk.addEventListener("click", async () => {
      await commitScene();
      document.getElementById("scene-picker").hidden = true;
    });
    const sceneApply = document.getElementById("scene-apply");
    if (sceneApply) sceneApply.addEventListener("click", commitScene);
    const sceneClose = document.getElementById("scene-close");
    if (sceneClose) sceneClose.addEventListener("click", closeScenePicker);
    const sceneX = document.getElementById("scene-dialog-x");
    if (sceneX) sceneX.addEventListener("click", closeScenePicker);

    // Botão "Procurar..." (cenário customizado enviado pelo usuário)
    const sceneBrowse = document.getElementById("scene-browse");
    const sceneImageInput = document.getElementById("scene-image-input");
    if (sceneBrowse && sceneImageInput) {
      sceneBrowse.addEventListener("click", () => sceneImageInput.click());
      sceneImageInput.addEventListener("change", onSceneImageSelected);
    }

    // Diálogo "Planos de fundo" (conversa) — mesmos botões/fluxo do
    // seletor de cenário acima (OK/Aplicar/Fechar/X/Procurar), só que
    // no diálogo dedicado (ver openScenePicker("chatBackground")).
    const bgOk = document.getElementById("bg-ok");
    if (bgOk) bgOk.addEventListener("click", async () => {
      await commitScene();
      sceneDialogOverlay().hidden = true;
    });
    const bgApply = document.getElementById("bg-apply");
    if (bgApply) bgApply.addEventListener("click", commitScene);
    const bgClose = document.getElementById("bg-close");
    if (bgClose) bgClose.addEventListener("click", closeScenePicker);
    const bgX = document.getElementById("bg-dialog-x");
    if (bgX) bgX.addEventListener("click", closeScenePicker);
    const bgBrowse = document.getElementById("bg-browse");
    if (bgBrowse && sceneImageInput) bgBrowse.addEventListener("click", () => sceneImageInput.click());
    const bgRemove = document.getElementById("bg-remove");
    if (bgRemove) bgRemove.addEventListener("click", stageNoneInBgDialog);
    // "Definir padrão": mesmo resultado que "Remover"/selecionar
    // "Nenhum" no grid — nesta conversa, "padrão" É a cor do tema do
    // contato (ver bg-default-preview em openScenePicker).
    const bgSetDefault = document.getElementById("bg-set-default");
    if (bgSetDefault) bgSetDefault.addEventListener("click", stageNoneInBgDialog);

    // "Mais cores..." (seletor de cor nativo)
    const colorMoreBtn = document.getElementById("color-scheme-more-btn");
    const colorNative = document.getElementById("color-scheme-native");
    if (colorMoreBtn && colorNative) {
      colorMoreBtn.addEventListener("click", () => colorNative.click());
      colorNative.addEventListener("input", () => {
        stagedColorScheme = colorNative.value;
        document.querySelectorAll("#color-scheme-grid .color-swatch").forEach((el) =>
          el.classList.remove("is-selected"));
        updateCurrentColorSwatch();
      });
    }

    // Criar um grupo: OK (cria) / Cancelar e X (descartam)
    const groupOk = document.getElementById("group-ok");
    if (groupOk) groupOk.addEventListener("click", submitGroup);
    const groupCancel = document.getElementById("group-cancel");
    if (groupCancel) groupCancel.addEventListener("click", closeGroupPicker);
    const groupX = document.getElementById("group-dialog-x");
    if (groupX) groupX.addEventListener("click", closeGroupPicker);

    // Adicionar um contato: OK (envia) / Cancelar e X (descartam)
    const addContactOk = document.getElementById("add-contact-ok");
    if (addContactOk) addContactOk.addEventListener("click", submitAddContact);
    const addContactCancel = document.getElementById("add-contact-cancel");
    if (addContactCancel) addContactCancel.addEventListener("click", closeAddContactDialog);
    const addContactX = document.getElementById("add-contact-dialog-x");
    if (addContactX) addContactX.addEventListener("click", closeAddContactDialog);
    const addContactInput = document.getElementById("add-contact-email-input");
    if (addContactInput) addContactInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submitAddContact();
      else if (e.key === "Escape") closeAddContactDialog();
    });

    // Opções: toggle da lista de categorias (recolhida por padrão)
    const optNavToggle = document.getElementById("options-nav-toggle");
    const optNav = document.getElementById("options-nav");
    if (optNavToggle && optNav) {
      optNavToggle.addEventListener("click", () => {
        const open = optNav.hidden;
        optNav.hidden = !open;
        optNavToggle.setAttribute("aria-expanded", String(open));
      });
    }
    // Trocar de categoria: "Pessoal" e "Layout" mostram conteúdo de
    // verdade, as demais mostram uma página em branco. Escolher uma
    // categoria já recolhe a lista de volta (poupa espaço).
    document.querySelectorAll(".options-nav__item").forEach((item) => {
      item.addEventListener("click", () => {
        document.querySelectorAll(".options-nav__item").forEach((x) => x.classList.remove("is-active"));
        item.classList.add("is-active");
        document.getElementById("options-nav-current").textContent = item.textContent;
        const tab = item.dataset.tab;
        const knownTabs = ["personal", "layout", "messages", "alerts", "privacy", "security"];
        document.getElementById("options-pane-personal").hidden = tab !== "personal";
        document.getElementById("options-pane-layout").hidden = tab !== "layout";
        document.getElementById("options-pane-messages").hidden = tab !== "messages";
        document.getElementById("options-pane-alerts").hidden = tab !== "alerts";
        document.getElementById("options-pane-privacy").hidden = tab !== "privacy";
        document.getElementById("options-pane-security").hidden = tab !== "security";
        document.getElementById("options-pane-blank").hidden = knownTabs.includes(tab);
        if (tab === "layout") loadLayoutPrefsIntoForm();
        if (tab === "messages") loadMessagePrefsIntoForm();
        if (tab === "alerts") renderPermissions();
        if (tab === "privacy") renderBlockedList();
        if (tab === "security") loadSecurityIntoForm();
        if (optNav) optNav.hidden = true;
        if (optNavToggle) optNavToggle.setAttribute("aria-expanded", "false");
      });
    });
    // "Alterar Imagem..." dentro de Opções abre o seletor de avatar já
    // existente (fecha Opções primeiro pra não empilhar dois diálogos).
    const optChangeImage = document.getElementById("opt-change-image");
    if (optChangeImage) optChangeImage.addEventListener("click", () => {
      closeOptionsDialog();
      openAvatarPicker();
    });
    // "Mostrar minha última conversa..." só faz sentido com "Manter um
    // histórico" ligado — desliga/liga junto, igual ao cliente clássico.
    const optKeepHistory = document.getElementById("opt-keep-history");
    if (optKeepHistory) optKeepHistory.addEventListener("change", updateLastConversationCheckbox);
    // Bloquear pessoa pelo e-mail (aba Privacidade)
    const optBlockBtn = document.getElementById("opt-block-btn");
    if (optBlockBtn) optBlockBtn.addEventListener("click", blockPersonByEmail);
    const optBlockEmail = document.getElementById("opt-block-email");
    if (optBlockEmail) optBlockEmail.addEventListener("keydown", (e) => {
      if (e.key === "Enter") blockPersonByEmail();
    });
    // Trocar e-mail / senha / excluir conta (aba Segurança)
    const optChangeEmailBtn = document.getElementById("opt-change-email-btn");
    if (optChangeEmailBtn) optChangeEmailBtn.addEventListener("click", changeAccountEmail);
    const optChangePasswordBtn = document.getElementById("opt-change-password-btn");
    if (optChangePasswordBtn) optChangePasswordBtn.addEventListener("click", changeAccountPassword);
    const optDeleteConfirm = document.getElementById("opt-delete-confirm");
    if (optDeleteConfirm) optDeleteConfirm.addEventListener("input", updateDeleteAccountButtonState);
    const optDeleteBtn = document.getElementById("opt-delete-account-btn");
    if (optDeleteBtn) optDeleteBtn.addEventListener("click", deleteAccountFlow);
    // OK (salva e fecha) / Aplicar (salva, mantém aberto) / Cancelar e X
    // (descartam)
    const optOk = document.getElementById("options-ok");
    if (optOk) optOk.addEventListener("click", async () => {
      await commitOptions();
      closeOptionsDialog();
    });
    const optApply = document.getElementById("options-apply");
    if (optApply) optApply.addEventListener("click", commitOptions);
    const optCancel = document.getElementById("options-cancel");
    if (optCancel) optCancel.addEventListener("click", closeOptionsDialog);
    const optX = document.getElementById("options-dialog-x");
    if (optX) optX.addEventListener("click", closeOptionsDialog);

    // Modo de exibição (dropdown: tamanho das figuras na lista)
    const viewBtn = document.getElementById("btn-view-mode");
    const viewMenu = document.getElementById("view-mode-menu");
    if (viewBtn && viewMenu) {
      const closeViewMenu = () => {
        viewMenu.hidden = true;
        viewBtn.setAttribute("aria-expanded", "false");
      };
      viewBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const open = viewMenu.hidden;
        closeOtherDropdowns(closeViewMenu);
        viewMenu.hidden = !open;
        viewBtn.setAttribute("aria-expanded", String(open));
      });
      viewMenu.addEventListener("click", (e) => e.stopPropagation());
      document.addEventListener("click", closeViewMenu);
      registerDropdown(closeViewMenu);
      // Atalho: escolher um modo aqui seta Favoritos e Outros contatos
      // de uma vez (mesmo estado das Opções > Layout — ver
      // syncViewModeMenu/applyLayoutVisuals).
      viewMenu.querySelectorAll('input[name="view-mode"]').forEach((radio) => {
        radio.addEventListener("change", () => {
          favSize = radio.value;
          otherSize = radio.value;
          saveLayoutPrefs();
          renderContacts(currentFilter);
          closeViewMenu();
        });
      });
    }

    // Convidar amigos (compartilha o link do site)
    const promoBtn = document.getElementById("dash-promo");
    if (promoBtn) promoBtn.addEventListener("click", shareInviteLink);

    // Colapsar grupos
    document.querySelectorAll(".contact-group__header").forEach((h) => {
      h.addEventListener("click", () => {
        const open = h.getAttribute("aria-expanded") === "true";
        h.setAttribute("aria-expanded", String(!open));
      });
    });

    // Favoritar/desfavoritar (estrela em cada contato)
    document.getElementById("contacts-container").addEventListener("click", (e) => {
      const favBtn = e.target.closest(".contact-item__fav");
      if (!favBtn) return;
      e.stopPropagation();
      const item = favBtn.closest(".contact-item[data-id]");
      if (item) toggleFavorite(item.dataset.id);
    });

    // Abrir conversa
    document.getElementById("contacts-container").addEventListener("click", (e) => {
      if (ctxMenuJustOpened) { ctxMenuJustOpened = false; return; }
      const item = e.target.closest(".contact-item");
      if (!item || e.target.closest(".contact-item__fav")) return;
      const contact = contacts.find((c) => String(c.id) === item.dataset.id);
      if (!contact) return;
      SoundManager.play("message");
      openChat(contact);
    });
    bindContactLongPress();

    // Janela de conversa: fechar, enviar, chamar atenção, emoticons,
    // plano de fundo pessoal
    const chatClose = document.getElementById("chat-close");
    if (chatClose) chatClose.addEventListener("click", () => {
      // Não troca de tela direto — volta um passo no histórico, que
      // dispara o popstate abaixo (mesmo caminho do botão físico
      // "voltar" do aparelho), mantendo os dois em sincronia.
      if (currentChatContact) history.back();
    });
    const chatOfflineBannerClose = document.getElementById("chat-offline-banner-close");
    if (chatOfflineBannerClose) chatOfflineBannerClose.addEventListener("click", () => {
      document.getElementById("chat-offline-banner").hidden = true;
    });
    // Botão/gesto "voltar" do aparelho: se a janela de conversa estava
    // aberta, volta pro Dashboard em vez de sair do app ou ir pra uma
    // página anterior fora dele (ver o pushState em openChat).
    window.addEventListener("popstate", () => {
      if (currentChatContact) closeChat();
    });

    // Coluna lateral das fotos: esconder/mostrar. A barrinha fica azul
    // num flash rápido ao clicar e volta pra branca sozinha (CSS
    // "transition" cuida do fade — só liga/desliga a classe aqui).
    const chatSidebar = document.getElementById("chat-sidebar");
    const chatSidebarToggle = document.getElementById("chat-sidebar-toggle");
    if (chatSidebar && chatSidebarToggle) {
      chatSidebarToggle.addEventListener("click", () => {
        const collapsed = chatSidebar.classList.toggle("is-collapsed");
        chatSidebarToggle.setAttribute("aria-expanded", String(!collapsed));
        chatSidebarToggle.setAttribute("aria-label", collapsed ? "Mostrar fotos" : "Esconder fotos");
        chatSidebarToggle.classList.add("is-pressed");
        requestAnimationFrame(() => {
          requestAnimationFrame(() => chatSidebarToggle.classList.remove("is-pressed"));
        });
      });
    }
    const chatSend = document.getElementById("chat-send-btn");
    if (chatSend) chatSend.addEventListener("click", sendChatMessage);
    const chatInput = document.getElementById("chat-input");
    if (chatInput) chatInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendChatMessage();
      }
    });
    const chatNudgeBtn = document.getElementById("chat-nudge-btn");
    if (chatNudgeBtn) chatNudgeBtn.addEventListener("click", sendChatNudge);
    const chatEmojiBtn = document.getElementById("chat-emoji-btn");
    if (chatEmojiBtn) chatEmojiBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleEmojiPicker();
    });
    document.addEventListener("click", (e) => {
      const picker = document.getElementById("chat-emoji-picker");
      if (picker && !picker.hidden && !e.target.closest(".chat-emoji-wrap")) picker.hidden = true;
      const bgPicker = document.getElementById("chat-bg-picker");
      if (bgPicker && !bgPicker.hidden && !e.target.closest(".chat-bg-wrap")) bgPicker.hidden = true;
    });
    const chatBgBtn = document.getElementById("chat-bg-btn");
    if (chatBgBtn) chatBgBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleChatBgPicker();
    });
    const chatBgShowAll = document.getElementById("chat-bg-show-all");
    if (chatBgShowAll) chatBgShowAll.addEventListener("click", (e) => {
      e.preventDefault();
      document.getElementById("chat-bg-picker").hidden = true;
      openScenePicker("chatBackground");
    });

    // Sair (rodapé — opcional; sign-out principal fica no menu do nick)
    const signoutBtn = document.getElementById("btn-signout");
    if (signoutBtn) signoutBtn.addEventListener("click", doSignOut);

    // Rótulo do dispositivo em "Sair deste local"
    const signoutItem = document.getElementById("menu-signout");
    if (signoutItem) {
      signoutItem.textContent = "Sair deste local (" + deviceLabel() + ")";
    }
  }

  function deviceLabel() {
    const ua = navigator.userAgent || "";
    if (/Android/i.test(ua)) return "Android";
    if (/iPhone|iPad|iPod/i.test(ua)) return "iOS";
    if (/Windows/i.test(ua)) return "Windows";
    if (/Mac/i.test(ua)) return "Mac";
    if (/Linux/i.test(ua)) return "Linux";
    return "este dispositivo";
  }

  /* ---------- Modal reutilizável ---------- */
  function openModal({ title, value, placeholder, inputType, onOk }) {
    const overlay = document.getElementById("modal-overlay");
    const input = document.getElementById("modal-input");
    const msg = document.getElementById("modal-message");
    const okBtn = document.getElementById("modal-ok");
    const cancelBtn = document.getElementById("modal-cancel");

    document.getElementById("modal-title").textContent = title;
    input.hidden = false;
    input.type = inputType || "text";
    input.value = value || "";
    input.placeholder = placeholder || "";
    cancelBtn.hidden = false;
    msg.hidden = true;
    overlay.hidden = false;
    setTimeout(() => input.focus(), 30);

    const close = () => {
      overlay.hidden = true;
      okBtn.onclick = null; cancelBtn.onclick = null; input.onkeydown = null;
    };
    const submit = async () => {
      const err = await onOk(input.value);
      if (err) { msg.textContent = err; msg.hidden = false; return; }
      close();
    };
    okBtn.onclick = submit;
    cancelBtn.onclick = close;
    input.onkeydown = (e) => { if (e.key === "Enter") submit(); if (e.key === "Escape") close(); };
  }

  /* ---------- Modal apenas informativo ---------- */
  function infoModal(title, text) {
    const overlay = document.getElementById("modal-overlay");
    const input = document.getElementById("modal-input");
    const msg = document.getElementById("modal-message");
    const okBtn = document.getElementById("modal-ok");
    const cancelBtn = document.getElementById("modal-cancel");

    document.getElementById("modal-title").textContent = title;
    input.hidden = true;
    cancelBtn.hidden = true;
    msg.textContent = text;
    msg.hidden = false;
    msg.classList.add("modal__message--info");
    overlay.hidden = false;

    const close = () => {
      overlay.hidden = true;
      okBtn.onclick = null;
      msg.classList.remove("modal__message--info");
      input.hidden = false;
      cancelBtn.hidden = false;
    };
    okBtn.onclick = close;
  }

  return { show, load };
})();
