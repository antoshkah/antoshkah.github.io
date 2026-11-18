// stats: the core app. stats + timers, the list, adding a stat, the stat page, yes / no page,
// export / import. loads first; demo.js, settings.js, welcome.js and start.js build on it.

const KEY = "stats.v1";
const OLD_KEY = "tally.v1"; // data saved before the rename
const SEEN_KEY = "stats.seen";
const $ = (id) => document.getElementById(id);

// counted stat: { id, name, kind: "counter", created, count, highest, deleted?, log }
// timed stat:   { id, name, kind: "timer", created, elapsed, since, highest, deleted?, log }
//   elapsed = ms banked from earlier runs, since = when the current run started (null = paused),
//   highest = longest it has run, in ms
// the log only holds resets and deletes; deleted stats are kept (hidden) so their history survives in backups
let stats = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY) ?? localStorage.getItem(OLD_KEY);
    const data = JSON.parse(raw) || [];
    return Array.isArray(data) ? data.map(normalize) : [];
  } catch {
    return [];
  }
}

// accepts any saved/imported shape, including older versions that logged every tap
function normalize(s) {
  const timer = s.kind === "timer";
  const all = (Array.isArray(s.log) ? s.log : [])
    .map((e, i) =>
      typeof e === "number"
        ? { action: "add", time: new Date(e).toISOString(), count: i + 1 }
        : e && typeof e === "object" && e.action
          ? timer
            ? { action: String(e.action), time: String(e.time || ""), elapsed: Number(e.elapsed) || 0 }
            : { action: String(e.action), time: String(e.time || ""), count: Number(e.count) || 0 }
          : null
    )
    .filter(Boolean);
  const created = s.created ? String(s.created) : (all[0] && all[0].time) || new Date().toISOString();
  const log = all.filter((e) => e.action === "reset" || e.action === "delete");
  const stat = { id: s.id || String(Math.random()), name: String(s.name || "untitled"), kind: timer ? "timer" : "counter", created };
  if (timer) {
    stat.elapsed = Math.max(0, Number(s.elapsed) || 0);
    stat.since = s.since && !isNaN(Date.parse(s.since)) ? String(s.since) : null;
    stat.highest = Math.max(Number(s.highest) || 0, stat.elapsed);
  } else {
    stat.count = Math.max(0, Number(s.count) || 0);
    // older files: work out highest from the full tap history before dropping it
    stat.highest = Math.max(Number(s.highest) || 0, stat.count, ...all.map((e) => e.count || 0));
  }
  if (s.deleted) stat.deleted = String(s.deleted);
  stat.log = log;
  return stat;
}

// a timed stat's running total in ms (banked time + the current run)
const timeOf = (s) => s.elapsed + (s.since ? Math.max(0, Date.now() - Date.parse(s.since)) : 0);

// 45s · 12m 5s · 1h 30m · 3d 6h · 1y 12d — always rounded down, never "2d 30h" or "1h 75m"
function fmtTime(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(s / 86400);
  if (d < 365) return `${d}d ${Math.floor((s % 86400) / 3600)}h`;
  return `${Math.floor(d / 365)}y ${d % 365}d`;
}

// what a stat shows: the count, or the formatted time
const valueOf = (s) => (s.kind === "timer" ? fmtTime(timeOf(s)) : s.count);

const visible = () => stats.filter((s) => !s.deleted);

// every change goes through here so the log, count and highest stay in step
function record(stat, action) {
  if (stat.kind === "timer") {
    const time = new Date().toISOString();
    const total = timeOf(stat);
    stat.highest = Math.max(stat.highest, total);
    if (action === "pause") {
      stat.elapsed = total;
      stat.since = null;
    } else if (action === "resume") {
      stat.since = time;
    } else if (action === "reset") {
      stat.elapsed = 0;
      if (stat.since) stat.since = time; // keeps running from zero if it was running
    } else if (action === "delete") {
      stat.elapsed = total;
      stat.since = null;
      stat.deleted = time;
    }
    // pausing / resuming isn't logged, only resets and deletes
    if (action === "reset" || action === "delete") stat.log.push({ action, time, elapsed: stat.elapsed });
    save();
    return;
  }
  if (action === "add") stat.count++;
  else if (action === "subtract") stat.count--;
  else if (action === "reset") stat.count = 0;
  const time = new Date().toISOString();
  if (action === "delete") stat.deleted = time;
  stat.highest = Math.max(stat.highest, stat.count);
  // taps (add / subtract) only change the number; resets and deletes are logged
  if (action === "reset" || action === "delete") stat.log.push({ action, time, count: stat.count });
  save();
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(stats));
  } catch {}
}

