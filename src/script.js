(function () {
  const shortcutEls = document.querySelectorAll("[data-shortcut-key]");

  if (!shortcutEls.length) {
    return;
  }

  document.addEventListener("keydown", (event) => {
    if (event.ctrlKey || event.altKey || event.metaKey) {
      return;
    }

    const target = event.target;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
      return;
    }

    const key = event.key.toLowerCase();
    shortcutEls.forEach((el) => {
      if (el.dataset.shortcutKey === key) {
        el.click();
      }
    });
  });
})();

(function () {
  const soonEls = document.querySelectorAll(".link-soon");

  if (!soonEls.length) {
    return;
  }

  soonEls.forEach((el) => {
    const originalText = el.textContent;
    let resetTimer = null;

    el.addEventListener("click", () => {
      clearTimeout(resetTimer);
      el.textContent = "soon";
      resetTimer = setTimeout(() => {
        el.textContent = originalText;
      }, 900);
    });
  });
})();

(function () {
  const THEME_STORAGE_KEY = "site-theme";
  const pageBody = document.body;
  const themeToggleEl = document.getElementById("site-theme-toggle");

  // the wip front page has one fixed grey look: no dark mode, ignore any saved theme
  if (pageBody.classList.contains("front-page")) return;

  function applyTheme(theme) {
    const isDark = theme === "dark";
    pageBody.classList.toggle("theme-dark", isDark);
    pageBody.dataset.theme = isDark ? "dark" : "light";
    updateToggleLabel();
    window.dispatchEvent(
      new CustomEvent("site-theme-change", {
        detail: { theme: isDark ? "dark" : "light" },
      })
    );
  }

  function updateToggleLabel() {
    if (!themeToggleEl) return;
    const isDark = pageBody.classList.contains("theme-dark");
    const nextTheme = isDark ? "light" : "dark";
    themeToggleEl.setAttribute("aria-label", `switch to ${nextTheme} mode`);
    themeToggleEl.setAttribute("title", `switch to ${nextTheme} mode`);
  }

  function applyStoredTheme() {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    applyTheme(stored === "dark" ? "dark" : "light");
  }

  if (themeToggleEl) {
    themeToggleEl.addEventListener("click", () => {
      const nextTheme = pageBody.classList.contains("theme-dark") ? "light" : "dark";
      localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
      applyTheme(nextTheme);
    });
  }

  window.addEventListener("storage", (event) => {
    if (event.key !== THEME_STORAGE_KEY) {
      return;
    }
    applyTheme(event.newValue === "dark" ? "dark" : "light");
  });

  applyStoredTheme();
})();

// page changes: leaving, the page fades out (a back arrow also nudges left), a short empty beat, then the page we
// land on fades in. the landing page is already hidden by a tiny script in its <head> (adds .page-enter to <html>),
// so it never flashes before the fade
(function () {
  const FADE_KEY = "site-fade-in";
  const OUT_MS = 280; // fade out (and arrow nudge)
  const GAP_MS = 180; // empty beat before leaving
  const IN_DELAY_MS = 120; // empty beat before the new page fades in
  const root = document.documentElement;
  const main = document.querySelector("main");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (root.classList.contains("page-enter")) {
    setTimeout(() => root.classList.remove("page-enter"), reduced ? 0 : IN_DELAY_MS);
  }

  // coming back via the browser's own back/forward (bfcache): don't stay faded out
  window.addEventListener("pageshow", (event) => {
    if (!event.persisted) return;
    root.classList.remove("page-enter");
    if (main) main.classList.remove("page-leaving");
    document.querySelectorAll(".back-nudge").forEach((el) => el.classList.remove("back-nudge"));
  });

  function isInternalPageLink(link) {
    if (link.target && link.target !== "_self") return false;
    if (link.hasAttribute("download")) return false;
    const url = new URL(link.href, location.href);
    if (url.origin !== location.origin) return false;
    if (url.pathname === location.pathname && url.hash) return false; // same-page anchor
    return /\.html?$|\/$/.test(url.pathname); // a page, not a file (pdf, mp3…)
  }

  document.addEventListener("click", (event) => {
    if (reduced || !main || event.defaultPrevented) return;
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
    const link = event.target.closest && event.target.closest("a[href]");
    if (!link || !isInternalPageLink(link)) return;

    event.preventDefault();
    if (link.getAttribute("aria-label") === "back") link.classList.add("back-nudge");
    main.classList.add("page-leaving");
    try {
      sessionStorage.setItem(FADE_KEY, "1");
    } catch {}
    setTimeout(() => {
      window.location.href = link.href;
    }, OUT_MS + GAP_MS);
  });
})();

