/* ============================================================
   landing.js
   Landing page: instalar o PWA (Android) ou ir para o login
   (iPhone/qualquer navegador sem suporte a instalação).
   ============================================================ */

(function () {
  "use strict";

  let deferredInstallPrompt = null;

  const installBtn = document.getElementById("landing-install");
  const iosHint = document.getElementById("landing-ios-hint");
  const installedHint = document.getElementById("landing-installed-hint");

  function isStandalone() {
    return (
      window.matchMedia("(display-mode: standalone)").matches ||
      window.navigator.standalone === true
    );
  }
  function isIOS() {
    return /iPhone|iPad|iPod/i.test(navigator.userAgent || "");
  }

  // O navegador (Chrome/Android) dispara este evento quando o site é instalável.
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    if (installBtn) installBtn.hidden = false;
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    if (installBtn) installBtn.hidden = true;
    if (installedHint) installedHint.hidden = false;
  });

  if (installBtn) {
    installBtn.addEventListener("click", async () => {
      if (!deferredInstallPrompt) return;
      deferredInstallPrompt.prompt();
      try {
        const { outcome } = await deferredInstallPrompt.userChoice;
        if (outcome === "accepted") installBtn.hidden = true;
      } catch (_) {}
      deferredInstallPrompt = null;
    });
  }

  if (isStandalone()) {
    if (installBtn) installBtn.hidden = true;
    if (installedHint) installedHint.hidden = false;
  } else if (isIOS() && iosHint) {
    // iPhone não dispara beforeinstallprompt; orienta a instalação manual.
    iosHint.hidden = false;
  }

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }
})();