// first-timers see an i instead of the star until they've read the guide or imported
function isNew() {
  try {
    return !localStorage.getItem(SEEN_KEY) && visible().length === 0;
  } catch {
    return false;
  }
}
function markSeen() {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {}
  $("intro").hidden = true;
  $("star").hidden = false;
  document.documentElement.classList.remove("fresh"); // off-white → dark
  updateBar();
}

// calls onLong after holding for the hold time in settings (0.5s by default); swallows the click that follows
function onLongPress(el, onLong) {
  let timer = null;
  let fired = false;
  el.addEventListener("pointerdown", () => {
    fired = false;
    timer = setTimeout(() => {
      fired = true;
      if (navigator.vibrate) navigator.vibrate(20);
      onLong();
    }, settings.hold);
  });
  for (const ev of ["pointerup", "pointerleave", "pointercancel"]) {
    el.addEventListener(ev, () => clearTimeout(timer));
  }
  el.addEventListener("contextmenu", (e) => e.preventDefault());
  el.addEventListener("click", (e) => {
    if (fired) {
      e.stopImmediatePropagation();
      fired = false;
    }
  }, true);
}

// two taps closer together than this count as a double tap
const DOUBLE_TAP_MS = 300;

// a timed row in the list, anywhere on it. two settings decide what does what:
//   timerOpen:  "hold" | "double"  → opens the stat page
//   timerPause: "off" | "tap" | "double"  → pauses / resumes ("off": only on the stat page)
// never both "double". when opening is a double tap, a single tap has to wait
// DOUBLE_TAP_MS to be sure it isn't the start of one, then pauses.
function timerGesture(el, stat) {
  let holdTimer = null, tapTimer = null, taps = 0, down = false, opened = false;
  const open = () => {
    opened = true;
    clearTimeout(tapTimer);
    taps = 0;
    if (navigator.vibrate) navigator.vibrate(20);
    openEdit(stat);
  };
  el.addEventListener("pointerdown", () => {
    down = true;
    opened = false;
    if (settings.timerOpen === "hold") holdTimer = setTimeout(open, settings.hold);
  });
  el.addEventListener("pointerup", () => {
    if (!down) return;
    down = false;
    clearTimeout(holdTimer);
    if (opened) return;
    const double = settings.timerOpen === "double" ? "open" : settings.timerPause === "double" ? "pause" : null;
    if (!double) {
      if (settings.timerPause === "tap") toggleTimer(stat); // plain tap, nothing to wait for
      return;
    }
    taps++;
    if (taps === 2) {
      clearTimeout(tapTimer);
      taps = 0;
      return double === "open" ? open() : toggleTimer(stat);
    }
    tapTimer = setTimeout(() => {
      taps = 0;
      if (settings.timerPause === "tap") toggleTimer(stat); // it was just the one tap
    }, DOUBLE_TAP_MS);
  });
  for (const ev of ["pointerleave", "pointercancel"]) {
    el.addEventListener(ev, () => {
      down = false;
      clearTimeout(holdTimer);
    });
  }
  el.addEventListener("contextmenu", (e) => e.preventDefault());
  // the click that follows opening the stat page shouldn't land on it
  el.addEventListener("click", (e) => {
    if (opened) {
      e.stopImmediatePropagation();
      opened = false;
    }
  }, true);
}

function show(dialog) {
  dialog.showModal();
  document.activeElement.blur(); // no focus ring on the first button
  if (dialog.id === "helpDialog") runDemo();
}

// stats from a file being looked at (read-only); null = showing your own
let viewing = null;

// running timers tick on screen (the list and the open popup)
let timerEls = [];
setInterval(() => {
  for (const [el, stat] of timerEls) if (stat.since) el.textContent = valueOf(stat);
  if (editing && editing.kind === "timer" && editing.since) $("editCount").textContent = valueOf(editing);
}, 500);

