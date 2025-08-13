// ==UserScript==
// @name         Teams: Blocklist Manager (hide messages by sender)
// @namespace    com.von-luehmann.teams.blocklist
// @version      2.1
// @description  Hide Microsoft Teams (web v2) messages from any names on a managed blocklist. Hotkey Ctrl+Alt+B.
// @match        https://teams.microsoft.com/*
// @match        https://*.teams.microsoft.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  const STORAGE_KEY = "tm_teams_blocklist_v2";
  const DEBUG = false;

  // ---------- utils ----------
  const log = (...a) => DEBUG && console.log("[TeamsBlock]", ...a);
  const norm = (s) => (s || "").trim();

  const getBlocklist = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return new Set();
      const arr = JSON.parse(raw);
      return new Set((Array.isArray(arr) ? arr : []).map(norm).filter(Boolean));
    } catch {
      return new Set();
    }
  };
  const saveBlocklist = (set) => localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
  const isBlocked = (name, bl) => bl.has(norm(name));

  const findMessageContainer = (el) =>
    el.closest('[data-tid="chat-pane-item"]') ||
    el.closest('[data-tid="chat-pane-message"]') ||
    el.closest('[role="listitem"]') ||
    el;

  // ---------- hide / show ----------
  function hideIfBlocked(authorEl, bl) {
    const name = norm(authorEl.textContent);
    if (!name) return;

    const container = findMessageContainer(authorEl);
    if (!container) return;

    if (isBlocked(name, bl)) {
      if (container.style.display !== "none") {
        container.style.display = "none";
        container.setAttribute("data-tm-hidden", "1");
        container.setAttribute("aria-hidden", "true");
      }
    } else {
      if (container.getAttribute("data-tm-hidden") === "1") {
        container.style.display = "";
        container.removeAttribute("data-tm-hidden");
        container.removeAttribute("aria-hidden");
      }
    }
  }

  // ---------- quick chip next to author ----------
  const BTN_CLASS = "tm-block-chip";

  function ensureStyles() {
    if (document.getElementById("tm-blocklist-style")) return;
    const css = `
      .${BTN_CLASS} {
        display:inline-flex; align-items:center; gap:.3rem;
        font-size:11px; line-height:1; padding:2px 6px; border-radius:9999px;
        border:1px solid currentColor; opacity:.6; margin-left:.4rem; cursor:pointer;
        user-select:none;
      }
      .${BTN_CLASS}:hover { opacity:1 }
      .${BTN_CLASS}[data-state="blocked"] { opacity: .9; }
      .tm-blocklist-modal {
        position: fixed; z-index: 999999; inset: 0; display: none;
        align-items: center; justify-content: center; backdrop-filter: blur(2px);
        background: rgba(0,0,0,.25);
      }
      .tm-blocklist-card {
        width: min(520px, 92vw); background: #111827; color: #fff;
        border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,.4);
        padding: 14px; border: 1px solid rgba(255,255,255,.08);
      }
      .tm-blocklist-card h3 { margin: 0 0 8px; font-size: 16px; }
      .tm-blocklist-card small { opacity:.7 }
      .tm-row { display:flex; gap:8px; align-items:center; margin-top:10px; }
      .tm-row input { flex:1; padding:8px; border-radius:8px; border:1px solid #374151; background:#0b1220; color:#fff }
      .tm-row button { padding:8px 10px; border-radius:8px; border:1px solid #374151; background:#1f2937; color:#fff; cursor:pointer }
      .tm-row button:hover { background:#374151 }
      .tm-area { width:100%; height:160px; margin-top:8px; padding:8px; border-radius:8px; border:1px solid #374151; background:#0b1220; color:#fff; }
      .tm-actions { display:flex; gap:8px; justify-content:flex-end; margin-top:10px; }
      .tm-actions button.primary { background:#2563eb; border-color:#1d4ed8; }
      .tm-actions button.primary:hover { background:#1d4ed8; }
    `;
    const style = document.createElement("style");
    style.id = "tm-blocklist-style";
    style.textContent = css;
    document.head.appendChild(style);
  }

  function addChip(authorEl, bl) {
    if (!authorEl || authorEl.dataset.tmChipAttached === "1") return;
    const name = norm(authorEl.textContent);
    if (!name) return;

    const chip = document.createElement("span");
    chip.className = BTN_CLASS;
    const setChipState = () => {
      const list = getBlocklist();
      const blocked = list.has(name);
      // unblock for now just dummy content, was thinking about leaving name in chat but only hide message content
      chip.textContent = blocked ? "Unblock" : "Block";
      chip.setAttribute("data-state", blocked ? "blocked" : "unblocked");
      chip.title = blocked
        ? `Remove "${name}" from blocklist`
        : `Add "${name}" to blocklist`;
    };
    setChipState();

    chip.addEventListener("click", (e) => {
      e.stopPropagation();
      const list = getBlocklist();
      const n = norm(name);
      if (list.has(n)) {
        list.delete(n);
      } else {
        list.add(n);
      }
      saveBlocklist(list);
      setChipState();

      // Use rAF to batch DOM reads/writes smoothly.
      requestAnimationFrame(scanAll);
    });

    authorEl.insertAdjacentElement("afterend", chip);
    authorEl.dataset.tmChipAttached = "1";
  }

  // ---------- manager modal ----------
  let modal, textarea, inputAdd;
  function buildModal() {
    if (modal) return;
    modal = document.createElement("div");
    modal.className = "tm-blocklist-modal";

    const card = document.createElement("div");
    card.className = "tm-blocklist-card";

    const title = document.createElement("h3");
    title.textContent = "Teams Blocklist Manager";
    const hint = document.createElement("small");
    hint.textContent = 'One name per line (exactly as shown in Teams). Hotkey: Ctrl+Alt+B';

    inputAdd = document.createElement("input");
    inputAdd.placeholder = 'Add name (e.g., "Road Runner")';

    const btnAdd = document.createElement("button");
    btnAdd.textContent = "Add";
    btnAdd.addEventListener("click", () => {
      const v = norm(inputAdd.value);
      if (!v) return;
      const list = getBlocklist();
      list.add(v);
      saveBlocklist(list);
      loadListIntoTextarea();
      inputAdd.value = "";

      // Also reflect imediately in the UI
      requestAnimationFrame(scanAll);
    });

    const row = document.createElement("div");
    row.className = "tm-row";
    row.append(inputAdd, btnAdd);

    textarea = document.createElement("textarea");
    textarea.className = "tm-area";
    textarea.placeholder = "Current blocklist (one name per line)…";

    const actions = document.createElement("div");
    actions.className = "tm-actions";

    const btnSave = document.createElement("button");
    btnSave.textContent = "Save";
    btnSave.className = "primary";
    btnSave.addEventListener("click", () => {
      const next = new Set(
        textarea.value
          .split("\n")
          .map(norm)
          .filter(Boolean)
      );
      saveBlocklist(next);
      // Immediately re-scan everything
      requestAnimationFrame(scanAll);
      closeModal();
    });

    const btnClose = document.createElement("button");
    btnClose.textContent = "Close";
    btnClose.addEventListener("click", closeModal);

    actions.append(btnClose, btnSave);

    card.append(title, hint, row, textarea, actions);
    modal.append(card);
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeModal();
    });

    document.body.appendChild(modal);
  }

  function openModal() {
    buildModal();
    loadListIntoTextarea();
    modal.style.display = "flex";
    inputAdd.focus();
  }
  function closeModal() { if (modal) modal.style.display = "none"; }
  function loadListIntoTextarea() { textarea.value = [...getBlocklist()].join("\n"); }

  // ---------- scanning ----------
  function processAuthorEl(authorEl, bl) {
    hideIfBlocked(authorEl, bl);
    addChip(authorEl, bl);
  }

  function scanAll() {
    const bl = getBlocklist();
    document
      .querySelectorAll('span[data-tid="message-author-name"]')
      .forEach((el) => processAuthorEl(el, bl));
  }

  // ---------- hotkeys ----------
  function setupHotkeys() {
    window.addEventListener("keydown", (e) => {
      if (e.ctrlKey && e.altKey && (e.key === "b" || e.key === "B")) {
        e.preventDefault();
        openModal();
      }
    });
  }

  // ---------- observer ----------
  function start() {
    ensureStyles();
    setupHotkeys();
    scanAll();

    const obs = new MutationObserver((mutations) => {
      const bl = getBlocklist();
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.matches?.('span[data-tid="message-author-name"]')) {
            processAuthorEl(node, bl);
          } else {
            node
              .querySelectorAll?.('span[data-tid="message-author-name"]')
              .forEach((el) => processAuthorEl(el, bl));
          }
        }
      }
    });

    obs.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
