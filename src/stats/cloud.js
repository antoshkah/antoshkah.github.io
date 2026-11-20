// cloud sync (dev): log in to your Supabase account and the cloud becomes the main copy of your stats + settings.
// - logging in (and every time the app opens or comes back into view) downloads the cloud's copy and replaces
//   this device's. the one exception: the cloud is empty (first login ever), then this device's goes up instead.
// - every change after that is an upload. made offline? it's remembered ("pending") and uploaded as soon as
//   there's a connection, before anything is downloaded, so offline changes are never lost.
// talks to Supabase's REST API with plain fetch (no library), so nothing extra loads and nothing breaks offline.
// also: sharing a live view (live.html, a read-only page anyone with the link can watch).
//
// tables (see the SQL in the setup): stats (user_id, id, data, updated_at), settings (user_id, data, updated_at),
// shares (id, user_id, username). row-level security: you only change your own rows; a shared user's stats can be read by anyone.

// the publishable key is meant to be public; what protects the data is row-level security
const SB_URL = "https://ocgnkpvoligvygakairp.supabase.co";
const SB_KEY = "sb_publishable_dHSVpNuTOtU-R9FKxJjJlw_ZcRY8jEu";
const SESSION_KEY = "stats.session"; // { access_token, refresh_token, expires_at (s), user: { id, email } }
const PUSH_DELAY = 1500; // ms after the last change before sending (taps come in bursts)
const LAST_SYNC_KEY = "stats.lastSync"; // when this device last synced, kept across opens
const RECENT = 2 * 60 * 1000; // a sync within this long ago counts as "just synced": the page only says "online"

const PENDING_KEY = "stats.pending"; // "1" = a change on this device hasn't reached the cloud yet

let session = loadSession();
let pushTimer = null;
let applying = false; // putting the cloud's copy on this device: those saves aren't changes to upload
let pending = false;
try {
  pending = localStorage.getItem(PENDING_KEY) === "1";
} catch {}
function setPending(on) {
  pending = on;
  try {
    if (on) localStorage.setItem(PENDING_KEY, "1");
    else localStorage.removeItem(PENDING_KEY);
  } catch {}
}
// what the account page shows under your email (see cloudStatus)
let syncing = false;
let offline = !navigator.onLine; // also set when a request can't get through
let syncError = ""; // the server said no (not a connection problem)
let lastSync = null;
try {
  lastSync = Number(localStorage.getItem(LAST_SYNC_KEY)) || null;
} catch {}

function loadSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY)) || null;
  } catch {
    return null;
  }
}
function storeSession(s) {
  session = s;
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch {}
}

// ── auth ──
async function authCall(params, body) {
  const res = await fetch(`${SB_URL}/auth/v1/token?${params}`, {
    method: "POST",
    headers: { apikey: SB_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error_description || json.msg || json.message || `error ${res.status}`);
  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    expires_at: json.expires_at || Math.floor(Date.now() / 1000) + (json.expires_in || 3600),
    user: { id: json.user.id, email: json.user.email },
  };
}
// a valid access token, refreshed first if it's (nearly) expired. null = logged out
async function accessToken() {
  if (!session) return null;
  if (session.expires_at - 60 > Date.now() / 1000) return session.access_token;
  try {
    storeSession(await authCall("grant_type=refresh_token", { refresh_token: session.refresh_token }));
    return session.access_token;
  } catch (e) {
    // offline: keep the session and try again later. rejected: the session is over
    if (e instanceof TypeError) throw e;
    storeSession(null);
    renderAccount();
    return null;
  }
}

// ── data ──
async function rest(path, { method = "GET", body, prefer } = {}) {
  const token = await accessToken();
  if (!token) throw new Error("logged out");
  const headers = { apikey: SB_KEY, Authorization: `Bearer ${token}` };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    const err = new Error(json.message || `error ${res.status}`);
    err.code = json.code; // e.g. "23505" = already taken (a unique column)
    throw err;
  }
  return res.status === 204 ? null : res.json().catch(() => null);
}

async function pullAll() {
  const [rows, set] = await Promise.all([rest("stats?select=id,data"), rest("settings?select=data")]);
  return { stats: rows.map((r) => r.data), settings: set[0] ? set[0].data : null };
}