function render() {
  const list = $("list");
  list.innerHTML = "";
  const shown = viewing ? viewing.filter((s) => !s.deleted) : visible();
  document.documentElement.classList.toggle("empty", shown.length === 0);
  document.body.classList.toggle("viewing", !!viewing);
  $("viewLabel").hidden = !viewing;
  $("viewBack").hidden = !viewing;
  if (viewing) {
    $("star").hidden = true;
    $("intro").hidden = true;
  }
  // the off-white first-visit page pauses while viewing someone's file
  document.documentElement.classList.toggle("fresh", !viewing && isNew());
  updateBar();

  timerEls = [];
  for (const stat of shown) {
    const row = document.createElement("div");
    row.className = "row";
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = stat.name;
    const timer = stat.kind === "timer";
    const count = document.createElement(viewing || timer ? "span" : "button");
    count.className = "count";
    count.textContent = valueOf(stat);
    if (timer) {
      count.classList.add("timer");
      count.classList.toggle("paused", !stat.since);
      timerEls.push([count, stat]);
    }
    row.append(name, count);
    list.append(row);
    if (viewing) continue; // look, don't touch
    if (timer) {
      // anywhere on the row: pause / resume, or open the stat page (see timerGesture)
      row.classList.add("tappable");
      timerGesture(row, stat);
      continue;
    }
    count.setAttribute("aria-label", `Add one to ${stat.name}`);

    // tap the number: +1
    count.addEventListener("click", () => {
      record(stat, "add");
      count.textContent = stat.count;
      if (navigator.vibrate) navigator.vibrate(10);
    });
    // hold anywhere on the row: popup with −, reset and delete
    onLongPress(row, () => openEdit(stat));
  }
}

$("viewBack").onclick = () => {
  viewing = null;
  const first = isNew();
  $("star").hidden = first;
  $("intro").hidden = !first;
  render();
};

// first visit
$("introHelp").onclick = () => show($("helpDialog"));
$("introImport").onclick = () => $("importFile").click();

// star opens the name field (just a cursor); holding it opens the menu
$("star").addEventListener("click", () => {
  $("star").hidden = true;
  $("composer").hidden = false;
  $("newbox").focus();
});
onLongPress($("star"), () => show($("menuDialog")));

function closeNew() {
  $("newbox").value = "";
  $("composer").hidden = true;
  $("star").hidden = false;
}
// # = counted stat, clock = timed stat (starts counting now)
function create(kind) {
  const name = $("newbox").value.trim();
  if (!name) {
    $("newbox").focus();
    return;
  }
  const now = new Date().toISOString();
  const base = { id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()), name, kind, created: now };
  stats.push(
    kind === "timer"
      ? { ...base, elapsed: 0, since: now, highest: 0, log: [] }
      : { ...base, count: 0, highest: 0, log: [] }
  );
  save();
  render();
  closeNew();
}
$("makeCounter").onclick = () => create("counter");
$("makeTimer").onclick = () => create("timer");
// tapping # / clock shouldn't steal focus (keeps the keyboard up on phones)
for (const b of [$("makeCounter"), $("makeTimer")]) b.addEventListener("pointerdown", (e) => e.preventDefault());
$("newbox").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("newbox").blur(); // just closes the keyboard; pick # or clock next
  if (e.key === "Escape") closeNew();
});
// tapping anywhere else cancels
document.addEventListener("pointerdown", (e) => {
  if (!$("composer").hidden && !$("composer").contains(e.target)) closeNew();
});

