// cloud sync (dev): log in to your Supabase account and the cloud becomes the main copy of your stats + settings.
// - logging in (and every time the app opens or comes back into view) downloads the cloud's copy and replaces
//   this device's. the one exception: the cloud is empty (first login ever), then this device's goes up instead.
// - every change after that is an upload. made offline? it's remembered ("pending") and uploaded as soon as
//   there's a connection, before anything is downloaded, so offline changes are never lost.
// talks to Supabase's REST API with plain fetch (no library), so nothing extra loads and nothing breaks offline.
// also: sharing a live view (live.html, a read-only page anyone with the link can watch).
//
// tables (see the SQL in the setup): stats (user_id, id, data, updated_at), settings (user_id, data, updated_at),
// shares (id, user_id). row-level security: you only change your own rows; a shared user's stats can be read by anyone.

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
    throw new Error(json.message || `error ${res.status}`);
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
function cloudQueue() {
  if (!session || applying) return;
  setPending(true);
  clearTimeout(pushTimer);
  pushTimer = setTimeout(cloudPush, PUSH_DELAY);
}
async function cloudPush() {
  if (!session) return;
  clearTimeout(pushTimer);
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
  if (offline || !navigator.onLine) return `offline · ${when()}`;
  if (syncing) return "syncing…";
  if (syncError) return `not synced: ${syncError} · ${when()}`;
  if (lastSync && Date.now() - lastSync < RECENT) return "online";
  return `online · ${when()}`;
}

// sync (app opens, comes back into view, connection returns, just logged in):
// unsent changes on this device → upload them. otherwise → download the cloud's copy and use it here
// (cloud empty, i.e. the very first login → upload this device's instead)
let syncRunning = false;
async function cloudStart() {
  if (!session || syncRunning) return;
  if (pending) return cloudPush();
  // in the middle of something (a stat page, a yes / no, adding time…): don't swap the stats out from
  // under it. it downloads the next time instead
  if (document.querySelector("dialog[open]:not(#accountDialog):not(#menuDialog)")) return;
  syncRunning = true;
  setSyncing();
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
  applying = true;
  try {
    stats = cloud.stats.map(normalize);
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

// ── live view: a share link to live.html?u=<share id>, read-only, for anyone who has it ──
let shareId = null; // null = not shared (or not known yet)
const shareUrl = () => new URL(`live.html?u=${shareId}`, location.href).href;
async function loadShare() {
  try {
    const rows = await rest("shares?select=id");
    shareId = rows[0] ? rows[0].id : null;
  } catch {}
  renderAccount();
}
$("shareBtn").onclick = async () => {
  try {
    const rows = await rest("shares", { method: "POST", body: { user_id: session.user.id }, prefer: "return=representation" });
    shareId = rows[0].id;
  } catch (e) {
    $("accountState").textContent = e instanceof TypeError ? "no connection" : `couldn't share: ${e.message}`;
    return;
  }
  renderAccount();
};
// stop sharing: the link stops working (sharing again makes a new link)
$("stopShare").onclick = () =>
  ask("stop sharing? the link stops working for everyone who has it.", async () => {
    try {
      await rest("shares?id=not.is.null", { method: "DELETE" });
      shareId = null;
    } catch (e) {
      $("accountState").textContent = e instanceof TypeError ? "no connection" : `couldn't stop: ${e.message}`;
    }
    renderAccount();
  });
$("copyShare").onclick = async () => {
  try {
    if (navigator.share) await navigator.share({ url: shareUrl(), title: "stats (live)" });
    else await navigator.clipboard.writeText(shareUrl());
    if (!navigator.share) $("copyShare").textContent = "copied";
    setTimeout(() => ($("copyShare").textContent = "share link"), 1500);
  } catch {}
};

// ── the account page (menu → cloud) ──
function renderAccount() {
  const inside = !!session;
  $("loginForm").hidden = inside;
  $("accountIn").hidden = !inside;
  if (inside) {
    $("accountEmail").textContent = session.user.email;
    $("accountState").textContent = cloudStatus();
    $("shareBtn").hidden = !!shareId;
    $("shareOn").hidden = !shareId;
    if (shareId) {
      $("shareLink").href = shareUrl();
      $("shareLink").textContent = shareUrl();
    }
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
  $("menuDialog").close();
  $("loginError").textContent = "";
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
  const logIn = async () => {
    $("loginError").textContent = "logging in…";
    try {
      storeSession(await authCall("grant_type=password", { email, password }));
    } catch (err) {
      $("loginError").textContent = err instanceof TypeError ? "no connection" : err.message;
      return;
    }
    $("loginPassword").value = "";
    $("loginError").textContent = "";
    setPending(false); // whatever was here before is replaced by the cloud's copy
    renderAccount();
    loadShare();
    cloudStart();
  };
  if (stats.length) ask("logging in replaces the stats on this device with the ones in your cloud. export first if you want to keep them.", logIn);
  else logIn();
};
$("logoutBtn").onclick = async () => {
  const token = session && session.access_token;
  clearTimeout(pushTimer);
  storeSession(null);
  setPending(false);
  syncing = false;
  syncError = "";
  shareId = null;
  renderAccount();
  // tell Supabase too (best effort; the stats on this device stay as they are)
  if (token) fetch(`${SB_URL}/auth/v1/logout`, { method: "POST", headers: { apikey: SB_KEY, Authorization: `Bearer ${token}` } }).catch(() => {});
};
$("accountBack").onclick = () => $("accountDialog").close();

// sync when the app opens, when the connection comes back, and when you come back to the app
window.addEventListener("online", () => {
  offline = false;
  cloudStart();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") cloudStart();
});
setTimeout(cloudStart, 0);