// this device → cloud: every stat upserted, and any stat no longer on this device (deleted for good) removed
async function pushAll() {
  const uid = session.user.id;
  const now = new Date().toISOString();
  if (stats.length) {
    await rest("stats?on_conflict=user_id,id", {
      method: "POST",
      body: stats.map((s) => ({ user_id: uid, id: s.id, data: s, updated_at: now })),
      prefer: "resolution=merge-duplicates,return=minimal",
    });
  }
  const keep = stats.map((s) => `"${String(s.id).replace(/"/g, '\\"')}"`).join(",");
  await rest(keep ? `stats?id=not.in.(${encodeURIComponent(keep)})` : "stats?id=not.is.null", { method: "DELETE" });
  await rest("settings?on_conflict=user_id", {
    method: "POST",
    body: { user_id: uid, data: settings, updated_at: now },
    prefer: "resolution=merge-duplicates,return=minimal",
  });
}

// called by save() / saveSettings() after every change: remember it, and send it a moment later
let pushQueued = false; // a change was just made (online) and is about to be sent
function cloudQueue() {
  if (!session || applying) return;
  setPending(true);
  clearTimeout(pushTimer);
  pushQueued = true;
  pushTimer = setTimeout(cloudPush, PUSH_DELAY);
}
async function cloudPush() {
  if (!session) return;
  clearTimeout(pushTimer);
  pushQueued = false;
  setSyncing();
  try {
    await pushAll();
    setPending(false);
    synced();
  } catch (e) {
    syncFailed(e);
  }
}

// ── sync status ──
function setSyncing() {
  syncing = true;
  renderAccount();
}
function synced() {
  syncing = false;
  offline = false;
  syncError = "";
  setPrefer("cloud"); // back online and in step: the choice was for that offline stretch only
  lastSync = Date.now();
  try {
    localStorage.setItem(LAST_SYNC_KEY, String(lastSync));
  } catch {}
  renderAccount();
}
// a fetch that can't reach the server throws a TypeError: that's being offline, not an error
function syncFailed(e) {
  syncing = false;
  if (e instanceof TypeError) offline = true;
  else syncError = e.message;
  renderAccount();
}
// "online" when the last sync was just now; otherwise when it last synced (same UTC time as the rest of the app,
// just the time if it was today)
function cloudStatus() {
  const when = () => {
    if (!lastSync) return "never synced";
    const full = fmtUtc(new Date(lastSync).toISOString());
    const today = fmtUtc(new Date().toISOString()).slice(0, 10);
    return `last sync ${full.startsWith(today) ? full.slice(11) : full}`;
  };
  if (isOffline()) return `offline · ${when()} · back online: ${prefer === "phone" ? "phone → cloud" : "cloud → phone"}`;
  if (syncing) return "syncing…";
  if (syncError) return `not synced: ${syncError} · ${when()}`;
  if (lastSync && Date.now() - lastSync < RECENT) return "online";
  return `online · ${when()}`;
}

// ── offline: which copy wins when the connection comes back ──
// tap the cloud at the top of the cloud page (only while offline) to flip it to a phone and back.
// cloud (the default) = the cloud's copy comes down, changes made here while offline are dropped.
// phone = this device's copy goes up and replaces the cloud's. back to cloud once it's synced
const PREFER_KEY = "stats.prefer";
let prefer = "cloud";
try {
  if (localStorage.getItem(PREFER_KEY) === "phone") prefer = "phone";
} catch {}
function setPrefer(p) {
  prefer = p;
  try {
    if (p === "phone") localStorage.setItem(PREFER_KEY, p);
    else localStorage.removeItem(PREFER_KEY);
  } catch {}
}
const isOffline = () => offline || !navigator.onLine;
$("accountCloud").addEventListener("click", () => {
  const icon = $("accountCloud");
  if (!session) return;
  if (!isOffline()) {
    // online: nothing to choose, just a little no-shake
    icon.classList.remove("nope");
    void icon.getBoundingClientRect();
    icon.classList.add("nope");
    return;
  }
  setPrefer(prefer === "phone" ? "cloud" : "phone");
  renderAccount();
});