// popup for one stat. counted: tap the number to add, − to subtract. timed: pause / play
let editing = null;
function showEditValue() {
  const timer = editing.kind === "timer";
  $("editCount").textContent = valueOf(editing);
  $("editCount").classList.toggle("timer", timer);
  $("editCount").classList.toggle("paused", timer && !editing.since);
  $("editCount").setAttribute("aria-label", timer ? (editing.since ? "Pause" : "Resume") : "Add one");
  $("minusBtn").hidden = timer;
}
function openEdit(stat) {
  editing = stat;
  $("editName").textContent = stat.name;
  showEditValue();
  show($("editDialog"));
}
// timed: pause / resume (not logged, only resets and deletes are)
function toggleTimer(stat) {
  if (!stat || stat.kind !== "timer") return;
  record(stat, stat.since ? "pause" : "resume");
  render();
  if (editing === stat) showEditValue();
  if (navigator.vibrate) navigator.vibrate(10);
}
function change(delta) {
  if (!editing || editing.kind === "timer") return;
  if (delta > 0) record(editing, "add");
  else if (editing.count > 0) record(editing, "subtract");
  else return;
  render(); // keep the list behind the popup in sync
  $("editCount").textContent = editing.count;
  if (navigator.vibrate) navigator.vibrate(10);
}
// counted: tap adds. timed: tap or double tap (the pause setting) pauses / resumes
let lastTimeTap = 0;
$("editCount").onclick = () => {
  if (!editing) return;
  if (editing.kind !== "timer") return change(1);
  // "off" only turns off tapping in the list; here a tap still pauses
  if (settings.timerPause !== "double") return toggleTimer(editing);
  const now = Date.now();
  if (now - lastTimeTap < DOUBLE_TAP_MS) {
    lastTimeTap = 0;
    toggleTimer(editing);
  } else {
    lastTimeTap = now;
  }
};
$("minusBtn").onclick = () => change(-1);

// the yes / no page (reset, delete, replacing stats on import). no onYes = just a message with a back button
let onYes = null;
function ask(text, yes = null) {
  onYes = yes;
  $("confirmText").textContent = text;
  $("yesBtn").hidden = !yes;
  $("noIcon").setAttribute("href", yes ? "#i-down" : "#i-exit");
  show($("zeroDialog"));
}
$("noBtn").onclick = () => $("zeroDialog").close();
$("yesBtn").onclick = () => {
  const yes = onYes;
  $("zeroDialog").close();
  if (yes) yes();
};
$("resetBtn").onclick = () => {
  const stat = editing;
  if (!stat) return;
  ask(`reset "${stat.name}"?`, () => {
    record(stat, "reset");
    render();
    if (editing === stat) showEditValue();
  });
};
$("deleteBtn").onclick = () => {
  const stat = editing;
  if (!stat) return;
  ask(`delete "${stat.name}"?`, () => {
    record(stat, "delete");
    render();
    $("editDialog").close();
  });
};
// full screen, so "outside" is any empty space: anything that isn't a button goes back
$("editDialog").addEventListener("click", (e) => {
  if (!e.target.closest("button")) $("editDialog").close();
});
$("editDialog").onclose = () => {
  editing = null;
  render();
};

// tapping outside a dialog closes it
for (const d of document.querySelectorAll("dialog")) {
  d.addEventListener("click", (e) => {
    if (e.target !== d) return;
    const r = d.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!inside) d.close();
  });
}

// how to use
$("helpBtn").onclick = () => {
  $("menuDialog").close();
  show($("helpDialog"));
  $("helpDialog").scrollTop = 0;
};
$("helpDone").onclick = () => $("helpDialog").close();
$("helpDialog").addEventListener("close", markSeen);

// export: just export, or export & clear (asks yes / no first)
$("exportBtn").onclick = () => {
  $("menuDialog").close();
  $("exportChoices").hidden = false;
  $("exportConfirm").hidden = true;
  show($("exportDialog"));
};
// cancel / no step back to the menu instead of closing everything
const backToMenu = () => {
  $("exportDialog").close();
  show($("menuDialog"));
};
$("exportCancel").onclick = backToMenu;
$("exportNo").onclick = backToMenu;
$("exportClear").onclick = () => {
  $("exportChoices").hidden = true;
  $("exportConfirm").hidden = false;
  document.activeElement.blur();
};
$("exportOnly").onclick = () => {
  $("exportDialog").close();
  exportBackup();
};
$("exportView").onclick = () => {
  $("exportDialog").close();
  exportBackup(true);
};

