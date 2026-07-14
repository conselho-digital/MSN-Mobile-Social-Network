/* ============================================================
   ui-manager.js
   Controle das telas e dos componentes interativos da tela
   de login (menu de status, opções expansíveis).
   ============================================================ */

const UIManager = (() => {
  /* ---------- Troca de telas ---------- */
  function showScreen(id) {
    document.querySelectorAll(".screen").forEach((s) => {
      s.classList.toggle("screen--active", s.id === id);
    });
  }

  /* ---------- Estado do status selecionado ---------- */
  const state = { status: "online", statusLabel: "Disponível" };

  /* ---------- Menu de status (Disponível / Ocupado / ...) ---------- */
  function initStatusMenu() {
    const toggle = document.getElementById("status-toggle");
    const menu = document.getElementById("status-menu");
    const dot = document.getElementById("status-dot");
    const label = document.getElementById("status-label");
    if (!toggle || !menu) return;

    const closeMenu = () => {
      menu.hidden = true;
      toggle.setAttribute("aria-expanded", "false");
    };

    toggle.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = menu.hidden;
      menu.hidden = !open;
      toggle.setAttribute("aria-expanded", String(open));
    });

    menu.querySelectorAll("li").forEach((li) => {
      li.addEventListener("click", () => {
        state.status = li.dataset.status;
        state.statusLabel = li.dataset.label;
        dot.className = "status-dot status-dot--" + state.status;
        label.textContent = state.statusLabel;
        closeMenu();
      });
    });

    document.addEventListener("click", closeMenu);
  }

  /* ---------- Chevron das opções expansíveis ---------- */
  function initOptionsToggle() {
    const btn = document.getElementById("options-toggle");
    const panel = document.getElementById("login-options");
    if (!btn || !panel) return;

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const willOpen = panel.hidden;
      panel.hidden = !willOpen;
      btn.setAttribute("aria-expanded", String(willOpen));
    });
  }

  /* ---------- Mensagens ---------- */
  function showMessage(text, type = "error") {
    const el = document.getElementById("login-message");
    if (!el) return;
    el.textContent = text;
    el.hidden = false;
    el.classList.toggle("login-message--info", type === "info");
  }
  function clearMessage() {
    const el = document.getElementById("login-message");
    if (el) el.hidden = true;
  }

  function getStatus() { return { ...state }; }

  function init() {
    initStatusMenu();
    initOptionsToggle();
  }

  return { init, showScreen, showMessage, clearMessage, getStatus };
})();
