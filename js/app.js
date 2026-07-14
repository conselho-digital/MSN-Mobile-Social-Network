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
    bindCancel();
    bindExtraLinks();
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

  function onSignedIn(result) {
    // O Dashboard ainda será construído. Por enquanto sinalizamos sucesso.
    const demo = result && result.demo;
    setConnectingText("Conectado!");
    UIManager.showScreen("screen-login");
    UIManager.showMessage(
      demo
        ? "Login simulado com sucesso (modo demo). Configure o Supabase em js/supabase-client.js para ativar contas reais. O Dashboard será a próxima etapa."
        : "Conectado com sucesso! O Dashboard do MSN será a próxima etapa.",
      "info"
    );
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

    const signup = document.getElementById("link-signup");
    if (signup) {
      signup.addEventListener("click", (e) => {
        e.preventDefault();
        UIManager.showMessage(
          "A tela de cadastro será construída na próxima etapa.",
          "info"
        );
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