// sync (app opens, comes back into view, connection returns, just logged in, and every minute while open):
// a change just made → upload it. changes left over from being offline → whichever side was chosen above
// (cloud: dropped and the cloud's copy comes down; phone: uploaded). otherwise → download the cloud's copy
// and use it here (cloud empty, i.e. the very first login → upload this device's instead). quiet = the
// once-a-minute check: no "syncing…" flash, and the list is only redrawn if something actually changed
let syncRunning = false;
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
async function cloudStart(quiet = false) {
  if (!session || syncRunning) return;
  if (pending) {
    if (pushQueued || prefer === "phone") return cloudPush();
    setPending(false); // cloud wins: what was changed here offline is replaced below
  }
  // in the middle of something (a stat page, a yes / no, adding time…): don't swap the stats out from
  // under it. it downloads the next time instead
  if (document.querySelector("dialog[open]:not(#accountDialog):not(#menuDialog):not(#helpDialog)")) return;
  syncRunning = true;
  if (!quiet) setSyncing();
  let cloud;
  try {
    cloud = await pullAll();
  } catch (e) {
    syncRunning = false;
    return syncFailed(e);
  }
  syncRunning = false;
  // a change made while it was downloading wins: send that instead
  if (pending) return cloudPush();
  if (!cloud.stats.length) return cloudPush();
  // already the same here: nothing to redraw (a redraw mid-hold would cancel the hold)
  const cloudStats = cloud.stats.map(normalize);
  const byId = (list) => [...list].sort((a, b) => (a.id < b.id ? -1 : 1));
  if (sameJson(byId(cloudStats), byId(stats)) && (!cloud.settings || sameJson(cloud.settings, settings))) return synced();
  applying = true;
  try {
    stats = cloudStats;
    save();
    if (cloud.settings) {
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(cloud.settings));
      } catch {}
      settings = loadSettings();
      saveSettings();
    }
    render();
    if (stats.length) markSeen();
  } finally {
    applying = false;
  }
  synced();
}

// ── live view: live.html?u=<username>, read-only, for anyone who has the link ──
// not shared: type a username, tap the eye. shared: the username (fixed), then open · copy link · stop sharing
let shareName = null; // null = not shared (or not known yet)
const USERNAME = /^[a-z0-9_-]{3,20}$/;
const shareUrl = () => new URL(`live.html?u=${encodeURIComponent(shareName)}`, location.href).href;
const shareMsg = (text) => ($("shareMsg").textContent = text);
async function loadShare() {
  try {
    const rows = await rest("shares?select=username");
    shareName = rows[0] ? rows[0].username : null;
  } catch {}
  renderAccount();
}
// usernames are lowercase: letters, numbers, _ and -
$("shareName").addEventListener("input", () => {
  const el = $("shareName");
  el.value = el.value.toLowerCase().replace(/[^a-z0-9_-]/g, "");
  shareMsg("");
});
$("shareName").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("shareBtn").click();
});
$("shareBtn").onclick = async () => {
  const name = $("shareName").value;
  if (!USERNAME.test(name)) return shareMsg("3–20 letters, numbers, _ or -");
  shareMsg("…");
  try {
    await rest("shares", { method: "POST", body: { user_id: session.user.id, username: name }, prefer: "return=minimal" });
    shareName = name;
    // a little "view created!" under the icons, gone after 3 seconds (unless something else replaced it)
    shareMsg("view created!");
    setTimeout(() => {
      if ($("shareMsg").textContent === "view created!") shareMsg("");
    }, 3000);
  } catch (e) {
    if (e instanceof TypeError) return shareMsg("no connection");
    // "23505" = already taken. which one: your account already has a view (one each), or the username is someone's
    if (e.code === "23505" && /user_id/.test(e.message)) {
      shareMsg("you already have a view");
      return loadShare(); // show it
    }
    return shareMsg(e.code === "23505" ? "that view ID is taken" : `couldn't share: ${e.message}`);
  }
  $("shareName").blur();
  renderAccount();
};
$("openShare").onclick = () => window.open(shareUrl(), "_blank", "noopener");
// copy: the link to the clipboard, and the icon turns into a tick for a moment
$("copyShare").onclick = async () => {
  try {
    await navigator.clipboard.writeText(shareUrl());
    $("copyIcon").setAttribute("href", "#i-check");
    setTimeout(() => $("copyIcon").setAttribute("href", "#i-copy"), 1200);
  } catch {
    shareMsg(shareUrl()); // no clipboard access: show it so it can be copied by hand
  }
};
// stop sharing: the link stops working, and the username is free again
$("stopShare").onclick = () =>
  ask("delete view?", async () => {
    try {
      await rest("shares?user_id=not.is.null", { method: "DELETE" });
      shareName = null;
      shareMsg("");
    } catch (e) {
      shareMsg(e instanceof TypeError ? "no connection" : `couldn't stop: ${e.message}`);
    }
    renderAccount();
  });

