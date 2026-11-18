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

// "powered by Claude Code" types out: every letter becomes its own span, each shown a little after the last
// (starts once the little guy has walked in). keeps the <b> around "Claude Code" for its colour
(function typeOut() {
  const START = 1.7; // s
  const EACH = 0.05; // s per letter
  let i = 0;
  const wrap = (node) => {
    for (const n of [...node.childNodes]) {
      if (n.nodeType !== Node.TEXT_NODE) {
        wrap(n);
        continue;
      }
      const letters = document.createDocumentFragment();
      for (const ch of n.textContent) {
        const s = document.createElement("span");
        s.textContent = ch;
        s.style.animationDelay = `${(START + i++ * EACH).toFixed(2)}s`;
        letters.append(s);
      }
      n.replaceWith(letters);
    }
  };
  wrap(document.querySelector(".pb-text"));
})();

// "how & why?" → the how & why page, over the welcome page (back / Esc returns to the welcome page)
$("howBtn").onclick = () => {
  show($("howDialog"));
  $("howDialog").scrollTop = 0;
};
// the thumbs up at the bottom of how & why is the way on, and the welcome is only shown once
$("howDone").onclick = () => {
  try {
    localStorage.setItem(WELCOME_KEY, "1");
  } catch {}
  $("howDialog").close();
  $("welcomeDialog").close();
  updateBar(); // off-white again for the ? / import screen
};
$("welcomeDialog").addEventListener("cancel", (e) => e.preventDefault());

// how & why: tap a guide's heading to open / close it; opening one closes the other in the same group
for (const head of document.querySelectorAll("#howDialog .acc-head")) {
  head.setAttribute("aria-expanded", "false");
  head.onclick = () => {
    const item = head.parentElement;
    const open = !item.classList.contains("open");
    for (const other of item.parentElement.children) {
      other.classList.remove("open");
      other.querySelector(".acc-head").setAttribute("aria-expanded", "false");
    }
    item.classList.toggle("open", open);
    head.setAttribute("aria-expanded", open);
  };
}
