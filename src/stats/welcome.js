// welcome page, shown once on the first visit (start.js decides when)

// ── welcome page (first visit) ──
const WELCOME_KEY = "stats.welcomed";

// the Claude Code mascot in pixels: 18 × 5, each pixel twice as tall as wide (like terminal blocks)
(function drawClawd() {
  const body = [
    "...############...",
    "...##.######.##...", // the gaps are the eyes
    ".################.",
    "...############...",
  ];
  const legsA = "....#.#....#.#....";
  const legsB = "...#.#......#.#...";
  const ns = "http://www.w3.org/2000/svg";
  const g = (cls) => {
    const el = document.createElementNS(ns, "g");
    if (cls) el.setAttribute("class", cls);
    $("clawd").append(el);
    return el;
  };
  const px = (group, x, y) => {
    const r = document.createElementNS(ns, "rect");
    r.setAttribute("x", x);
    r.setAttribute("y", y * 2);
    r.setAttribute("width", 1);
    r.setAttribute("height", 2);
    group.append(r);
  };
  const row = (group, line, y) => [...line].forEach((c, x) => c === "#" && px(group, x, y));
  const b = g();
  body.forEach((line, y) => row(b, line, y));
  row(g("legs-a"), legsA, 4);
  row(g("legs-b"), legsB, 4);
  const lids = g("lids"); // fill the eyes for a blink
  px(lids, 5, 1);
  px(lids, 12, 1);
})();

// iOS / Android is picked for them from the device (they can change it); the browser is always typed
function guessOs() {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "iOS";
  return /Android/.test(ua) ? "Android" : "";
}
let welcomeOs = "";
// the search icon stays dim until both blanks are filled
function updateWelcome() {
  for (const b of document.querySelectorAll("[data-os]")) b.classList.toggle("on", b.dataset.os === welcomeOs);
  $("wSearch").classList.toggle("ready", !!(welcomeOs && $("wBrowser").value.trim()));
}
$("wBrowser").addEventListener("input", updateWelcome);
$("wBrowser").addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  $("wBrowser").blur();
  $("wSearch").click();
});
for (const b of document.querySelectorAll("[data-os]")) {
  b.onclick = () => {
    welcomeOs = b.dataset.os;
    updateWelcome();
  };
}
// search: "how to add a web page to the home screen in <browser> on <os>". a blank missing → nothing (or the field)
$("wSearch").onclick = () => {
  const browser = $("wBrowser").value.trim();
  if (!browser) return $("wBrowser").focus();
  if (!welcomeOs) return;
  const q = `how to add a web page to the home screen in ${browser} on ${welcomeOs}`;
  window.open(`https://www.google.com/search?q=${encodeURIComponent(q)}`, "_blank", "noopener");
};
// the thumbs up is the only way on, and it's only shown once
$("welcomeDone").onclick = () => {
  try {
    localStorage.setItem(WELCOME_KEY, "1");
  } catch {}
  $("welcomeDialog").close();
  updateBar(); // off-white again for the ? / import screen
};
$("welcomeDialog").addEventListener("cancel", (e) => e.preventDefault());