// ── the account page (menu → cloud) ──
function renderAccount() {
  const inside = !!session;
  $("loginForm").hidden = inside;
  $("accountIn").hidden = !inside;
  $("logoutBtn").hidden = !inside;
  $("accountCloud").toggleAttribute("hidden", !inside); // (an <svg> has no .hidden property, only the attribute)
  if (inside) {
    $("accountEmail").textContent = session.user.email;
    $("accountCloudIcon").setAttribute("href", prefer === "phone" ? "#i-phone" : "#i-cloud");
    $("accountState").textContent = cloudStatus();
    const shared = !!shareName;
    $("shareName").readOnly = shared;
    if (shared) $("shareName").value = shareName;
    $("shareBtn").hidden = shared;
    for (const id of ["openShare", "copyShare", "stopShare"]) $(id).hidden = !shared;
  }
}
// while the page is open, keep the status current ("online" turns into "online · last sync …" as time passes)
setInterval(() => {
  if ($("accountDialog").open && session) renderAccount();
}, 15000);
// the connection drops or comes back: say so straight away
window.addEventListener("offline", () => {
  offline = true;
  renderAccount();
});
$("accountBtn").onclick = () => {
  accountFromStart = accountFromHelp = false;
  $("menuDialog").close();
  renderAccount();
  show($("accountDialog"));
  if (session) loadShare();
};
// logging in replaces this device's stats with the cloud's, so with stats here it asks first
$("loginForm").onsubmit = (e) => {
  e.preventDefault();
  const email = $("loginEmail").value.trim();
  const password = $("loginPassword").value;
  if (!email || !password) return;
  // the email and password are checked first (the plug goes in meanwhile); only then the warning (always). 👍 = connected. 👎 / tap off = the plug comes back out and that login is thrown away
  const plug = $("plugBtn");
  plug.classList.add("plugged"); // in it goes
  const landed = new Promise((ok) => setTimeout(ok, 600)); // let the plug land before anything else happens
  authCall("grant_type=password", { email, password }).then(
    async (newSession) => {
      await landed;
      const connect = () => {
        storeSession(newSession);
        $("loginPassword").value = "";
        setPending(false); // whatever was here before is replaced by the cloud's copy
        renderAccount();
        loadShare();
        cloudStart();
      };
      let yes = false;
      ask('<span class="ask-head"><svg class="ic"><use href="#i-warn" /></svg><b>warning</b></span>connect will clear all local data.', () => {
        yes = true;
        connect();
      }, true);
      $("zeroDialog").addEventListener("close", () => {
        if (yes) return;
        plug.classList.remove("plugged");
        // not using it: end that session on Supabase's side too (best effort)
        fetch(`${SB_URL}/auth/v1/logout`, { method: "POST", headers: { apikey: SB_KEY, Authorization: `Bearer ${newSession.access_token}` } }).catch(() => {});
      }, { once: true });
    },
    async (err) => {
      await landed;
      plug.classList.remove("plugged"); // didn't work: it comes back out
      // wrong email or password: both cleared, and their placeholders go red for a moment.
      // no connection: what you typed stays, in red for a moment
      const fields = [$("loginEmail"), $("loginPassword")];
      if (!(err instanceof TypeError)) for (const f of fields) f.value = "";
      for (const f of fields) f.classList.add("bad");
      setTimeout(() => fields.forEach((f) => f.classList.remove("bad")), 1800);
    }
  );
};
// log out: asks first, then the page fades and the cloud implodes. then everything on this device is cleared
// (stats, settings, the lot: they're safe in the cloud) and the app reloads onto the normal, empty + screen
$("logoutBtn").onclick = () =>
  ask('<span class="ask-head"><svg class="ic"><use href="#i-warn" /></svg><b>warning</b></span>disconnect will clear all local data.', () => {
    const page = $("accountDialog");
    page.classList.add("leaving");
    // a change not sent yet goes up first (if there's a connection), so clearing this device doesn't lose it
    const sent = pending && !isOffline() ? cloudPush() : Promise.resolve();
    const animated = new Promise((ok) => setTimeout(ok, 1500)); // 0.6s fade, then the 0.6s implode (starts at 0.75s), then a beat
    Promise.all([sent, animated]).then(() => {
      logOut();
      wipeLocal(true); // and reloads (keeping the first-visit flags: no welcome again)
    });
  }, true);
