// startup: runs last, once everything else is loaded

// ask the browser not to evict our data
if (navigator.storage && navigator.storage.persist) navigator.storage.persist();

// offline support + auto-updates (see sw.js). updateViaCache "none": the browser always checks sw.js itself
// with the server, never a cached copy
if ("serviceWorker" in navigator) {
  const sw = navigator.serviceWorker;
  sw.register("sw.js", { updateViaCache: "none" })
    .then((reg) => {
      // back from the background (an installed app is often resumed, not reopened): look for a new version
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState !== "visible") return;
        reg.update().catch(() => {});
        if (sw.controller) sw.controller.postMessage("check");
      });
    })
    .catch(() => {});
  // reload onto the new version, unless you're typing something (then it waits for the next time)
  let reloading = false;
  const reloadOntoUpdate = () => {
    if (reloading || document.activeElement?.matches("input, textarea")) return;
    reloading = true;
    location.reload();
  };
  sw.addEventListener("message", (e) => {
    if (e.data === "updated") reloadOntoUpdate();
  });
  // sw.js itself changed and the new one took over: reload too (not on the very first install)
  const hadController = !!sw.controller;
  sw.addEventListener("controllerchange", () => {
    if (hadController) reloadOntoUpdate();
  });
}

if (isNew()) {
  $("star").hidden = true;
  $("intro").hidden = false;
}
render();

// first visit: the welcome page comes first, then the ? / import screen behind it
let welcomed = true;
try {
  welcomed = !!localStorage.getItem(WELCOME_KEY);
} catch {}
if (isNew() && !welcomed) {
  show($("welcomeDialog"));
  updateBar(); // dark status bar while the (dark) welcome page is up
} else if (isNew()) {
  playIntro(); // "#1 time?" types itself out (after the welcome, it's welcome.js that starts it)
}
