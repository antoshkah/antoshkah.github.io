// the animated walkthrough at the top of the how-to page (runDemo is started by show() in app.js)

// the walkthrough loops while the guide is open; closing it (or reopening) stops the old loop
let demoRun = 0;
async function runDemo() {
  const run = ++demoRun;
  const wait = (ms) =>
    new Promise((ok, stop) => setTimeout(() => (run === demoRun && $("helpDialog").open ? ok() : stop()), ms));
  const demo = $("demo");
  const finger = $("dFinger");
  const moveTo = async (el) => {
    const a = demo.getBoundingClientRect();
    const b = el.getBoundingClientRect();
    const appear = !finger.classList.contains("on");
    finger.style.transition = appear ? "none" : "";
    finger.style.transform = `translate(${b.left - a.left + b.width / 2}px, ${b.top - a.top + b.height / 2}px)`;
    if (appear) {
      await wait(30);
      finger.style.transition = "";
      finger.classList.add("on");
      await wait(300);
    } else {
      await wait(550);
    }
  };
  // move to an empty point, given as a fraction of the demo's width / height
  const moveToSpot = async (fx, fy) => {
    const a = demo.getBoundingClientRect();
    finger.style.transform = `translate(${a.width * fx}px, ${a.height * fy}px)`;
    await wait(550);
  };
  const tap = async () => {
    finger.classList.add("press");
    await wait(130);
    finger.classList.remove("press");
    await wait(120);
  };
  const bump = (el) => {
    el.classList.remove("bump");
    void el.offsetWidth; // restart the animation
    el.classList.add("bump");
  };
  const set = (id, n) => { $(id).textContent = n; bump($(id)); };
  const poof = (el) => {
    const a = demo.getBoundingClientRect();
    const b = el.getBoundingClientRect();
    const cx = b.left - a.left + b.width / 2;
    const cy = b.top - a.top + b.height / 2;
    el.classList.add("poof");
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const s = document.createElement("span");
      s.className = "d-line";
      s.style.left = `${cx + Math.cos(angle) * 18}px`;
      s.style.top = `${cy + Math.sin(angle) * 12}px`;
      s.style.setProperty("--a", `${angle + Math.PI / 2}rad`); // point outward
      s.style.setProperty("--dx", `${Math.cos(angle) * 11}px`);
      s.style.setProperty("--dy", `${Math.sin(angle) * 11}px`);
      demo.append(s);
      setTimeout(() => s.remove(), 500);
    }
  };
  // the demo timer: ticks one second at a time while running
  let tSecs = 0;
  let tRunning = false;
  const ticker = setInterval(() => {
    if (run !== demoRun || !$("helpDialog").open) return clearInterval(ticker);
    if (!tRunning) return;
    tSecs++;
    showTime(`${tSecs}s`);
  }, 1000);
  const swell = async (id, zero) => {
    const el = $(id);
    el.classList.remove("swell", "bump");
    void el.offsetWidth;
    el.classList.add("swell");
    await wait(230); // at its biggest
    tSecs = 0;
    el.textContent = zero;
    $("dCount").textContent = zero;
    await wait(300);
    el.classList.remove("swell");
  };
  // shared steps: open the name field, type, then tap # or the clock
  // the demo stat is named after its kind: "counted" or "timed" (typed in, then shown on its row and page)
  let statName = "";
  const addStat = async (kindEl, name) => {
    statName = name;
    $("dName").textContent = name;
    $("dPopName").textContent = name;
    await moveTo($("dStar"));
    await tap();
    $("dStar").hidden = true;
    $("dTyped").textContent = "";
    $("dBox").hidden = false;
    finger.classList.remove("on");
    await wait(300);
    for (const ch of name) {
      $("dTyped").textContent += ch;
      await wait(110);
    }
    await wait(350);
    await moveTo(kindEl);
    await tap();
    $("dBox").hidden = true;
    $("dStar").hidden = false;
    $("dRow").hidden = false;
  };
  const hold = async () => {
    await moveTo($("dName"));
    finger.classList.add("hold");
    await wait(750);
    finger.classList.remove("hold");
    $("dPop").classList.add("on");
    await wait(700);
  };
  const resetAndDelete = async (zero) => {
    // reset → yes: the value swells and lands on zero
    $("dAsk").textContent = `reset "${statName}"?`;
    await moveTo($("dReset"));
    await tap();
    $("dZero").classList.add("on");
    await wait(500);
    await moveTo($("dYes"));
    await tap();
    $("dZero").classList.remove("on");
    await wait(150);
    await swell("dBig", zero);
    await wait(800);
    // delete → yes: both pages close together (like the real app), back on the list
    // the stat vanishes in a burst of small straight sparks
    $("dAsk").textContent = `delete "${statName}"?`;
    await moveTo($("dTrash"));
    await tap();
    $("dZero").classList.add("on");
    await wait(500);
    await moveTo($("dYes"));
    await tap();
    tRunning = false;
    finger.classList.remove("on");
    $("dZero").classList.remove("on");
    $("dPop").classList.remove("on");
    await wait(220); // the pages fade away
    poof($("dRow"));
    await wait(700);
    $("dRow").hidden = true;
    $("dRow").classList.remove("poof");
  };
  // switch the mock between a counted and a timed stat
  const asTimer = (on) => {
    $("dCount").classList.toggle("timer", on);
    $("dBig").classList.toggle("timer", on);
    $("dMinus").hidden = on;
    for (const id of ["dCount", "dBig"]) $(id).classList.remove("paused");
  };
  const showTime = (t) => {
    $("dCount").textContent = t;
    $("dBig").textContent = t;
  };

  try {
    while (true) {
      // fresh scene
      demo.classList.remove("fade");
      $("dRow").hidden = true;
      $("dRow").classList.remove("poof");
      $("dBig").classList.remove("swell");
      $("dBox").hidden = true;
      $("dStar").hidden = false;
      $("dTyped").textContent = "";
      $("dCount").textContent = 0;
      $("dPop").classList.remove("on");
      $("dZero").classList.remove("on");
      finger.classList.remove("on", "press", "hold");
      tRunning = false;
      asTimer(false);
      await wait(700);

      // ── counted stat ──
      await addStat($("dKStar"), "counted");
      await wait(600);

      // tap the number a few times
      await moveTo($("dCount"));
      for (let n = 1; n <= 3; n++) {
        await tap();
        set("dCount", n);
        await wait(180);
      }
      await wait(400);

      // hold to open, − takes one away
      $("dBig").textContent = 3;
      await hold();
      await moveTo($("dMinus"));
      await tap();
      set("dBig", 2);
      $("dCount").textContent = 2;
      await wait(700);

      await resetAndDelete(0);
      await wait(900);

      // ── timed stat ──
      asTimer(true);
      tSecs = 0;
      showTime("0s");
      await addStat($("dKClock"), "timed");
      tRunning = true; // starts counting the moment the clock is tapped
      finger.classList.remove("on");
      await wait(2600);

      // hold to open: still ticking. tap the time: it stops and greys out. tap again: ticks on
      await hold();
      await wait(900);
      await moveTo($("dBig"));
      await tap();
      tRunning = false;
      $("dCount").classList.add("paused");
      $("dBig").classList.add("paused");
      await wait(2200);
      await tap();
      tRunning = true;
      $("dCount").classList.remove("paused");
      $("dBig").classList.remove("paused");
      await wait(2100);

      // tap any empty space on the stat page to go back; it keeps ticking in the list
      await moveToSpot(0.22, 0.2);
      await tap();
      $("dPop").classList.remove("on");
      await wait(500);
      finger.classList.remove("on");
      await wait(1300);

      demo.classList.add("fade");
      await wait(500);
    }
  } catch {
    // stopped: the guide was closed or reopened
  }
}