// front page cat: spins; first click -> "*meow*" bubble fades in, second click -> it flies off and kirby pops up
(function () {
  const catWrap = document.getElementById("cat-wrap");
  const cat = document.getElementById("cat");
  const bubble = document.getElementById("cat-bubble");
  const kirby = document.getElementById("kirby");
  if (!catWrap || !cat || !bubble || !kirby) return;

  let clicks = 0;

  cat.addEventListener("click", () => {
    clicks += 1;
    if (clicks === 1) {
      bubble.classList.add("is-visible");
      return;
    }
    if (clicks > 2) return;

    bubble.classList.remove("is-visible");
    const keyboard = cat.matches(":focus-visible"); // only hand focus on to kirby for keyboard users
    catWrap.classList.add("is-leaving");
    let done = false;
    const bringKirby = () => {
      if (done) return;
      done = true;
      catWrap.hidden = true;
      kirby.hidden = false;
      kirby.classList.add("is-popping");
      kirby.addEventListener("animationend", () => kirby.classList.remove("is-popping"), { once: true });
      if (keyboard) kirby.focus({ preventScroll: true });
    };
    catWrap.addEventListener("transitionend", (e) => {
      if (e.target === catWrap) bringKirby(); // ignore the bubble's own fade bubbling up
    });
    setTimeout(bringKirby, 900); // fallback if transitionend never fires
  });
})();

// kirby: idles (gentle bob, frames 28-58 looped) until clicked, then jumps and waves (frames 0-27) once.
// on the front page the first click also types out "this site is work in progress" below him, and he keeps
// jumping at you until the line is finished
(function () {
  const kirby = document.getElementById("kirby");
  const sprite = kirby && kirby.querySelector(".kirby-sprite");
  if (!sprite) return;

  const COLS = 10;
  const ROWS = 6;
  const FRAME_MS = 40;
  const IDLE_START = 28;
  const IDLE_END = 58;
  const TYPE_MS = 75;
  const HOLD_START = 9;
  const HOLD_END = 20;

  const says = document.getElementById("kirby-says");
  const LINE = "site is wip";
  const CUTS = { 8: 1, 9: 2, 10: 3 }; // index of the w, i, p -> which cut-out style
  const BREAKS = { 7: true }; // spaces that become line breaks: "site is" / wip

  let frame = IDLE_START;
  let jumping = false;
  let talking = false;
  let dir = 1;
  let said = false;
  let last = 0;

  // lay the whole line out up front (hidden) so the centered text doesn't shift as it types
  function prepareLine() {
    says.textContent = "";
    const label = document.createElement("span");
    label.className = "sr-only";
    label.textContent = LINE;
    says.appendChild(label);
    return [...LINE].map((c, i) => {
      const span = document.createElement("span");
      span.className = CUTS[i] ? `ch say-cut say-cut-${CUTS[i]}` : "ch";
      span.setAttribute("aria-hidden", "true");
      span.textContent = BREAKS[i] ? "\n" : c;
      says.appendChild(span);
      return span;
    });
  }

  function typeLine() {
    const chars = prepareLine();
    talking = true;
    let i = 0;
    const timer = setInterval(() => {
      chars[i].classList.add("is-typed");
      i += 1;
      if (i >= chars.length) {
        clearInterval(timer);
        talking = false; // current jump plays out, then back to idling
      }
    }, TYPE_MS);
  }

  function show(i) {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    sprite.style.backgroundPosition = `${(col / (COLS - 1)) * 100}% ${(row / (ROWS - 1)) * 100}%`;
  }

  function tick(now) {
    if (now - last >= FRAME_MS) {
      last = now;
      // while talking, hold the "facing you" stretch of the jump (frames 9-20) by ping-ponging through it,
      // so it reads as one long jump; once the line is typed it lands (21-27) and goes back to idling
      if (jumping && talking && frame >= HOLD_END) dir = -1;
      if (jumping && dir === -1 && frame <= HOLD_START) dir = 1;
      if (!talking) dir = 1;
      frame += dir;
      if (jumping && frame === IDLE_START) jumping = false; // jump finished, back to idling
      if (!jumping && frame > IDLE_END) frame = IDLE_START;
      show(frame);
    }
    requestAnimationFrame(tick);
  }

  kirby.addEventListener("click", () => {
    if (jumping) return;
    jumping = true;
    frame = 0;
    last = performance.now();
    show(frame);
    if (says && !said) {
      said = true;
      typeLine();
    }
  });

  show(frame);
  requestAnimationFrame(tick);
})();
