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

// "powered by Claude Code" types out, one letter at a time, with the little guy as the cursor just after
// the last letter, so the letters come out of him. once it's all typed he walks on a little past the text, swells a touch and implodes.
// every letter becomes its own span (keeps the <b> around "Claude Code" for its colour)
(function typeOut() {
  const START = 600; // ms before the first letter (he shows up first)
  const EACH = 70; // ms per letter
  const text = document.querySelector(".pb-text");
  const guy = $("clawd");
  const letters = [];
  const wrap = (node) => {
    for (const n of [...node.childNodes]) {
      if (n === guy) continue;
      if (n.nodeType !== Node.TEXT_NODE) {
        wrap(n);
        continue;
      }
      const frag = document.createDocumentFragment();
      for (const ch of n.textContent) {
        const s = document.createElement("span");
        s.textContent = ch;
        letters.push(s);
        frag.append(s);
      }
      n.replaceWith(frag);
    }
  };
  wrap(text);
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return; // the CSS shows the whole line

  // his left edge on the right edge of letter i: the letters come out of him and stay behind.
  // -1 = where the first letter will be, before any are out (measured from the letters' boxes,
  // the same way every time, so there's no jump between where he starts and where the text starts)
  const place = (i) => {
    const s = letters[Math.max(i, 0)];
    guy.style.left = `${i < 0 ? s.offsetLeft : s.offsetLeft + s.offsetWidth}px`;
  };

  setTimeout(() => {
    guy.style.transition = "none"; // appear in place, don't slide in
    place(-1);
    void guy.offsetWidth;
    guy.style.transition = "";
    guy.classList.add("on", "typing");
  }, START - 300);
  letters.forEach((s, i) =>
    setTimeout(() => {
      s.classList.add("on");
      place(i);
    }, START + i * EACH)
  );
  const end = START + letters.length * EACH;
  // after the last letter he keeps walking, at the same pace, a little past the text,
  // and as soon as he gets there he swells a touch and implodes
  const STEP_AWAY = 6; // px
  setTimeout(() => {
    guy.style.left = `${parseFloat(guy.style.left) + STEP_AWAY}px`; // (an <svg> has no offsetLeft)
  }, end);
  setTimeout(() => {
    guy.classList.remove("typing");
    guy.classList.add("gone");
  }, end + EACH);
})();

// "how?" → everything on the welcome page fades away (the how? button last), then the links come in its place
$("howBtn").onclick = () => {
  const welcome = document.querySelector(".welcome");
  welcome.classList.add("leaving");
  setTimeout(() => {
    welcome.hidden = true;
    $("welcomeHow").hidden = false; // the links come down one by one (CSS), then the thumbs up
  }, 800); // 0.4s fade, the button's starting 0.35s later
};
// "On my phone" under the links is the way on, and the welcome is only shown once
$("howDone").onclick = () => {
  try {
    localStorage.setItem(WELCOME_KEY, "1");
  } catch {}
  $("welcomeDialog").close();
  updateBar(); // off-white again for the ? / import screen
  playIntro(); // and "#1 time?" types itself out on it
};
$("welcomeDialog").addEventListener("cancel", (e) => e.preventDefault());