function logOut() {
  const token = session && session.access_token;
  clearTimeout(pushTimer);
  storeSession(null);
  setPending(false);
  setPrefer("cloud");
  syncing = false;
  syncError = "";
  shareName = null;
  $("shareName").value = "";
  $("plugBtn").classList.remove("plugged"); // unplugged, ready for next time
  renderAccount();
  // tell Supabase too (best effort; the stats on this device stay as they are)
  if (token) fetch(`${SB_URL}/auth/v1/logout`, { method: "POST", headers: { apikey: SB_KEY, Authorization: `Bearer ${token}` } }).catch(() => {});
}
// ── ? guide → cloud sync: the info page, and deleting everything of yours in the cloud ──
// "here" only works (and only looks tappable) while connected
$("cloudInfoBtn").onclick = () => {
  $("cloudDeleteBtn").disabled = !session;
  show($("cloudInfoDialog"));
};
$("cloudInfoBack").onclick = () => $("cloudInfoDialog").close();
$("cloudInfoDialog").addEventListener("click", (e) => {
  if (!e.target.closest("button, a")) $("cloudInfoDialog").close(); // tap anywhere else: back to the guide
});
// "here": your stats, settings and live view are deleted from the cloud, and this device disconnects
// (its stats stay on it: logged out, nothing goes back up). the account itself (email + password) stays
$("cloudDeleteBtn").onclick = () => {
  if (!session) return;
  ask('<span class="ask-head"><svg class="ic"><use href="#i-warn" /></svg><b>warning</b></span>delete all your stats, settings and live view from the cloud? this can\'t be undone.', async () => {
    clearTimeout(pushTimer); // no upload sneaking in while it deletes
    try {
      await rest("shares?user_id=not.is.null", { method: "DELETE" });
      await rest("stats?user_id=not.is.null", { method: "DELETE" });
      await rest("settings?user_id=not.is.null", { method: "DELETE" });
    } catch (e) {
      return ask(e instanceof TypeError ? "no connection: nothing was deleted." : `couldn't delete: ${e.message}`);
    }
    logOut(); // so nothing on this device goes back up
    ask("your info on the cloud is deleted. this device is disconnected; its stats are still here.");
  }, true);
};

// first-visit guide → "To sync online click here": the cloud login, opened on top of the guide
// (closing the guide would count the first visit as done). back closes it, the guide's still there
let accountFromHelp = false;
$("helpSync").onclick = () => {
  accountFromHelp = true;
  renderAccount();
  show($("accountDialog"));
};

// opened from the first visit's upside-down ? page (not the menu): back goes there instead
let accountFromStart = false;
$("startCloud").onclick = () => {
  accountFromStart = true;
  accountFromHelp = false;
  $("startDialog").close();
  renderAccount();
  show($("accountDialog"));
};
// back: to wherever it was opened from (the menu, or the first visit's page)
$("accountBack").onclick = () => {
  $("accountDialog").close();
  // logged in from the first visit and now has stats: the intro's gone, so back is just the list
  if (accountFromHelp) {
    // the guide is still open underneath
  } else if (accountFromStart) {
    if (isNew()) show($("startDialog"));
  } else show($("menuDialog"));
  accountFromStart = accountFromHelp = false;
};

// sync when the app opens, when the connection comes back, and when you come back to the app
window.addEventListener("online", () => {
  offline = false;
  cloudStart();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") cloudStart();
});
// and quietly once a minute while the app is open: picks up changes from your other devices
setInterval(() => {
  if (document.visibilityState === "visible" && navigator.onLine) cloudStart(true);
}, 60 * 1000);
setTimeout(cloudStart, 0);
