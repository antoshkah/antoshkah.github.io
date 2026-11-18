// startup: runs last, once everything else is loaded

// ask the browser not to evict our data
if (navigator.storage && navigator.storage.persist) navigator.storage.persist();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
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
  welcomeOs = guessOs();
  updateWelcome();
  show($("welcomeDialog"));
  updateBar(); // dark status bar while the (dark) welcome page is up
}
