(function () {
  "use strict";

  const planId = document.documentElement.dataset.planId || "";

  const approveBtn = document.querySelector('[data-action="approve"]');
  const modifyBtn = document.querySelector('[data-action="modify"]');
  const modifyText = document.querySelector('[data-modify-text]');
  const parallelBtn = document.querySelector('[data-action="parallel"]');
  const parallelLabel = document.querySelector('[data-parallel-label]');
  const toastEl = document.querySelector('[data-toast]');
  const questionEntries = (() => {
    const map = new Map();
    for (const t of document.querySelectorAll('textarea[data-question]')) {
      const num = parseInt(t.dataset.qNum || "0", 10);
      if (!Number.isFinite(num) || num <= 0) continue;
      map.set(num, { num, kind: "text", el: t });
    }
    for (const opt of document.querySelectorAll('input[data-q-option]')) {
      const num = parseInt(opt.dataset.qNum || "0", 10);
      if (!Number.isFinite(num) || num <= 0) continue;
      const kind = opt.type === "checkbox" ? "checkbox" : "radio";
      const existing = map.get(num);
      if (existing && existing.kind === kind) {
        existing.inputs.push(opt);
      } else {
        map.set(num, { num, kind, inputs: [opt] });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.num - b.num);
  })();
  const stepBoxes = Array.from(document.querySelectorAll('input[data-step-parallel]'));
  const globalBox = document.querySelector('input[data-step-parallel-all]');
  const detailsBtns = Array.from(document.querySelectorAll('[data-step-details]'));
  const parallelizableNums = stepBoxes
    .map((cb) => parseInt(cb.dataset.step, 10))
    .filter((n) => Number.isFinite(n));

  const queuedSteps = new Set();
  let toastTimer = null;

  function updateGlobalToggleState() {
    if (!globalBox) return;
    const allOn =
      parallelizableNums.length > 0 &&
      parallelizableNums.every((n) => queuedSteps.has(n));
    globalBox.checked = allOn;
  }

  function fence(action, bodyLines) {
    const lines = ["```planresponse " + planId, action];
    if (bodyLines && bodyLines.length) {
      for (const line of bodyLines) lines.push(line);
    }
    lines.push("```");
    return lines.join("\n");
  }

  function showToast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.hidden = true;
    }, 1800);
  }

  function flashSuccess(btn) {
    if (!btn) return;
    const original = btn.innerHTML;
    const wasDisabled = btn.disabled;
    btn.innerHTML = '<span class="btn-icon">✓</span> Copied';
    btn.disabled = true;
    setTimeout(() => {
      btn.innerHTML = original;
      btn.disabled = wasDisabled;
    }, 1500);
  }

  function copy(text, btn) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        () => {
          showToast("Copied — paste in chat");
          flashSuccess(btn);
        },
        (err) => {
          console.error("Clipboard write failed", err);
          showToast("Copy failed — select text manually");
        }
      );
    } else {
      console.error("Clipboard API unavailable");
      showToast("Copy failed — select text manually");
    }
  }

  function answerOf(q) {
    if (q.kind === "text") return q.el.value.trim();
    const picked = q.inputs.filter((i) => i.checked).map((i) => i.value);
    return picked.join(", ");
  }

  function unansweredCount() {
    let n = 0;
    for (const q of questionEntries) {
      if (!answerOf(q)) n++;
    }
    return n;
  }

  function updateApproveState() {
    if (!approveBtn) return;
    const missing = unansweredCount();
    if (questionEntries.length === 0 || missing === 0) {
      approveBtn.disabled = false;
      approveBtn.removeAttribute("title");
    } else {
      approveBtn.disabled = true;
      approveBtn.title = "Answer " + missing + " question(s) to approve";
    }
  }

  function updateParallelState() {
    if (!parallelBtn) return;
    const n = queuedSteps.size;
    if (parallelLabel) parallelLabel.textContent = "Fork " + n;
    parallelBtn.disabled = n === 0;
  }

  // Approve gating — text inputs listen for input; option inputs listen for change
  for (const q of questionEntries) {
    if (q.kind === "text") {
      q.el.addEventListener("input", updateApproveState);
    } else {
      for (const i of q.inputs) i.addEventListener("change", updateApproveState);
    }
  }

  // Approve click — includes queued forks so a single approve carries both signals
  if (approveBtn) {
    approveBtn.addEventListener("click", () => {
      if (approveBtn.disabled) return;
      const body = [];
      for (const q of questionEntries) {
        const v = answerOf(q);
        if (v) body.push("q" + q.num + ": " + v);
      }
      if (queuedSteps.size > 0) {
        const sorted = Array.from(queuedSteps).sort((a, b) => a - b);
        body.push("fork: " + sorted.join(", "));
      }
      copy(fence("approve", body), approveBtn);
    });
  }

  // Modify click
  if (modifyBtn && modifyText) {
    modifyBtn.addEventListener("click", () => {
      const v = modifyText.value.trim();
      if (!v) {
        modifyText.focus();
        showToast("Type a modification first");
        return;
      }
      const body = v.split("\n");
      copy(fence("modify", body), modifyBtn);
    });
  }

  // Per-step parallel checkbox
  for (const cb of stepBoxes) {
    cb.addEventListener("change", () => {
      const step = parseInt(cb.dataset.step, 10);
      if (!Number.isFinite(step)) return;
      if (cb.checked) queuedSteps.add(step);
      else queuedSteps.delete(step);
      updateGlobalToggleState();
      updateParallelState();
    });
  }

  // Global "parallel all" checkbox
  if (globalBox) {
    globalBox.addEventListener("change", () => {
      const target = globalBox.checked;
      for (const cb of stepBoxes) {
        cb.checked = target;
        const step = parseInt(cb.dataset.step, 10);
        if (!Number.isFinite(step)) continue;
        if (target) queuedSteps.add(step);
        else queuedSteps.delete(step);
      }
      updateParallelState();
    });
  }

  // View details button toggles the hidden body
  for (const btn of detailsBtns) {
    btn.addEventListener("click", () => {
      const num = btn.getAttribute("data-step-details");
      if (num === null) return;
      const body = document.querySelector(`[data-step-body="${CSS.escape(num)}"]`);
      if (!body) return;
      const wasHidden = body.hasAttribute("hidden");
      if (wasHidden) body.removeAttribute("hidden");
      else body.setAttribute("hidden", "");
      btn.textContent = wasHidden ? "Hide details" : "View details";
      btn.setAttribute("aria-expanded", wasHidden ? "true" : "false");
    });
  }

  // Launch parallel click
  if (parallelBtn) {
    parallelBtn.addEventListener("click", () => {
      if (parallelBtn.disabled) return;
      const sorted = Array.from(queuedSteps).sort((a, b) => a - b);
      copy(fence("fork", ["steps: " + sorted.join(", ")]), parallelBtn);
    });
  }

  updateApproveState();
  updateParallelState();

  // —————— Settings (theme / font / color) ——————
  const STORAGE_KEY = "planui:prefs";
  const VALID = {
    theme: ["dark", "midnight", "light"],
    font: ["sans", "serif", "mono"],
    color: ["blue", "green", "purple", "white"],
  };

  function readStored() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (e) { return {}; }
  }

  function writeStored(prefs) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  function sanitize(prefs) {
    const out = {};
    for (const k of Object.keys(VALID)) {
      const v = prefs && prefs[k];
      if (typeof v === "string" && VALID[k].includes(v)) out[k] = v;
    }
    return out;
  }

  function applyPrefs(prefs) {
    const root = document.documentElement;
    for (const k of Object.keys(VALID)) {
      if (prefs[k]) root.setAttribute("data-" + k, prefs[k]);
      else root.removeAttribute("data-" + k);
    }
    // Sync radio inputs with current values
    for (const k of Object.keys(VALID)) {
      const input = document.querySelector(
        '.settings-panel input[name="' + k + '"][value="' + (prefs[k] || "") + '"]'
      );
      if (input) input.checked = true;
    }
  }

  // Merge defaults + stored at load (stored wins)
  const defaults = sanitize(
    (typeof window.__PLANUI_DEFAULTS === "object" && window.__PLANUI_DEFAULTS) || {}
  );
  const stored = sanitize(readStored());
  const initial = Object.assign({}, defaults, stored);
  applyPrefs(initial);

  // Live toggle: when a settings radio changes, update state + apply + persist
  const settingsPanel = document.querySelector('[data-settings-panel]');
  if (settingsPanel) {
    for (const input of settingsPanel.querySelectorAll('input[type="radio"]')) {
      input.addEventListener("change", () => {
        const name = input.name;
        const value = input.value;
        if (!VALID[name] || !VALID[name].includes(value)) return;
        const next = Object.assign({}, sanitize(readStored()));
        next[name] = value;
        writeStored(next);
        applyPrefs(Object.assign({}, defaults, next));
      });
    }
  }

  // Dropdown open/close
  const settingsBtn = document.querySelector('[data-settings-toggle]');
  function setSettingsOpen(open) {
    if (!settingsBtn || !settingsPanel) return;
    if (open) {
      settingsPanel.removeAttribute("hidden");
      settingsBtn.setAttribute("aria-expanded", "true");
    } else {
      settingsPanel.setAttribute("hidden", "");
      settingsBtn.setAttribute("aria-expanded", "false");
    }
  }
  if (settingsBtn) {
    settingsBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const isOpen = settingsBtn.getAttribute("aria-expanded") === "true";
      setSettingsOpen(!isOpen);
    });
  }
  document.addEventListener("click", (e) => {
    if (!settingsPanel || settingsPanel.hasAttribute("hidden")) return;
    if (settingsPanel.contains(e.target) || (settingsBtn && settingsBtn.contains(e.target))) return;
    setSettingsOpen(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") setSettingsOpen(false);
  });

  // Save as default — copy a prefspersist token
  const saveBtn = document.querySelector('[data-settings-save]');
  if (saveBtn) {
    saveBtn.addEventListener("click", () => {
      const current = Object.assign({}, defaults, sanitize(readStored()));
      const body = [];
      for (const k of ["theme", "font", "color"]) {
        if (current[k]) body.push(k + ": " + current[k]);
      }
      copy(fence("prefspersist", body), saveBtn);
      setSettingsOpen(false);
    });
  }
})();
