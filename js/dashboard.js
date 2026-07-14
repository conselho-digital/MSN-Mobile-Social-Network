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

  let profile = null;
  let contacts = [];
  let bound = false;

  /* ---------- Avatar genérico (sem colisão de ids) ---------- */
  function avatarMarkup() {
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
    if (avatar) avatar.style.background = AVATAR_BORDER[status] || AVATAR_BORDER.online;

    const subEl = document.getElementById("my-subnick-text");
    if (profile.sub_nick) {
      subEl.textContent = profile.sub_nick;
      subEl.classList.remove("my-subnick__placeholder");
    } else {
      subEl.textContent = "<Digite uma mensagem pessoal>";
      subEl.classList.add("my-subnick__placeholder");
    }
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
      '<div class="contact-item__avatar">' + avatarMarkup() + "</div>" +
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
        infoModal(
          "Alterar imagem para exibição",
          "O envio da foto de exibição será adicionado em breve (usando o Supabase Storage)."
        );
        break;
      case "change-scene":
        infoModal(
          "Alterar cenário",
          "A escolha de cenários (fundos do topo) será ativada quando os temas selecionáveis forem adicionados."
        );
        break;
      case "options":
        infoModal("Opções", "A tela de opções será construída em breve.");
        break;
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

  async function doSignOut() {
    try { await MSNSupabase.signOut(); } catch (_) {}
    try { localStorage.removeItem("msn:email"); } catch (_) {}
    SoundManager.play("logout");
    UIManager.showScreen("screen-login");
  }

  /* ---------- Eventos ---------- */
  function bindEvents() {
    // Menu do nick (status + ações do perfil)
    const menu = document.getElementById("my-menu");
    const nameBtn = document.getElementById("my-name-btn");
    const stToggle = document.getElementById("my-status-toggle");
    const closeMenu = () => { menu.hidden = true; stToggle.setAttribute("aria-expanded", "false"); };
    const openMenu = (e) => {
      e.stopPropagation();
      const open = menu.hidden;
      if (open) markSelectedStatus();
      menu.hidden = !open;
      stToggle.setAttribute("aria-expanded", String(open));
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

    // Editar mensagem pessoal (subnick)
    document.getElementById("my-subnick-btn").addEventListener("click", () => {
      openModal({
        title: "Mensagem pessoal",
        value: profile ? profile.sub_nick : "",
        placeholder: "Digite uma mensagem pessoal",
        allowEmpty: true,
        onOk: async (val) => {
          profile.sub_nick = val.trim();
          renderProfile();
          try { await MSNSupabase.updateMyProfile({ sub_nick: val.trim() }); } catch (_) {}
        },
      });
    });

    // Adicionar contato
    document.getElementById("btn-add-contact").addEventListener("click", () => {
      openModal({
        title: "Adicionar contato",
        value: "",
        placeholder: "Nome de exibição do contato",
        onOk: async (val) => {
          if (!val.trim()) return "Digite o nome do contato.";
          try {
            await MSNSupabase.addContactByName(val.trim());
            await load();
          } catch (err) {
            return err.message || "Não foi possível adicionar.";
          }
        },
      });
    });

    // Busca
    document.getElementById("contact-search").addEventListener("input", (e) => {
      renderContacts(e.target.value);
    });

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

    // Sair (rodapé)
    document.getElementById("btn-signout").addEventListener("click", doSignOut);

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
  function openModal({ title, value, placeholder, onOk }) {
    const overlay = document.getElementById("modal-overlay");
    const input = document.getElementById("modal-input");
    const msg = document.getElementById("modal-message");
    const okBtn = document.getElementById("modal-ok");
    const cancelBtn = document.getElementById("modal-cancel");

    document.getElementById("modal-title").textContent = title;
    input.hidden = false;
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
