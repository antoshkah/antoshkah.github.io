(function () {
  const STORAGE_KEY = "clock-settings";
  const SIZE_MIN = 50;
  const SIZE_MAX = 200;
  const SIZE_STEP = 10;
  const FADE_MS = 280; // same as the page transitions
  const FOOTER_FADE_DELAY_MS = 1000;

  const autoTz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const defaults = { size: 100, format: "24", tzMode: "auto", tz: autoTz, showDate: "on", showUtc: "on" };

  const clockWrapEl = document.getElementById("clock-wrap");
  const clockEl = document.getElementById("clock");
  const dateEl = document.getElementById("clock-date");
  const utcEl = document.getElementById("clock-date-utc");
  const footerEl = document.getElementById("clock-footer");
  const dialogEl = document.getElementById("clock-settings");
  const sizeEl = document.getElementById("cs-size");
  const tzAutoEl = document.getElementById("cs-tz-auto");
  const tzSelectEl = document.getElementById("cs-tz-select");

  let settings = load();

  function load() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return { ...defaults, ...(stored || {}) };
    } catch {
      return { ...defaults };
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {}
  }

  function currentTz() {
    return settings.tzMode === "manual" && settings.tz ? settings.tz : autoTz;
  }

  // the parts of a moment in a given time zone (hour as 00–23)
  function partsIn(date, timeZone) {
    const out = {};
    new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .forEach((part) => (out[part.type] = part.value));
    return out;
  }

  function formatTime(p, format) {
    if (format === "12") {
      const h24 = Number(p.hour);
      const h12 = String(h24 % 12 || 12).padStart(2, "0");
      return `${h12}:${p.minute}:${p.second}<span class="clock-ampm">${h24 < 12 ? "am" : "pm"}</span>`;
    }
    return `${p.hour}:${p.minute}:${p.second}`;
  }

  function render() {
    const now = new Date();
    let p;
    try {
      p = partsIn(now, currentTz());
    } catch {
      p = partsIn(now, autoTz); // a stored zone this browser doesn't know
    }
    clockEl.innerHTML = formatTime(p, settings.format);
    dateEl.textContent = `${p.year}-${p.month}-${p.day}`;
    const u = partsIn(now, "UTC");
    utcEl.textContent = `${u.hour}:${u.minute}:${u.second} UTC`;
  }

  // push the settings onto the clock, and onto the controls in the popup
  function apply() {
    document.documentElement.style.setProperty("--clock-scale", settings.size / 100);
    dateEl.hidden = settings.showDate !== "on";
    utcEl.hidden = settings.showUtc !== "on";

    sizeEl.textContent = `${settings.size}%`;
    dialogEl.querySelectorAll(".cs-choices").forEach((group) => {
      group.querySelectorAll("[data-value]").forEach((btn) => {
        const on = btn.dataset.value === String(settings[group.dataset.key]);
        btn.classList.toggle("is-on", on);
        btn.setAttribute("aria-pressed", on);
      });
    });
    dialogEl.querySelectorAll(".cs-toggle").forEach((toggle) => {
      const on = settings[toggle.dataset.key] === toggle.dataset.on;
      toggle.classList.toggle("is-on", on);
      toggle.setAttribute("aria-checked", on);
    });
    const manual = settings.tzMode === "manual";
    tzAutoEl.hidden = manual;
    tzSelectEl.hidden = !manual;
    tzSelectEl.value = settings.tz;
    render();
  }

  // the timezone list: every zone this browser knows
  (function fillZones() {
    let zones = [];
    try {
      zones = Intl.supportedValuesOf("timeZone").slice();
    } catch {}
    if (!zones.includes("UTC")) zones.unshift("UTC");
    if (!zones.includes(autoTz)) zones.push(autoTz);
    if (settings.tz && !zones.includes(settings.tz)) zones.push(settings.tz);
    zones.forEach((zone) => {
      const opt = document.createElement("option");
      opt.value = zone;
      opt.textContent = zone.replace(/_/g, " ");
      tzSelectEl.append(opt);
    });
    tzAutoEl.textContent = autoTz.replace(/_/g, " ");
  })();

  // controls
  dialogEl.querySelectorAll("[data-size]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = settings.size + Number(btn.dataset.size) * SIZE_STEP;
      settings.size = Math.min(SIZE_MAX, Math.max(SIZE_MIN, next));
      save();
      apply();
    });
  });

  dialogEl.querySelectorAll(".cs-choices").forEach((group) => {
    group.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-value]");
      if (!btn) return;
      settings[group.dataset.key] = btn.dataset.value;
      save();
      apply();
    });
  });

  dialogEl.querySelectorAll(".cs-toggle").forEach((toggle) => {
    toggle.addEventListener("click", () => {
      const { key, on, off } = toggle.dataset;
      settings[key] = settings[key] === on ? off : on;
      save();
      apply();
    });
  });

  tzSelectEl.addEventListener("change", () => {
    settings.tz = tzSelectEl.value;
    save();
    apply();
  });

  // the popup: fades in over the page, fades out on close (× or Escape)
  let closeTimer = null;

  function openSettings() {
    clearTimeout(closeTimer);
    if (!dialogEl.open) dialogEl.showModal();
    requestAnimationFrame(() => dialogEl.classList.add("is-open"));
  }

  function closeSettings() {
    dialogEl.classList.remove("is-open");
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      dialogEl.close();
      clockWrapEl.focus({ preventScroll: true });
    }, FADE_MS);
  }

  clockWrapEl.addEventListener("click", openSettings);
  clockWrapEl.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openSettings();
    }
  });
  document.getElementById("cs-close").addEventListener("click", closeSettings);
  dialogEl.addEventListener("cancel", (event) => {
    event.preventDefault(); // Escape: fade out instead of vanishing
    closeSettings();
  });

  // the back button fades away after a moment (comes back on hover)
  if (footerEl) {
    setTimeout(() => footerEl.classList.add("is-faded"), FOOTER_FADE_DELAY_MS);
  }

  apply();
  setInterval(render, 1000);
})();
