// settings page: font, colours, hold, pause. loadSettings / applySettings / THEMES / FONTS live in
// the inline script in index.html's <head>, so the look is applied before the page draws

// settings
let settings = loadSettings();
function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {}
  applySettings(settings);
  renderSettings();
}
const holdLabel = (ms) => `${(ms / 1000).toFixed(1)}s`;
// font list: one button per font, made once and only ever reordered (chosen font first)
const fontBtns = {};
for (const [key, f] of Object.entries(FONTS)) {
  const b = document.createElement("button");
  b.textContent = f.label;
  b.style.fontFamily = f.css;
  b.setAttribute("role", "option");
  b.onclick = () => {
    const s = $("fontSetting");
    // the top line (the chosen font) opens / closes the list
    if (key === settings.font) {
      s.classList.toggle("open");
      return;
    }
    // another font: it slides up to the top while the list folds away
    settings.font = key;
    saveSettings();
    orderFonts(true);
    s.classList.remove("open");
  };
  fontBtns[key] = b;
}
$("fontList").style.setProperty("--n", Object.keys(FONTS).length);
// chosen font first, the rest in their usual order. animate: each button glides from
// where it was to its new place (measure, reorder, then play back the difference)
function orderFonts(animate) {
  const list = $("fontList");
  const before = new Map(Object.values(fontBtns).map((b) => [b, b.getBoundingClientRect().top]));
  const order = [settings.font, ...Object.keys(FONTS).filter((k) => k !== settings.font)];
  for (const k of order) {
    list.append(fontBtns[k]);
    fontBtns[k].setAttribute("aria-selected", k === settings.font);
  }
  if (!animate) return;
  for (const [b, top] of before) {
    const dy = top - b.getBoundingClientRect().top;
    if (dy) b.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], { duration: 250, easing: "ease" });
  }
}
function renderSettings() {
  const themes = $("themeList");
  themes.innerHTML = "";
  for (const [key, t] of Object.entries(THEMES)) {
    const b = document.createElement("button");
    b.style.background = t.bg;
    b.setAttribute("aria-label", key);
    b.title = key;
    b.classList.toggle("on", key === settings.theme);
    b.onclick = () => { settings.theme = key; saveSettings(); }; // stays open to try others
    themes.append(b);
  }
  $("holdNum").textContent = holdLabel(settings.hold);
  // 2☝ chosen: the seconds are locked
  $("holdStepper").classList.toggle("off", settings.timerOpen === "double");
  for (const b of document.querySelectorAll("[data-mode]")) {
    const [key, value] = b.dataset.mode.split(":");
    b.classList.toggle("on", settings[key] === value);
  }
  $("themeVal").innerHTML = `<span class="dot" style="background:${THEMES[settings.theme].bg}"></span>${settings.theme}`;
}
// timer gestures: double tap can only do one job, so picking it for one moves the other off it.
// stays open so both can be set in one go
for (const b of document.querySelectorAll("[data-mode]")) {
  const [key, value] = b.dataset.mode.split(":");
  b.onclick = () => {
    settings[key] = value;
    if (value === "double") {
      if (key === "timerOpen") {
        if (settings.timerPause === "double") settings.timerPause = "tap";
      } else {
        settings.timerOpen = "hold";
      }
    }
    saveSettings();
  };
}
// − / +: 0.1s a tap; keep holding to run through the values
for (const b of document.querySelectorAll("[data-step]")) {
  const [key, dir] = b.dataset.step.split(":");
  let repeat = null;
  const step = () => {
    const next = Math.min(HOLD_MAX, Math.max(HOLD_MIN, settings[key] + Number(dir) * HOLD_STEP));
    if (next === settings[key]) return;
    settings[key] = next;
    saveSettings();
  };
  const stop = () => { clearTimeout(repeat); clearInterval(repeat); };
  b.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    step();
    stop();
    repeat = setTimeout(() => (repeat = setInterval(step, 70)), 400);
  });
  for (const ev of ["pointerup", "pointerleave", "pointercancel"]) b.addEventListener(ev, stop);
  b.addEventListener("click", (e) => { if (e.detail === 0) step(); }); // keyboard
  b.addEventListener("contextmenu", (e) => e.preventDefault());
}
// each line opens / closes on its own; any number can be open at once
function closeDropdowns() {
  for (const s of document.querySelectorAll(".setting")) s.classList.remove("open");
}
for (const head of document.querySelectorAll(".set-head")) {
  head.onclick = () => head.parentElement.classList.toggle("open");
}
$("settingsBtn").onclick = () => {
  $("menuDialog").close();
  closeDropdowns();
  orderFonts(false);
  renderSettings();
  show($("settingsDialog"));
};
// the exit button is the only way out, and it goes back to the menu
$("settingsDone").onclick = () => {
  $("settingsDialog").close();
  show($("menuDialog"));
};
$("settingsDialog").addEventListener("cancel", (e) => e.preventDefault()); // no Esc / back gesture
