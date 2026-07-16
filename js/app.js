/* ============================================================
   app.js
   Inicialização global e orquestração da tela de entrada.
   ============================================================ */

const App = (function () {
  "use strict";

  let connecting = false;
  let cancelRequested = false;

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    MSNSupabase.init();
    UIManager.init();
    SoundManager.preload();

    bindAccountDropdown();
    bindWelcomeHeading();
    restoreRemembered();
    bindRememberOptions();
    bindLoginForm();
    bindSignupForm();
    bindCancel();
    bindExtraLinks();
    bindNavigation();
    bindPasswordToggles();
    bindInstallApp();
    bindAutofillGuards();
    initSession();
  }

  /* ---------- Reduzir o autopreenchimento nativo do navegador ----------
     Os campos de e-mail/senha do login começam "readonly" (só leitura) e
     só viram editáveis quando a pessoa realmente toca neles. Isso evita
     que o Chrome/Safari preencha os campos sozinho assim que a página
     carrega — o preenchimento automático só acontece pela NOSSA lógica
     (contas lembradas), nunca pelo gerenciador de senhas do navegador.
     Importante: nenhum navegador permite desligar 100% o "Salvar senha?"
     nativo — isso é proposital, por segurança do usuário. Esta técnica
     reduz drasticamente o autopreenchimento, mas não elimina esse popup
     em todos os casos. */
  function bindAutofillGuards() {
    [document.getElementById("login-email"), document.getElementById("login-password")]
      .filter(Boolean)
      .forEach((input) => {
        const unlock = () => input.removeAttribute("readonly");
        input.addEventListener("focus", unlock);
        input.addEventListener("pointerdown", unlock);
        input.addEventListener("touchstart", unlock, { passive: true });
      });
  }

  /* ---------- Sessão (Entrar automaticamente) ----------
     Se "Entrar automaticamente" estava ligado, reabrir o app vai direto
     ao Dashboard. Caso contrário, qualquer sessão salva é encerrada e o
     usuário volta para a tela de login. */
  async function initSession() {
    if (!MSNSupabase.isConfigured()) return;
    let session = null;
    try { session = await MSNSupabase.getSession(); } catch (_) {}
    if (!session) return;

    const auto = localStorage.getItem("msn:autoSignin") === "true";
    if (auto) {
      Dashboard.show();
    } else {
      try { await MSNSupabase.signOut(); } catch (_) {}
    }
  }

  /* ---------- Ligação entre os checkboxes de "lembrar" ----------
     - Marcar "Lembrar-me" marca também "Lembrar minha senha".
     - Desmarcar "Lembrar-me" desmarca "Lembrar senha" e "Entrar auto.".
     - Marcar "Lembrar senha" exige "Lembrar-me".
     (Para lembrar só o e-mail: ligar "Lembrar-me" e desligar "Lembrar senha".) */
  function bindRememberOptions() {
    const me = document.getElementById("opt-remember-me");
    const pass = document.getElementById("opt-remember-pass");
    const auto = document.getElementById("opt-auto-signin");
    if (!me || !pass) return;

    me.addEventListener("change", () => {
      if (me.checked) {
        pass.checked = true;
      } else {
        pass.checked = false;
        if (auto) auto.checked = false;
      }
    });

    pass.addEventListener("change", () => {
      if (pass.checked) me.checked = true;
      else if (auto) auto.checked = false;
    });

    if (auto) {
      auto.addEventListener("change", () => {
        if (auto.checked) { me.checked = true; pass.checked = true; }
      });
    }
  }

  /* ---------- "Adicionar App" (instalar PWA) ----------
     O botão aparece em todas as telas de entrada (login, cadastro,
     entrando) sempre que o site está sendo aberto no navegador — mesmo
     que o app já esteja instalado no aparelho, já que reabrir a URL
     numa aba comum ainda é útil para quem quer instalar/reinstalar.
     Ele só some quando o próprio app instalado está rodando (modo
     standalone), pois aí instalar de novo não faz sentido. */
  let deferredInstallPrompt = null;

  function installButtons() {
    return Array.from(document.querySelectorAll("[data-install-app]"));
  }

  function setInstallButtonsHidden(hidden) {
    installButtons().forEach((btn) => { btn.hidden = hidden; });
  }

  function bindInstallApp() {
    const btns = installButtons();
    if (!btns.length) return;

    // Guarda o evento que o Chrome/Android dispara quando o PWA é instalável.
    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      deferredInstallPrompt = e;
    });

    // Só esconde quando rodando como o app instalado (standalone).
    // No navegador comum, o botão permanece visível mesmo que o app
    // já esteja instalado no aparelho.
    setInstallButtonsHidden(isRunningStandalone());
    window.addEventListener("appinstalled", () => {
      deferredInstallPrompt = null;
    });

    btns.forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (deferredInstallPrompt) {
          deferredInstallPrompt.prompt();
          try { await deferredInstallPrompt.userChoice; } catch (_) {}
          deferredInstallPrompt = null;
        } else {
          showInstallInstructions();
        }
      });
    });
  }

  function isRunningStandalone() {
    return (
      window.matchMedia("(display-mode: standalone)").matches ||
      window.navigator.standalone === true
    );
  }

  // Fallback para navegadores sem beforeinstallprompt (ex.: iOS/Safari).
  // Usa um modal global (funciona em qualquer tela: login, cadastro ou
  // entrando), já que nem toda tela tem uma área de mensagem própria.
  function showInstallInstructions() {
    const ua = navigator.userAgent || "";
    let msg;
    if (/iPhone|iPad|iPod/i.test(ua)) {
      msg = "Para instalar no iPhone/iPad: toque em Compartilhar (⬆️) e depois em “Adicionar à Tela de Início”.";
    } else if (isRunningStandalone()) {
      msg = "O app já está instalado neste dispositivo. 🎉";
    } else {
      msg = "Para instalar: abra o menu do navegador (⋮) e escolha “Instalar app” ou “Adicionar à tela inicial”.";
    }
    showGlobalInfo("Adicionar App", msg);
  }

  // Modal informativo simples, reaproveitando o overlay global (fora das
  // seções de tela), então funciona não importa qual tela está ativa.
  function showGlobalInfo(title, text) {
    const overlay = document.getElementById("modal-overlay");
    if (!overlay) { UIManager.showMessage(text, "info"); return; }

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

    okBtn.onclick = () => {
      overlay.hidden = true;
      msg.classList.remove("modal__message--info");
      input.hidden = false;
      cancelBtn.hidden = false;
      okBtn.onclick = null;
    };
  }

  /* ---------- Botões de mostrar/ocultar senha ---------- */
  function bindPasswordToggles() {
    document.querySelectorAll(".pw-toggle").forEach((btn) => {
      btn.addEventListener("click", () => {
        const field = btn.closest(".field");
        const input = field && field.querySelector("input");
        if (!input) return;
        const show = input.type === "password";
        input.type = show ? "text" : "password";
        btn.setAttribute("aria-pressed", String(show));
        btn.setAttribute("aria-label", show ? "Ocultar senha" : "Mostrar senha");
      });
    });
  }

  /* ---------- Navegação entre telas ---------- */
  function bindNavigation() {
    const toSignup = document.getElementById("link-signup");
    if (toSignup) {
      toSignup.addEventListener("click", (e) => {
        e.preventDefault();
        UIManager.clearMessage();
        UIManager.showScreen("screen-signup");
      });
    }
    const toLogin = document.getElementById("link-back-login");
    if (toLogin) {
      toLogin.addEventListener("click", (e) => {
        e.preventDefault();
        UIManager.showScreen("screen-login");
      });
    }
  }

  /* ---------- Formulário de login ---------- */
  function bindLoginForm() {
    const form = document.getElementById("login-form");
    if (!form) return;

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (connecting) return;

      const email = document.getElementById("login-email").value.trim();
      const password = document.getElementById("login-password").value;

      if (!email || !password) {
        UIManager.showMessage("Preencha seu e-mail e senha para entrar.");
        return;
      }

      // Se "Lembrar-me" não estiver marcado, a conta é esquecida assim que
      // a pessoa TENTA entrar com ela — mesmo que o login falhe depois.
      const meEl = document.getElementById("opt-remember-me");
      if (!meEl || !meEl.checked) {
        removeAccount(email);
        renderAccountMenu();
        updateWelcomeHeading();
      }

      UIManager.clearMessage();
      await startConnecting(email, password);
    });
  }

  /* ---------- Formulário de cadastro ---------- */
  function bindSignupForm() {
    const form = document.getElementById("signup-form");
    if (!form) return;

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (connecting) return;

      const name = document.getElementById("signup-name").value.trim();
      const email = document.getElementById("signup-email").value.trim();
      const password = document.getElementById("signup-password").value;
      const password2 = document.getElementById("signup-password2").value;
      const birthdate = document.getElementById("signup-birthdate").value || null;

      // Validações (nome, e-mail e senha são obrigatórios)
      if (!name) return showSignupMessage("Escolha um nome de exibição.");
      if (!email) return showSignupMessage("Informe seu e-mail.");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return showSignupMessage("Digite um e-mail válido.");
      }
      if (!password || password.length < 6) {
        return showSignupMessage("A senha deve ter pelo menos 6 caracteres.");
      }
      if (password !== password2) {
        return showSignupMessage("As senhas não coincidem.");
      }

      clearSignupMessage();
      const btn = document.getElementById("btn-signup");
      btn.disabled = true;
      btn.textContent = "Criando conta...";

      try {
        const result = await MSNSupabase.signUp(email, password, name, birthdate);
        const needsConfirm = result && result.user && !result.session && !result.demo;

        UIManager.showScreen("screen-login");
        UIManager.showMessage(
          needsConfirm
            ? "Conta criada! Confirme seu e-mail para poder entrar."
            : "Conta criada com sucesso! Agora é só entrar.",
          "info"
        );
        document.getElementById("login-email").value = email;
        form.reset();
      } catch (err) {
        showSignupMessage(friendlyError(err));
      } finally {
        btn.disabled = false;
        btn.textContent = "Criar conta";
      }
    });
  }

  function showSignupMessage(text, type = "error") {
    const el = document.getElementById("signup-message");
    if (!el) return;
    el.textContent = text;
    el.hidden = false;
    el.classList.toggle("login-message--info", type === "info");
  }
  function clearSignupMessage() {
    const el = document.getElementById("signup-message");
    if (el) el.hidden = true;
  }

  /* ---------- Fluxo "Entrando..." ---------- */
  async function startConnecting(email, password) {
    connecting = true;
    cancelRequested = false;

    const status = UIManager.getStatus();
    setConnectingText("Entrando...");
    UIManager.showScreen("screen-connecting");
    SoundManager.play("login");

    try {
      const result = await MSNSupabase.signIn(email, password);
      if (cancelRequested) return;

      // Busca o cenário, o esquema de cores e a foto de exibição salvos
      // no perfil para lembrar o tema e a foto desta conta na tela de
      // login (por conta, guardado no dispositivo).
      let scene = null;
      let colorScheme = null;
      let avatarUrl = null;
      try {
        const profile = await MSNSupabase.getMyProfile();
        scene = (profile && profile.scene) || null;
        colorScheme = (profile && profile.color_scheme) || null;
        avatarUrl = (profile && profile.avatar_url) || null;
      } catch (_) {}
      applyLoginAvatar(avatarUrl);

      // Conectou com sucesso: agora sim salvamos as preferências.
      savePreferences(email, password, scene, colorScheme, avatarUrl);

      // Guarda status escolhido para uso pós-login
      sessionStorage.setItem("msn:status", status.status);

      onSignedIn(result);
    } catch (err) {
      if (cancelRequested) return;
      UIManager.showScreen("screen-login");
      UIManager.showMessage(friendlyError(err));
    } finally {
      connecting = false;
    }
  }

  function onSignedIn() {
    // Conectado: abre o Dashboard (lista de contatos).
    setConnectingText("Conectado!");
    Dashboard.show();
  }

  /* ---------- Botão Cancelar ---------- */
  function bindCancel() {
    const btn = document.getElementById("btn-cancel");
    if (!btn) return;
    btn.addEventListener("click", () => {
      cancelRequested = true;
      connecting = false;
      UIManager.showScreen("screen-login");
    });
  }

  function setConnectingText(text) {
    const el = document.getElementById("connecting-text");
    if (el) el.textContent = text;
  }

  /* ---------- Contas salvas (dropdown do e-mail) ---------- */
  function getAccounts() {
    try { return JSON.parse(localStorage.getItem("msn:accounts") || "[]"); }
    catch (_) { return []; }
  }
  function setAccounts(list) {
    try { localStorage.setItem("msn:accounts", JSON.stringify(list)); } catch (_) {}
  }
  function upsertAccount(email, passObf, scene, colorScheme, avatarUrl) {
    const list = getAccounts().filter((a) => a.email !== email);
    list.unshift({
      email: email,
      pass: passObf || null,
      scene: scene || null,
      colorScheme: colorScheme || null,
      avatarUrl: avatarUrl || null,
    });
    setAccounts(list);
  }
  // Atualiza o cenário/tema/foto guardados de uma conta já lembrada —
  // chamada pelo Dashboard ao sair (ver Dashboard.doSignOut), pra
  // cobrir o caso de a pessoa trocar de cenário/foto durante a sessão
  // e só depois fazer logout: sem isso, a tela de login continuaria
  // mostrando a versão antiga (só salva no momento do login). Não
  // mexe em senha nem no estado de "lembrar-me"; se a conta não
  // estava lembrada, não faz nada (mesma regra do login).
  function updateRememberedTheme(email, scene, colorScheme, avatarUrl) {
    if (!email) return;
    const list = getAccounts();
    const idx = list.findIndex((a) => a.email === email);
    if (idx === -1) return;
    list[idx] = Object.assign({}, list[idx], {
      scene: scene || null,
      colorScheme: colorScheme || null,
      avatarUrl: avatarUrl || null,
    });
    setAccounts(list);

    // Se a tela de login já estiver com esse e-mail no campo (é o que
    // aparece logo depois do logout), reaplica na hora — sem isso a
    // moldura ficaria com o cenário/foto antigos até o campo de e-mail
    // disparar um novo re-render por conta própria.
    const emailEl = document.getElementById("login-email");
    if (emailEl && emailEl.value.trim().toLowerCase() === email.toLowerCase()) {
      currentLoginKey = undefined; // força reaplicar mesmo se o cenário não mudou
      applyLoginTheme(scene, colorScheme);
      applyLoginAvatar(avatarUrl);
    }
  }
  function removeAccount(email) {
    setAccounts(getAccounts().filter((a) => a.email !== email));
    if (localStorage.getItem("msn:lastEmail") === email) {
      try { localStorage.removeItem("msn:lastEmail"); } catch (_) {}
    }
  }

  /* ---------- Preferências de login (após conectar) ----------
     - "Lembrar-me" ligado: salva a conta na lista (com senha só se
       "Lembrar senha" ligado), junto com o cenário/tema do perfil —
       para reaplicar a cor na tela de login quando essa conta for
       selecionada no dropdown.
     - "Lembrar-me" desligado: remove a conta da lista.
     - Salva também o estado de "Entrar automaticamente". */
  function savePreferences(email, password, scene, colorScheme, avatarUrl) {
    const me = document.getElementById("opt-remember-me");
    const pass = document.getElementById("opt-remember-pass");
    const auto = document.getElementById("opt-auto-signin");
    try {
      if (me && me.checked) {
        upsertAccount(email, pass && pass.checked ? obfuscate(password) : null, scene, colorScheme, avatarUrl);
        localStorage.setItem("msn:lastEmail", email);
      } else {
        removeAccount(email);
      }
      localStorage.setItem("msn:autoSignin", auto && auto.checked ? "true" : "false");
    } catch (_) {}
    renderAccountMenu();
    updateWelcomeHeading();
  }

  function restoreRemembered() {
    try {
      const accounts = getAccounts();
      const lastEmail = localStorage.getItem("msn:lastEmail");
      const auto = localStorage.getItem("msn:autoSignin") === "true";
      const acc = accounts.find((a) => a.email === lastEmail) || accounts[0];
      if (acc) applyAccount(acc);
      const autoEl = document.getElementById("opt-auto-signin");
      if (autoEl) autoEl.checked = auto;
      renderAccountMenu();
      updateWelcomeHeading();
    } catch (_) {}
  }

  // Preenche o formulário com uma conta salva.
  function applyAccount(acc) {
    const emailEl = document.getElementById("login-email");
    const passEl = document.getElementById("login-password");
    const meEl = document.getElementById("opt-remember-me");
    const passOptEl = document.getElementById("opt-remember-pass");
    if (emailEl) emailEl.value = acc.email;
    if (meEl) meEl.checked = true;
    if (acc.pass) {
      if (passEl) passEl.value = deobfuscate(acc.pass);
      if (passOptEl) passOptEl.checked = true;
    } else {
      if (passEl) passEl.value = "";
      if (passOptEl) passOptEl.checked = false;
    }
    updateWelcomeHeading();
  }

  /* ---------- "Bem-vindo novamente!" só com uma conta já salva ----------
     O título mostra "Bem-vindo novamente!" apenas quando o e-mail no
     campo corresponde a uma conta que já fez login antes (lembrada).
     Caso contrário (campo vazio ou e-mail novo), mostra "Entrar".
     A mesma verificação também decide se o cenário/tema salvo dessa
     conta é aplicado na tela de login (ver applyLoginTheme). */
  function bindWelcomeHeading() {
    const emailEl = document.getElementById("login-email");
    if (emailEl) emailEl.addEventListener("input", updateWelcomeHeading);
  }

  function updateWelcomeHeading() {
    const heading = document.getElementById("login-welcome");
    const emailEl = document.getElementById("login-email");
    if (!heading || !emailEl) return;
    const email = emailEl.value.trim().toLowerCase();
    const match = email ? getAccounts().find((a) => a.email.toLowerCase() === email) : null;
    heading.textContent = match ? "Bem-vindo novamente!" : "Entrar";
    // Sem conta reconhecida, usa o primeiro cenário do catálogo (Céu
    // Azul) como padrão em vez de deixar sem nenhum tema — assim a
    // tela de login nunca fica sem cenário/cor combinando.
    const defaultScene = MSNScenes.list[0].id;
    applyLoginTheme(match ? match.scene || defaultScene : defaultScene, match ? match.colorScheme : null);
    applyLoginAvatar(match ? match.avatarUrl : null);
  }

  /* ---------- Foto de exibição lembrada (por conta) ----------
     Igual ao cenário/tema: quando uma conta reconhecida está
     selecionada, mostra a última foto de exibição salva do perfil
     dessa conta nas telas de login e "Entrando...". Sem conta
     reconhecida (ou sem foto), volta ao bonequinho padrão. */
  function applyLoginAvatar(url) {
    const src = typeof MSNScenes !== "undefined" ? MSNScenes.avatarSrc(url) : url;
    document
      .querySelectorAll("#login-avatar-frame .status-frame__photo, #connecting-avatar-frame .status-frame__photo")
      .forEach((el) => {
        el.innerHTML = "";
        const img = document.createElement("img");
        img.className = "avatar-img";
        img.alt = "";
        img.src = src;
        el.appendChild(img);
      });
  }

  /* ---------- Tema da tela de login (por conta) ----------
     Quando uma conta reconhecida está selecionada, a tela de login usa
     o cenário/tema salvo do perfil dessa conta (fundo tingido e título
     colorido), guardado localmente no dispositivo. Sem conta reconhecida
     (ver updateWelcomeHeading), usa o cenário "Céu Azul" (o primeiro do
     catálogo) como padrão — assim sempre tem cenário + cor combinando,
     nunca fica sem tema nenhum. O esquema de cores (se escolhido à
     parte no Dashboard) tem prioridade sobre a cor pareada ao cenário. */
  let currentLoginKey = undefined;
  function applyLoginTheme(sceneId, colorSchemeId) {
    const key = sceneId + "|" + (colorSchemeId || "");
    if (key === currentLoginKey) return;
    currentLoginKey = key;

    const root = document.body;
    if (!sceneId || typeof MSNScenes === "undefined") {
      root.removeAttribute("data-login-theme");
      ["--lg1", "--lg2", "--lg3", "--lg4", "--lg5", "--login-accent", "--login-accent-text", "--login-scene", "--login-scene-tint"].forEach((p) =>
        root.style.removeProperty(p)
      );
      return;
    }

    const hex = MSNScenes.effectiveTheme(sceneId, colorSchemeId);
    // --lg1 (a faixa logo abaixo do banner de 150px) fica bem mais
    // clara que a cor pura do tema — a maioria das imagens de cenário
    // já esmaece pra um tom bem pálido perto da borda de baixo, então
    // uma mistura mais saturada aqui criava uma "costura" visível
    // entre a foto e o degradê. 0.78 fica bem mais parecido com a
    // borda das imagens (ex.: Céu Azul termina quase branco-azulado).
    root.style.setProperty("--lg1", MSNScenes.pastel(hex, 0.78));
    root.style.setProperty("--lg2", MSNScenes.pastel(hex, 0.68));
    root.style.setProperty("--lg3", MSNScenes.pastel(hex, 0.8));
    root.style.setProperty("--lg4", MSNScenes.pastel(hex, 0.9));
    root.style.setProperty("--lg5", MSNScenes.pastel(hex, 0.97));
    root.style.setProperty("--login-accent", hex);
    // Escurecido: a cor pura do tema (ex.: verde do cenário "Futebol")
    // pode ficar quase ilegível como texto sobre o próprio fundo
    // tingido com a mesma cor — usado só no texto (ver .welcome).
    root.style.setProperty("--login-accent-text", MSNScenes.shade(hex, 0.4));
    root.setAttribute("data-login-theme", sceneId);

    // Cenário (imagem) no topo — separado da cor de tema, que continua
    // pintando o degradê do restante da tela. Sem imagem enviada para
    // este cenário ainda, a propriedade some e nada é desenhado ali.
    // Só a URL aqui — o tamanho/posição/cover ficam no CSS (::before de
    // #screen-login/#screen-connecting), pra "cover" funcionar de
    // verdade dentro da faixa de 150px sem esticar a imagem.
    const imgUrl = MSNScenes.image(sceneId);
    if (imgUrl) {
      root.style.setProperty("--login-scene", "url('" + imgUrl + "')");
    } else {
      root.style.removeProperty("--login-scene");
    }

    // Recolore o cenário padrão (Céu Azul) via CSS quando um esquema de
    // cores independente é escolhido — os demais cenários mantêm as
    // cores originais da própria foto (ver MSNScenes.bg/.dash-header
    // no Dashboard, mesma regra).
    const tintHex = sceneId === MSNScenes.list[0].id ? MSNScenes.colorSchemeHex(colorSchemeId) : null;
    if (tintHex) {
      root.style.setProperty("--login-scene-tint", tintHex);
    } else {
      root.style.removeProperty("--login-scene-tint");
    }
  }

  /* ---------- Dropdown de contas ---------- */
  function bindAccountDropdown() {
    const arrow = document.getElementById("account-arrow");
    const menu = document.getElementById("account-menu");
    if (!arrow || !menu) return;

    const close = () => { menu.hidden = true; arrow.setAttribute("aria-expanded", "false"); };

    arrow.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (menu.hidden) {
        renderAccountMenu();
        if (getAccounts().length) { menu.hidden = false; arrow.setAttribute("aria-expanded", "true"); }
      } else {
        close();
      }
    });

    document.addEventListener("click", (e) => {
      if (!e.target.closest(".field--combo")) close();
    });

    menu.addEventListener("click", (e) => {
      const removeBtn = e.target.closest(".account-remove");
      if (removeBtn) {
        e.stopPropagation();
        removeAccount(removeBtn.dataset.email);
        renderAccountMenu();
        updateWelcomeHeading();
        if (!getAccounts().length) close();
        return;
      }
      const different = e.target.closest('[data-action="different-account"]');
      if (different) {
        const emailEl = document.getElementById("login-email");
        const passEl = document.getElementById("login-password");
        const meEl = document.getElementById("opt-remember-me");
        const passOptEl = document.getElementById("opt-remember-pass");
        if (emailEl) { emailEl.value = ""; }
        if (passEl) passEl.value = "";
        if (meEl) meEl.checked = false;
        if (passOptEl) passOptEl.checked = false;
        updateWelcomeHeading();
        close();
        if (emailEl) emailEl.focus();
        return;
      }

      const item = e.target.closest(".account-item");
      if (item) {
        const acc = getAccounts().find((a) => a.email === item.dataset.email);
        if (acc) applyAccount(acc);
        close();
      }
    });
  }

  function renderAccountMenu() {
    const menu = document.getElementById("account-menu");
    if (!menu) return;
    const list = getAccounts();
    if (!list.length) { menu.innerHTML = ""; menu.hidden = true; return; }

    const emailEl = document.getElementById("login-email");
    const current = emailEl ? emailEl.value.trim().toLowerCase() : "";

    const rows = list.map((a) => {
      const selected = a.email.toLowerCase() === current;
      return (
        '<li class="account-item' + (selected ? " account-item--selected" : "") +
        '" role="option" data-email="' + escAttr(a.email) + '">' +
        '<span class="account-item__email">' + escHtml(a.email) + "</span>" +
        '<button type="button" class="account-remove" data-email="' + escAttr(a.email) +
        '" aria-label="Remover conta" title="Remover">&times;</button>' +
        "</li>"
      );
    }).join("");

    const differentRow =
      '<li class="account-item account-item--different" role="option" data-action="different-account">' +
      "Entrar com um e-mail diferente" +
      "</li>";

    menu.innerHTML = rows + differentRow;
  }

  function escHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }
  function escAttr(s) { return escHtml(s); }

  // Ofuscação simples (base64) da senha salva localmente — NÃO é criptografia.
  function obfuscate(s) {
    try { return btoa(unescape(encodeURIComponent(s))); } catch (_) { return ""; }
  }
  function deobfuscate(s) {
    try { return decodeURIComponent(escape(atob(s))); } catch (_) { return ""; }
  }

  /* ---------- Links extras ---------- */
  function bindExtraLinks() {
    const forgetMe = document.getElementById("link-forget-me");
    if (forgetMe) {
      forgetMe.addEventListener("click", (e) => {
        e.preventDefault();
        try { localStorage.removeItem("msn:email"); } catch (_) {}
        document.getElementById("login-email").value = "";
        UIManager.showMessage("Conta esquecida neste dispositivo.", "info");
      });
    }

    const forgotPass = document.getElementById("link-forgot-pass");
    if (forgotPass) {
      forgotPass.addEventListener("click", (e) => {
        e.preventDefault();
        UIManager.showMessage(
          "Recuperação de senha será adicionada em breve.",
          "info"
        );
      });
    }
  }

  /* ---------- Mensagens de erro amigáveis ---------- */
  function friendlyError(err) {
    const msg = (err && err.message) || "";
    if (/invalid login credentials/i.test(msg)) {
      return "E-mail ou senha incorretos. Tente novamente.";
    }
    if (/email not confirmed/i.test(msg)) {
      return "Confirme seu e-mail antes de entrar.";
    }
    if (/network|fetch/i.test(msg)) {
      return "Sem conexão com o servidor. Verifique sua internet.";
    }
    return msg || "Não foi possível entrar. Tente novamente.";
  }

  /* ---------- Service Worker (PWA) ---------- */
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }

  return { updateRememberedTheme };
})();