// tamper seal: a fingerprint of the file's contents mixed with a key only this app knows.
// edit anything in the file and the seal stops matching, so it can only be viewed.
// (it's a deterrent, not real security: the key is in this public source code.)
const SEAL_KEY = "stats·k7Qx!m2Lp9#vR4tZ·seal"; // cheeky lol
function cyrb53(str, seed) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
}
function sealOf(file) {
  const body = SEAL_KEY + JSON.stringify([file.readOnly === true, file.exported, file.stats]);
  return cyrb53(body, 1) + cyrb53(body, 2);
}
$("exportYes").onclick = async () => {
  $("exportDialog").close();
  // only wipe once the file is actually out (not if the share sheet was cancelled)
  if (!(await exportBackup())) return;
  try {
    for (const k of [KEY, OLD_KEY, SEEN_KEY, SETTINGS_KEY, OLD_SETTINGS_KEY, "stats.welcomed"]) localStorage.removeItem(k);
  } catch {}
  setTimeout(() => location.reload(), 1000); // back to a fresh first-visit state, after the download has started
};

// returns true once the file has been shared or downloaded
async function exportBackup(readOnly = false) {
  // JSON has no comments, so the explanation lives in a "_readme" field (ignored on import)
  const backup = {
    _readme: {
      about: readOnly
        ? "Read-only copy from the stats app. Importing it only lets you look at these stats."
        : "Backup from the stats app. Import it from the menu (hold the star) to restore.",
      seal: "Fingerprint of this file. If anything below is edited, the app will only open it as read-only.",
      readOnly: "true = this file can only be viewed, never loaded as your own stats.",
      exported: "When this file was made.",
      stats: "Every stat, including deleted ones (kept so their history isn't lost).",
      id: "Unique id for the stat.",
      name: "What you're counting.",
      kind: "counter = tap to count, timer = counts time on its own.",
      created: "When the stat was made (UTC).",
      count: "Counters only: the current number.",
      elapsed: "Timers only: milliseconds counted in earlier runs (the current run is on top of this).",
      since: "Timers only: when the current run started (UTC), or null if paused.",
      highest: "Counters: the highest the count has been. Timers: the longest it has run, in milliseconds.",
      deleted: "Only on deleted stats: when it was deleted. Deleted stats stay hidden in the app.",
      log: "Resets and deletes, oldest first. action = reset | delete, time = when it happened (UTC), count (counters) or elapsed (timers) = the value right after.",
    },
    seal: "",
    readOnly,
    exported: new Date().toISOString(),
    stats,
  };
  // round-trip so the seal is computed on exactly what the importer will read back
  backup.seal = sealOf(JSON.parse(JSON.stringify(backup)));
  const json = JSON.stringify(backup, null, 2);
  // local date and time, e.g. stats-2026-11-18_14-05-32.json (no colons: not allowed in filenames)
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  const filename = `stats-${readOnly ? "view-" : ""}${stamp}.json`;
  const file = new File([json], filename, { type: "application/json" });
  // share sheet works best on phones (save to Files, email, etc.)
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return true;
    } catch (err) {
      if (err.name === "AbortError") return false;
    }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(file);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return true;
}

// import: the file decides. an intact normal backup loads as yours;
// a read-only copy, an edited file or an unsealed one opens in viewing mode
$("importBtn").onclick = () => {
  $("menuDialog").close();
  $("importFile").click();
};
$("importFile").onchange = async () => {
  const file = $("importFile").files[0];
  $("importFile").value = "";
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    // new backups are { _readme, exported, stats }; old ones are a bare array
    const data = Array.isArray(parsed) ? parsed : parsed && parsed.stats;
    if (!Array.isArray(data)) throw new Error();
    const incoming = data.map(normalize);
    // only an untouched, sealed, non-read-only file may replace your stats
    const intact = !Array.isArray(parsed) && typeof parsed.seal === "string" && parsed.seal === sealOf(parsed);
    const locked = !intact || parsed.readOnly === true;
    if (locked) {
      viewing = incoming; // never saved, gone when you go back
      $("viewNote").textContent = intact ? "(read-only)" : "(edited · read-only)";
      render();
      return;
    }
    const shown = incoming.filter((s) => !s.deleted).length;
    const load = () => {
      stats = incoming;
      save();
      render();
      markSeen();
    };
    if (visible().length) ask(`replace your current stats with ${shown} stat(s) from the file?`, load);
    else load();
  } catch {
    ask("that file doesn't look like a stats backup.");
  }
};
