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
  const NO_AVATAR_TILE = "assets/avatars/semfoto.webp";
  const AVATAR_GALLERY = Array.from({ length: 30 }, (_, i) => "assets/avatars/profile" + (i + 1) + ".webp");

  // Cenários (fundo do topo) e cores de tema: catálogo compartilhado
  // em js/scenes.js (usado também pela tela de login).
  const SCENES = MSNScenes.list;
  const sceneBg = MSNScenes.bg;
  const pastel = MSNScenes.pastel;

  // Cenário "custom" (enviado pela pessoa via "Procurar...") não está
  // no catálogo fixo — usa a URL enviada em vez de procurar por id.
  function resolveSceneBg(sceneId, customUrl) {
    if (sceneId === "custom" && customUrl) {
      return "url('" + customUrl + "') center/cover no-repeat, " + SCENES[0].css;
    }
    return sceneBg(sceneId);
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
  let bound = false;
  let currentFilter = "";
  let contactsSubscribed = false;

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
      '<img src="assets/icons/avatar-frame.webp" class="status-frame__luma" alt="" />' +
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
      [profile, contacts] = await Promise.all([
        MSNSupabase.getMyProfile(),
        MSNSupabase.getContacts(),
      ]);
      // Aplica o status escolhido na tela de login, se houver
      const chosen = sessionStorage.getItem("msn:status");
      if (chosen && profile && profile.status !== chosen) {
        profile.status = chosen;
        MSNSupabase.updateMyProfile({ status: chosen }).catch(() => {});
      }
      renderProfile();
      renderContacts(currentFilter);
      subscribeContactUpdates();
    } catch (err) {
      console.error("Falha ao carregar o dashboard:", err);
    }
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
    if (header) header.style.setProperty("--scene", resolveSceneBg(profile.scene, profile.scene_image_url));
    updateHeaderTextContrast(profile.scene, profile.scene_image_url);

    const screen = document.getElementById("screen-dashboard");
    if (screen) {
      const theme = MSNScenes.effectiveTheme(profile.scene, profile.color_scheme);
      screen.style.setProperty("--tint-light", pastel(theme, 0.92));
      screen.style.setProperty("--tint-mid", pastel(theme, 0.8));
      screen.style.setProperty("--tint-strong", pastel(theme, 0.62));
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

  /* ---------- Lista de contatos ---------- */
  function renderContacts(filter = "") {
    const q = filter.trim().toLowerCase();
    const online = [];
    const offline = [];
    contacts.forEach((c) => {
      if (q && !(c.display_name || "").toLowerCase().includes(q)) return;
      if (["online", "busy", "away"].includes(c.status)) online.push(c);
      else offline.push(c);
    });

    fillList("list-online", online);
    fillList("list-offline", offline);
    document.getElementById("count-online").textContent = "(" + online.length + ")";
    document.getElementById("count-offline").textContent = "(" + offline.length + ")";

    const empty = document.getElementById("contacts-empty");
    empty.hidden = contacts.length !== 0;
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
      "</div>";
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
    if (nameEl) nameEl.textContent = c.display_name;

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
        infoModal("Opções", "A tela de opções será construída em breve.");
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
    grid.innerHTML =
      AVATAR_GALLERY.map((url) =>
        '<button type="button" class="avatar-swatch' + (url === stagedAvatarUrl ? " is-selected" : "") +
        '" data-avatar="' + esc(url) + '" style="background-image:url(\'' + url + "')\"></button>"
      ).join("") +
      '<button type="button" class="avatar-swatch' + (!stagedAvatarUrl ? " is-selected" : "") +
      '" data-avatar="" style="background-image:url(\'' + NO_AVATAR_TILE + "')\"></button>";

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

  // Aplica a foto só visualmente (na moldura do cabeçalho), sem salvar.
  function previewAvatar(url) {
    const photoWrap = document.querySelector(".my-avatar .status-frame__photo");
    if (!photoWrap) return;
    photoWrap.innerHTML = avatarMarkup(url);
    photoWrap.dataset.avatarUrl = url || "";
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

  function openScenePicker() {
    const overlay = document.getElementById("scene-picker");
    const grid = document.getElementById("scene-grid");
    const colorGrid = document.getElementById("color-scheme-grid");
    stagedScene = (profile && profile.scene) || SCENES[0].id;
    stagedColorScheme = (profile && profile.color_scheme) || null;
    stagedCustomImageUrl = (profile && profile.scene_image_url) || null;

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
    updateSceneExampleIcon();
    overlay.hidden = false;
  }

  // Ícone da tabela "Selecione um cenário": mostra uma miniatura de
  // exemplo (assets/scenes/<id>x.webp) do cenário atualmente
  // selecionado/prévia, em vez de um ícone fixo genérico.
  function updateSceneExampleIcon() {
    const icon = document.getElementById("scene-example-icon");
    if (!icon) return;
    if (stagedScene === "custom" && stagedCustomImageUrl) {
      icon.src = stagedCustomImageUrl;
    } else {
      icon.src = MSNScenes.example(stagedScene) || "assets/scenes/cenarioexemplo.webp";
    }
  }

  function customTileHtml(url, selected) {
    return (
      '<button type="button" class="scene-swatch' + (selected ? " is-selected" : "") +
      '" data-scene="custom" style="background:url(\'' + url + "') center/cover no-repeat\"" +
      ' aria-label="Personalizado" title="Personalizado"></button>'
    );
  }

  function bindSceneTileClicks(grid) {
    grid.querySelectorAll(".scene-swatch").forEach((sw) => {
      sw.addEventListener("click", () => {
        stagedScene = sw.dataset.scene;
        grid.querySelectorAll(".scene-swatch").forEach((x) => x.classList.remove("is-selected"));
        sw.classList.add("is-selected");
        previewScene(stagedScene);
        updateSceneExampleIcon();
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
        previewColorScheme(stagedColorScheme);
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
    previewScene("custom");
    updateSceneExampleIcon();

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

    try {
      const url = await MSNSupabase.uploadSceneImage(file);
      stagedCustomImageUrl = url;
      previewScene("custom");
      updateSceneExampleIcon();
      const tile = grid.querySelector('.scene-swatch[data-scene="custom"]');
      if (tile) tile.style.background = "url('" + url + "') center/cover no-repeat";
    } catch (err) {
      infoModal("Cenário", err.message || "Não foi possível enviar a imagem.");
    }
  }

  // Aplica o cenário só visualmente no cabeçalho, sem salvar.
  function previewScene(id) {
    const header = document.querySelector(".dash-header");
    if (header) header.style.setProperty("--scene", resolveSceneBg(id, stagedCustomImageUrl));
    updateHeaderTextContrast(id, stagedCustomImageUrl);
  }

  // Aplica o esquema de cores só visualmente (Novidades/atalhos), sem salvar.
  function previewColorScheme(colorSchemeId) {
    const screen = document.getElementById("screen-dashboard");
    if (screen) {
      const theme = MSNScenes.effectiveTheme(stagedScene, colorSchemeId);
      screen.style.setProperty("--tint-light", pastel(theme, 0.92));
      screen.style.setProperty("--tint-mid", pastel(theme, 0.8));
      screen.style.setProperty("--tint-strong", pastel(theme, 0.62));
    }
    updateCurrentColorSwatch();
  }

  function updateCurrentColorSwatch() {
    const sw = document.getElementById("color-scheme-current");
    if (!sw) return;
    sw.style.background = MSNScenes.effectiveTheme(stagedScene, stagedColorScheme);
  }

  // Salva de verdade o cenário e o esquema de cores escolhidos.
  async function commitScene() {
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

  // Fecha o diálogo; se a prévia não foi aplicada, volta ao que estava salvo.
  function closeScenePicker() {
    if (profile) {
      stagedCustomImageUrl = profile.scene_image_url || null;
      previewScene(profile.scene);
      previewColorScheme(profile.color_scheme);
    }
    document.getElementById("scene-picker").hidden = true;
  }

  function openAddContactModal() {
    openModal({
      title: "Adicionar um contato",
      value: "",
      placeholder: "Endereço de e-mail",
      inputType: "email",
      onOk: async (val) => {
        if (!val.trim()) return "Digite o e-mail do contato.";
        try {
          await MSNSupabase.addContactByEmail(val.trim());
          await load();
        } catch (err) {
          return err.message || "Não foi possível adicionar.";
        }
      },
    });
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
    try { await MSNSupabase.signOut(); } catch (_) {}
    // Ao sair, desliga o auto-login (mas mantém e-mail/senha lembrados).
    try { localStorage.setItem("msn:autoSignin", "false"); } catch (_) {}
    SoundManager.play("logout");
    UIManager.showScreen("screen-login");
  }

  /* ---------- Eventos ---------- */
  function bindEvents() {
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
      if (open) markSelectedStatus();
      menu.hidden = !open;
      stToggle.setAttribute("aria-expanded", String(open));
      if (nameRow) nameRow.classList.toggle("is-open", open);
    };
    nameBtn.addEventListener("click", openMenu);
    stToggle.addEventListener("click", openMenu);
    document.addEventListener("click", closeMenu);
    menu.addEventListener("click", (e) => e.stopPropagation());

    // Itens de status
    menu.querySelectorAll(".my-menu__status").forEach((item) => {
      item.addEventListener("click", async () => {
        closeMenu();
        if (!profile) return;
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
      addMenu.hidden = !open;
      addBtn.setAttribute("aria-expanded", String(open));
    });
    addMenu.addEventListener("click", (e) => e.stopPropagation());
    document.addEventListener("click", closeAddMenu);
    addMenu.querySelectorAll("[data-action]").forEach((item) => {
      item.addEventListener("click", () => {
        closeAddMenu();
        if (item.dataset.action === "add-contact") openAddContactModal();
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
        previewColorScheme(stagedColorScheme);
      });
    }

    // Criar um grupo: OK (cria) / Cancelar e X (descartam)
    const groupOk = document.getElementById("group-ok");
    if (groupOk) groupOk.addEventListener("click", submitGroup);
    const groupCancel = document.getElementById("group-cancel");
    if (groupCancel) groupCancel.addEventListener("click", closeGroupPicker);
    const groupX = document.getElementById("group-dialog-x");
    if (groupX) groupX.addEventListener("click", closeGroupPicker);

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
        viewMenu.hidden = !open;
        viewBtn.setAttribute("aria-expanded", String(open));
      });
      viewMenu.addEventListener("click", (e) => e.stopPropagation());
      document.addEventListener("click", closeViewMenu);
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

    // Abrir conversa (placeholder por enquanto)
    document.getElementById("contacts-container").addEventListener("click", (e) => {
      const item = e.target.closest(".contact-item");
      if (!item) return;
      SoundManager.play("message");
      // A janela de conversa será a próxima etapa.
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
