/* ============================================================
   app.js
   Inicialização global e orquestração da tela de entrada.
   ============================================================ */

(function () {
  "use strict";

  let connecting = false;
  let cancelRequested = false;

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    MSNSupabase.init();
    UIManager.init();
    SoundManager.preload();

    restoreRemembered();
    bindLoginForm();
    bindSignupForm();
    bindCancel();
    bindExtraLinks();
    bindNavigation();
    bindPasswordToggles();
    bindWindowControls();
  }

  /* ---------- Botões da barra de título (início / girar / fechar) ---------- */
  function bindWindowControls() {
    document.querySelectorAll(".titlebar__buttons").forEach((bar) => bar.removeAttribute("aria-hidden"));
    document.querySelectorAll(".tb-btn--min").forEach((b) => {
      b.setAttribute("role", "button");
      b.setAttribute("title", "Início");
      b.setAttribute("aria-label", "Início");
      b.addEventListener("click", goHome);
    });
    document.querySelectorAll(".tb-btn--max").forEach((b) => {
      b.setAttribute("role", "button");
      b.setAttribute("title", "Girar a tela");
      b.setAttribute("aria-label", "Girar a tela");
      b.addEventListener("click", toggleOrientation);
    });
    document.querySelectorAll(".tb-btn--close").forEach((b) => {
      b.setAttribute("role", "button");
      b.setAttribute("title", "Fechar");
      b.setAttribute("aria-label", "Fechar");
      b.addEventListener("click", closeApp);
    });
  }

  // "_" → funciona como o botão Início do celular (envia o app ao segundo plano).
  // No app empacotado (Android/TWA) o próprio sistema trata; na web fazemos o
  // melhor esforço: sair da tela cheia e tirar o foco da janela.
  function goHome() {
    exitFullscreen();
    try { window.blur(); } catch (_) {}
  }

  // "□" → gira a tela para modo paisagem (e volta para retrato).
  let isLandscape = false;
  async function toggleOrientation() {
    try {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
      }
    } catch (_) {}
    try {
      const orientation = screen.orientation;
      if (orientation && orientation.lock) {
        await orientation.lock(isLandscape ? "portrait" : "landscape");
        isLandscape = !isLandscape;
      }
    } catch (_) {
      // orientation.lock exige tela cheia e suporte do dispositivo (móvel)
    }
  }

  // "X" → encerra o app (no TWA/Android fecha a atividade e sai dos recentes).
  // Na web, tentamos fechar; se o navegador bloquear, mostramos a tela de "encerrado".
  function closeApp() {
    exitFullscreen();
    try { window.close(); } catch (_) {}
    setTimeout(() => {
      if (!document.hidden) showClosedScreen();
    }, 200);
  }

  function showClosedScreen() {
    document.body.innerHTML =
      '<div class="app-closed">' +
      '<img src="assets/icons/icon-192.png" alt="MSN" width="72" height="72" />' +
      "<p>Aplicativo encerrado.</p>" +
      '<button type="button" onclick="location.reload()">Abrir novamente</button>' +
      "</div>";
  }

  function exitFullscreen() {
    try { if (document.exitFullscreen && document.fullscreenElement) document.exitFullscreen(); } catch (_) {}
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

      UIManager.clearMessage();
      saveRemembered(email);
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

  /* ---------- "Lembrar-me" (e-mail) ---------- */
  function saveRemembered(email) {
    const remember = document.getElementById("opt-remember-me");
    try {
      if (remember && remember.checked) {
        localStorage.setItem("msn:email", email);
      } else {
        localStorage.removeItem("msn:email");
      }
    } catch (_) {}
  }

  function restoreRemembered() {
    try {
      const email = localStorage.getItem("msn:email");
      if (email) document.getElementById("login-email").value = email;
    } catch (_) {}
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
})();
