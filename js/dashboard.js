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
  const AVATAR_BORDER = {
    online: "linear-gradient(#a6f06a, #3aa11a)",
    busy: "linear-gradient(#ff8a8a, #c62828)",
    away: "linear-gradient(#ffe08a, #e0a409)",
    invisible: "linear-gradient(#c7d2db, #9aa7b1)",
    offline: "linear-gradient(#c7d2db, #9aa7b1)",
  };

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

  /* ---------- Avatar (foto enviada ou genérico) ---------- */
  function avatarMarkup(url) {
    if (url) {
      return '<img class="avatar-img" src="' + esc(url) + '" alt="" />';
    }
    return (
      '<svg class="avatar-generic" viewBox="0 0 100 100" aria-hidden="true">' +
      '<rect width="100" height="100" fill="#e9eff4"/>' +
      '<circle cx="50" cy="38" r="19" fill="#a7b3bd"/>' +
      '<path d="M16 96c0-20 15-31 34-31s34 11 34 31z" fill="#a7b3bd"/>' +
      "</svg>"
    );
  }

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
      renderContacts();
    } catch (err) {
      console.error("Falha ao carregar o dashboard:", err);
    }
  }

  /* ---------- Perfil próprio ---------- */
  function renderProfile() {
    if (!profile) return;
    const status = profile.status || "online";
    document.getElementById("my-name-text").textContent = profile.display_name || "Sem nome";
    document.getElementById("my-status-label").textContent = STATUS_LABEL[status] || "Disponível";

    const dot = document.getElementById("my-status-dot");
    dot.className = "my-avatar__status status-dot status-dot--" + status;

    const avatar = document.querySelector(".my-avatar");
    if (avatar) {
      avatar.style.background = AVATAR_BORDER[status] || AVATAR_BORDER.online;
      // Atualiza a imagem (foto enviada ou avatar genérico), mantendo a bolinha de status.
      const old = avatar.querySelector(".avatar-generic, .avatar-img");
      if (old) old.remove();
      avatar.insertAdjacentHTML("afterbegin", avatarMarkup(profile.avatar_url));
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

  function fillList(id, list) {
    const ul = document.getElementById(id);
    ul.innerHTML = list.map(contactItem).join("");
  }

  function contactItem(c) {
    const isOnline = ["online", "busy", "away"].includes(c.status);
    const stateClass = isOnline ? "contact-item--" + c.status : "contact-item--offline";
    const sub = c.sub_nick
      ? '<div class="contact-item__sub">' + esc(c.sub_nick) + "</div>"
      : "";
    return (
      '<li class="contact-item ' + stateClass + '" data-id="' + esc(c.id) + '">' +
      '<div class="contact-item__avatar">' + avatarMarkup(c.avatar_url) + "</div>" +
      '<div class="contact-item__body">' +
      '<div class="contact-item__name">' + esc(c.display_name) + "</div>" +
      sub +
      "</div></li>"
    );
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

  /* ---------- Alterar imagem para exibição (upload) ---------- */
  function changePicture() {
    const input = document.getElementById("avatar-input");
    if (input) input.click();
  }

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
    if (profile) { profile.avatar_url = previewUrl; renderProfile(); }

    try {
      const url = await MSNSupabase.uploadAvatar(file);
      if (profile) { profile.avatar_url = url; renderProfile(); }
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
      renderContacts(e.target.value);
    });

    // Foto de exibição (upload)
    const avatarInput = document.getElementById("avatar-input");
    if (avatarInput) avatarInput.addEventListener("change", onAvatarSelected);

    // Clicar na foto de exibição abre direto o upload de uma nova foto
    const avatarBtn = document.getElementById("my-avatar-btn");
    if (avatarBtn) avatarBtn.addEventListener("click", changePicture);

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

    // Ícones auxiliares (placeholders informativos)
    const mailBtn = document.getElementById("btn-mail");
    if (mailBtn) mailBtn.addEventListener("click", () =>
      infoModal("Novidades", "A caixa de novidades e mensagens será ativada em breve."));

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
