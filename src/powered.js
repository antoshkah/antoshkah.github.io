// "powered by Claude Code": types out one letter at a time, with the little Claude Code guy as the cursor just after
// the last letter, so the letters come out of him. once it's all typed he walks on a little, swells and implodes.
// (same animation as the stats app's first-visit guide, src/stats/welcome.js)
(function () {
  const guy = document.getElementById("clawd");
  const textEl = document.querySelector(".pb-text");
  if (!guy || !textEl) return;

  // the mascot in pixels: 18 × 5, each pixel twice as tall as wide (like terminal blocks)
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
    guy.append(el);
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

  // every letter becomes its own span (keeps the <b> around "Claude Code" for its colour)
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
  wrap(textEl);

  function play() {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return; // the CSS shows the whole line
    const START = 600; // ms before the first letter (he shows up first)
    const EACH = 70; // ms per letter
    // his left edge on the right edge of letter i; -1 = where the first letter will be
    const place = (i) => {
      const s = letters[Math.max(i, 0)];
      guy.style.left = `${i < 0 ? s.offsetLeft : s.offsetLeft + s.offsetWidth}px`;
    };
    setTimeout(() => {
      guy.style.transition = "none"; // appear in place, don't slide in
      place(-1);
      void guy.getBoundingClientRect();
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
    setTimeout(() => (guy.style.left = `${parseFloat(guy.style.left) + 6}px`), end);
    setTimeout(() => {
      guy.classList.remove("typing");
      guy.classList.add("gone");
    }, end + EACH);
  }

  // wait for the font, so the letters are measured where they'll end up
  (document.fonts ? document.fonts.ready : Promise.resolve()).then(play);
})();
