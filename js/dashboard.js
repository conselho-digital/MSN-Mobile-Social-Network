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
  let brightnessToken = 0;
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
  function updateHeaderTextContrast(sceneId, customUrl) {
    const header = document.querySelector(".dash-header");
    if (!header) return;
    const url = sceneId === "custom" && customUrl ? customUrl : MSNScenes.image(sceneId);
    const token = ++brightnessToken;
    if (!url) {
      header.classList.remove("is-light-scene");
      return;
    }
    sampleBrightness(url, (avg) => {
      if (token !== brightnessToken || avg === null) return;
      header.classList.toggle("is-light-scene", avg > 150);
    });
  }

  let profile = null;
  let contacts = [];
  let groups = [];
  let bound = false;
  let currentFilter = "";
  let contactsSubscribed = false;

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

  function esc(s) {
    return String(s || "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  /* ---------- Abre o dashboard ---------- */
  async function show() {
    UIManager.showScreen("screen-dashboard");
    if (!bound) { bindEvents(); bound = true; }
    await load();
  }

  async function load() {
    try {
      [profile, contacts, groups] = await Promise.all([
        MSNSupabase.getMyProfile(),
        MSNSupabase.getContacts(),
        MSNSupabase.getGroups(),
      ]);
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
      Object.assign(c, updated);
      renderContacts(currentFilter);
    });
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
    }
    updateHeaderTextContrast(profile.scene, profile.scene_image_url);

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

  /* ---------- Modo de exibição (tamanho das figuras na lista) ----------
     Preferência local (não é salva no perfil/Supabase), lembrada por
     dispositivo via localStorage. "md" é o padrão (mesmo visual de
     sempre — não precisa de classe extra). */
  const VIEW_MODES = ["lg", "md", "sm", "list"];
  function setViewMode(mode) {
    if (VIEW_MODES.indexOf(mode) === -1) mode = "md";
    const list = document.getElementById("contacts-container");
    if (list) {
      VIEW_MODES.forEach((m) => list.classList.remove("contacts--" + m));
      if (mode !== "md") list.classList.add("contacts--" + mode);
    }
    try { localStorage.setItem("msn:viewMode", mode); } catch (_) {}
  }
  function loadViewMode() {
    let mode = "md";
    try { mode = localStorage.getItem("msn:viewMode") || "md"; } catch (_) {}
    setViewMode(mode);
    const radio = document.querySelector('input[name="view-mode"][value="' + mode + '"]');
    if (radio) radio.checked = true;
  }

  /* ---------- Preferências de Layout (Opções > Layout) ----------
     Tudo aqui é preferência local (localStorage), como Modo de
     exibição — não depende de coluna nova no Supabase. */
  let showFavoritesGroup = true;
  let showGroupsSection = true;
  let favSize = "normal";
  let otherSize = "normal";
  let labelBy = "name";
  let showStatusLabel = false;
  let sortBy = "status";

  function loadLayoutPrefs() {
    try {
      const get = (k, d) => { const v = localStorage.getItem(k); return v === null ? d : v; };
      showFavoritesGroup = get("msn:showFavorites", "true") === "true";
      showGroupsSection = get("msn:showGroups", "true") === "true";
      favSize = get("msn:favSize", "normal");
      otherSize = get("msn:otherSize", "normal");
      labelBy = get("msn:labelBy", "name");
      showStatusLabel = get("msn:showStatusLabel", "false") === "true";
      sortBy = get("msn:sortBy", "status");
    } catch (_) {}
  }
  function saveLayoutPrefs() {
    try {
      localStorage.setItem("msn:showFavorites", String(showFavoritesGroup));
      localStorage.setItem("msn:showGroups", String(showGroupsSection));
      localStorage.setItem("msn:favSize", favSize);
      localStorage.setItem("msn:otherSize", otherSize);
      localStorage.setItem("msn:labelBy", labelBy);
      localStorage.setItem("msn:showStatusLabel", String(showStatusLabel));
      localStorage.setItem("msn:sortBy", sortBy);
    } catch (_) {}
  }

  // Aplica visibilidade/tamanho — não depende de re-renderizar os
  // contatos (só liga/desliga classes nos containers já existentes).
  function applyLayoutVisuals() {
    const favGroup = document.getElementById("group-favorites");
    if (favGroup) {
      favGroup.hidden = !showFavoritesGroup;
      favGroup.classList.remove("size-small", "size-list");
      if (favSize === "small") favGroup.classList.add("size-small");
      else if (favSize === "list") favGroup.classList.add("size-list");
    }
    const groupsWrap = document.getElementById("contact-groups-dynamic");
    if (groupsWrap) groupsWrap.hidden = !showGroupsSection;

    const container = document.getElementById("contacts-container");
    if (container) {
      container.classList.remove("contacts-other-size-small", "contacts-other-size-list");
      if (otherSize === "small") container.classList.add("contacts-other-size-small");
      else if (otherSize === "list") container.classList.add("contacts-other-size-list");
    }
  }

  function loadLayoutPrefsIntoForm() {
    document.getElementById("opt-show-favorites").checked = showFavoritesGroup;
    document.getElementById("opt-show-groups").checked = showGroupsSection;
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
    labelBy = document.getElementById("opt-label-by").value;
    showStatusLabel = document.getElementById("opt-show-status-label").checked;
    sortBy = document.getElementById("opt-sort-by").value;
    const favRadio = document.querySelector('input[name="size-favorites"]:checked');
    favSize = favRadio ? favRadio.value : "normal";
    const otherRadio = document.querySelector('input[name="size-other"]:checked');
    otherSize = otherRadio ? otherRadio.value : "normal";
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
    } catch (err) {
      msg.textContent = err.message || "Não foi possível bloquear.";
      msg.hidden = false;
    }
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
    const matches = (c) => !q || (c.display_name || "").toLowerCase().includes(q);
    const isOnline = (c) => ["online", "busy", "away"].includes(c.status);

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
      fillList("list-group-" + g.id, members);
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

    fillList("list-favorites", favorites);
    fillList("list-online", online);
    fillList("list-offline", offline);
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

  // Atualiza os <li> existentes no lugar (em vez de recriar tudo com
  // innerHTML) sempre que possível — assim a cor da moldura consegue
  // animar quando o status de um contato muda, ao invés de só "trocar"
  // de uma vez (nó novo = sem transição pra animar a partir de onde
  // estava).
  function fillList(id, list) {
    const ul = document.getElementById(id);
    const existing = new Map();
    ul.querySelectorAll(".contact-item[data-id]").forEach((li) => existing.set(li.dataset.id, li));

    list.forEach((c) => {
      const key = String(c.id);
      let li = existing.get(key);
      if (li) {
        updateContactItem(li, c);
        existing.delete(key);
      } else {
        li = contactItem(c);
      }
      ul.appendChild(li); // garante a ordem da lista atual
    });

    // Sobrou no mapa = não está mais na lista (offline mudou de grupo,
    // contato removido, ou saiu do filtro de busca).
    existing.forEach((li) => li.remove());
  }

  function contactItem(c) {
    const li = document.createElement("li");
    li.dataset.id = c.id;
    li.innerHTML =
      '<div class="contact-item__avatar"></div>' +
      '<div class="contact-item__body">' +
      '<div class="contact-item__name"></div>' +
      "</div>" +
      '<button type="button" class="contact-item__fav"></button>';
    updateContactItem(li, c);
    return li;
  }

  function updateContactItem(li, c) {
    const isOnline = ["online", "busy", "away"].includes(c.status);
    li.className = "contact-item " + (isOnline ? "contact-item--" + c.status : "contact-item--offline");

    const avatarBox = li.querySelector(".contact-item__avatar");
    if (avatarBox) {
      const ring = avatarBox.querySelector(".status-frame__ring");
      if (!ring) {
        avatarBox.innerHTML = statusFrameMarkup(c.avatar_url, c.status);
      } else {
        updateStatusFrame(ring, c.status);
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
      if (showStatusLabel) label += " (" + (STATUS_LABEL[c.status] || "") + ")";
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
        editName();
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

  // Envio de uma foto própria ("Procurar..." dentro do diálogo).
  async function onAvatarSelected(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = ""; // permite reenviar o mesmo arquivo
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      return infoModal("Foto de exibição", "Selecione um arquivo de imagem.");
    }
    if (file.size > 3 * 1024 * 1024) {
      return infoModal("Foto de exibição", "A imagem deve ter no máximo 3 MB.");
    }

    // Prévia imediata
    const previewUrl = URL.createObjectURL(file);
    stagedAvatarUrl = previewUrl;
    document.querySelectorAll("#avatar-grid .avatar-swatch").forEach((x) => x.classList.remove("is-selected"));
    previewAvatar(previewUrl);

    try {
      const url = await MSNSupabase.uploadAvatar(file);
      stagedAvatarUrl = url;
      previewAvatar(url);
    } catch (err) {
      infoModal("Foto de exibição", err.message || "Não foi possível enviar a imagem.");
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

  function openScenePicker(mode) {
    scenePickerMode = mode || "profile";
    const overlay = document.getElementById("scene-picker");
    const grid = document.getElementById("scene-grid");
    const colorGrid = document.getElementById("color-scheme-grid");
    const titleText = document.getElementById("scene-dialog-title-text");
    if (scenePickerMode === "chatBackground") {
      const bg = getPersonalChatBackground();
      stagedScene = (bg && bg.scene) || SCENES[0].id;
      stagedColorScheme = (bg && bg.colorScheme) || null;
      stagedCustomImageUrl = null;
      if (titleText) titleText.textContent = "Plano de Fundo";
    } else {
      stagedScene = (profile && profile.scene) || SCENES[0].id;
      stagedColorScheme = (profile && profile.color_scheme) || null;
      stagedCustomImageUrl = (profile && profile.scene_image_url) || null;
      if (titleText) titleText.textContent = "Cenário";
    }

    grid.innerHTML = SCENES.map((s) =>
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
    overlay.hidden = false;
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

  // Envio de um cenário próprio ("Procurar...").
  async function onSceneImageSelected(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      return infoModal("Cenário", "Selecione um arquivo de imagem.");
    }
    if (file.size > 4 * 1024 * 1024) {
      return infoModal("Cenário", "A imagem deve ter no máximo 4 MB.");
    }

    const previewUrl = URL.createObjectURL(file);
    stagedScene = "custom";
    stagedCustomImageUrl = previewUrl;

    const grid = document.getElementById("scene-grid");
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
      const url = await MSNSupabase.uploadSceneImage(file);
      stagedCustomImageUrl = url;
      const tile = grid.querySelector('.scene-swatch[data-scene="custom"]');
      if (tile) tile.style.background = "url('" + url + "') center/cover no-repeat";
    } catch (err) {
      infoModal("Cenário", err.message || "Não foi possível enviar a imagem.");
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
      setPersonalChatBackground(stagedScene, stagedColorScheme);
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

  // Fecha o diálogo sem aplicar nem salvar nada (clicar num cenário/
  // cor só fica staged em memória, nunca chega a mudar o Dashboard).
  function closeScenePicker() {
    document.getElementById("scene-picker").hidden = true;
  }

  /* ============================================================
     JANELA DE CONVERSA
     ------------------------------------------------------------
     O fundo da área de mensagens usa o cenário/tema do CONTATO por
     padrão (com fallback pro cenário padrão se ele não tiver nenhum) —
     simétrico: quando essa pessoa fala comigo, ela vê o MEU cenário.
     Mas se eu tiver escolhido um "plano de fundo" pessoal (só meu,
     nunca sincronizado, ninguém mais vê), ele prevalece em QUALQUER
     conversa que eu abrir, independente de quem for o contato.
     ============================================================ */
  function getPersonalChatBackground() {
    try {
      const raw = localStorage.getItem("msn:chatBackground");
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }
  function setPersonalChatBackground(scene, colorScheme) {
    try {
      localStorage.setItem("msn:chatBackground", JSON.stringify({ scene, colorScheme: colorScheme || null }));
    } catch (_) {}
  }

  let currentChatContact = null;
  let chatMessagesSubscribed = false;
  let chatNudgeSubscribed = false;

  // Resolve e aplica o fundo da conversa atualmente aberta.
  function applyChatBackground() {
    const thread = document.getElementById("chat-thread");
    if (!thread || !currentChatContact) return;
    const myBg = getPersonalChatBackground();
    const sceneId = myBg ? myBg.scene : (currentChatContact.scene || SCENES[0].id);
    const colorScheme = myBg ? myBg.colorScheme : currentChatContact.color_scheme;
    const customUrl = myBg ? null : currentChatContact.scene_image_url;
    const tintHex = MSNScenes.colorSchemeHex(colorScheme);
    // MSNScenes.bg()/resolveSceneBg() devolvem um valor pra propriedade
    // "background" (shorthand, com position/size/repeat embutidos) —
    // não pra "background-image" sozinha (ver .dash-header, que usa a
    // mesma técnica).
    thread.style.background = resolveSceneBg(sceneId, customUrl, tintHex);
  }

  function chatStatusFrameMarkup(avatarUrl, status) {
    return statusFrameMarkup(avatarUrl, status);
  }

  function renderChatHeader() {
    const c = currentChatContact;
    if (!c) return;
    document.getElementById("chat-titlebar-text").textContent = c.email || c.display_name || "";
    document.getElementById("chat-contact-name").textContent = c.display_name || c.email || "";
    document.getElementById("chat-contact-status").textContent = "(" + (STATUS_LABEL[c.status] || "Offline") + ")";
    document.getElementById("chat-contact-avatar").innerHTML = chatStatusFrameMarkup(c.avatar_url, c.status || "offline");

    const myAvatar = document.getElementById("chat-my-avatar");
    myAvatar.innerHTML = chatStatusFrameMarkup(profile && profile.avatar_url, (profile && profile.status) || "online");

    const isOffline = !["online", "busy", "away"].includes(c.status);
    const banner = document.getElementById("chat-offline-banner");
    banner.hidden = !isOffline;
    if (isOffline) {
      const textEl = document.getElementById("chat-offline-banner-text");
      textEl.innerHTML = "";
      textEl.appendChild(document.createTextNode(
        (c.email || c.display_name) + " parece estar offline. As mensagens serão entregues quando esse contato entrar. "
      ));
      const mailLink = document.createElement("a");
      mailLink.href = "mailto:" + (c.email || "");
      mailLink.textContent = "Enviar um e-mail para este contato";
      textEl.appendChild(mailLink);
    }
  }

  function chatMessageBubble(msg) {
    const li = document.createElement("li");
    const mine = String(msg.sender_id) === String(profile && profile.id);
    li.className = "chat-message " + (mine ? "chat-message--mine" : "chat-message--theirs");
    const text = document.createElement("span");
    text.textContent = msg.content;
    li.appendChild(text);
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
    const thread = document.getElementById("chat-thread");
    if (thread) thread.scrollTop = thread.scrollHeight;
  }

  function subscribeChatRealtime() {
    if (chatMessagesSubscribed) return;
    MSNSupabase.subscribeMessages((msg) => {
      if (!currentChatContact) return;
      const cid = String(currentChatContact.id);
      const involved =
        (String(msg.sender_id) === cid && String(msg.receiver_id) === String(profile && profile.id)) ||
        (String(msg.receiver_id) === cid && String(msg.sender_id) === String(profile && profile.id));
      if (!involved) return;
      document.getElementById("chat-messages").appendChild(chatMessageBubble(msg));
      scrollChatToBottom();
      if (String(msg.sender_id) !== String(profile && profile.id)) SoundManager.play("message");
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
      SoundManager.play("nudge");
    });
    chatNudgeSubscribed = true;
  }

  function triggerNudgeShake() {
    const win = document.getElementById("screen-chat");
    if (!win) return;
    win.classList.remove("nudge-shake");
    void win.offsetWidth;
    win.classList.add("nudge-shake");
  }

  async function sendChatMessage() {
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
    if (!currentChatContact) return;
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

  function openChat(contact) {
    currentChatContact = contact;
    UIManager.showScreen("screen-chat");
    renderChatHeader();
    applyChatBackground();
    document.getElementById("chat-emoji-picker").hidden = true;
    document.getElementById("chat-input").value = "";
    loadChatMessages();
    subscribeChatRealtime();
    subscribeChatNudges();
    setTimeout(() => document.getElementById("chat-input").focus(), 30);
  }

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

  function editName() {
    openModal({
      title: "Alterar nome para exibição",
      value: profile ? profile.display_name : "",
      placeholder: "Seu nome no chat",
      onOk: async (val) => {
        if (!val.trim()) return "Digite um nome.";
        profile.display_name = val.trim();
        renderProfile();
        try { await MSNSupabase.updateMyProfile({ display_name: val.trim() }); } catch (_) {}
      },
    });
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
        const knownTabs = ["personal", "layout", "messages", "alerts", "privacy"];
        document.getElementById("options-pane-personal").hidden = tab !== "personal";
        document.getElementById("options-pane-layout").hidden = tab !== "layout";
        document.getElementById("options-pane-messages").hidden = tab !== "messages";
        document.getElementById("options-pane-alerts").hidden = tab !== "alerts";
        document.getElementById("options-pane-privacy").hidden = tab !== "privacy";
        document.getElementById("options-pane-blank").hidden = knownTabs.includes(tab);
        if (tab === "layout") loadLayoutPrefsIntoForm();
        if (tab === "messages") loadMessagePrefsIntoForm();
        if (tab === "alerts") renderPermissions();
        if (tab === "privacy") renderBlockedList();
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
      viewMenu.querySelectorAll('input[name="view-mode"]').forEach((radio) => {
        radio.addEventListener("change", () => {
          setViewMode(radio.value);
          closeViewMenu();
        });
      });
      loadViewMode();
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
      const item = e.target.closest(".contact-item");
      if (!item || e.target.closest(".contact-item__fav")) return;
      const contact = contacts.find((c) => String(c.id) === item.dataset.id);
      if (!contact) return;
      SoundManager.play("message");
      openChat(contact);
    });

    // Janela de conversa: fechar, enviar, chamar atenção, emoticons,
    // plano de fundo pessoal
    const chatClose = document.getElementById("chat-close");
    if (chatClose) chatClose.addEventListener("click", closeChat);
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
    });
    const chatBgBtn = document.getElementById("chat-bg-btn");
    if (chatBgBtn) chatBgBtn.addEventListener("click", () => openScenePicker("chatBackground"));

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
