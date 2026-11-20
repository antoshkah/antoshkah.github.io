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
