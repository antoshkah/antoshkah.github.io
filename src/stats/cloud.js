// cloud sync (dev): log in to your Supabase account and your stats + settings are copied up to it.
// this device stays the main copy: the app works offline exactly as before, and changes are sent
// whenever there's a connection. talks to Supabase's REST API with plain fetch (no library), so
// nothing extra has to load and nothing breaks offline.
//
// tables (see the SQL in the setup): stats (user_id, id, data, updated_at), settings (user_id, data, updated_at).
// row-level security on both: you only ever see and change your own rows.

// the publishable key is meant to be public; what protects the data is row-level security
const SB_URL = "https://ocgnkpvoligvygakairp.supabase.co";
const SB_KEY = "sb_publishable_dHSVpNuTOtU-R9FKxJjJlw_ZcRY8jEu";
const SESSION_KEY = "stats.session"; // { access_token, refresh_token, expires_at (s), user: { id, email } }
const PUSH_DELAY = 1500; // ms after the last change before sending (taps come in bursts)

let session = loadSession();
let cloudReady = false; // only push once the first pull on this device has been sorted out
let pushTimer = null;
let cloudState = ""; // what the account page shows under your email

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

// called by save() / saveSettings() after every change: send it a moment later (only once set up)
function cloudQueue() {
  if (!session || !cloudReady) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(cloudPush, PUSH_DELAY);
}
async function cloudPush() {
  if (!session || !cloudReady) return;
  setCloudState("syncing…");
  try {
    await pushAll();
    setCloudState(`synced ${new Date().toTimeString().slice(0, 5)}`);
  } catch (e) {
    setCloudState(e instanceof TypeError ? "offline · syncs when back online" : `not synced: ${e.message}`);
  }
}

// first sync on this device after logging in (or opening the app logged in):
// cloud empty → upload this device. this device empty → take the cloud's. both have stats and they
// differ → ask which one wins. after that, every change is pushed.
const sameStats = (a, b) => {
  const key = (list) => JSON.stringify([...list].sort((x, y) => (x.id < y.id ? -1 : 1)));
  return key(a) === key(b);
};
async function cloudStart() {
  if (!session) return;
  if (cloudReady) return cloudPush();
  setCloudState("syncing…");
  let cloud;
  try {
    cloud = await pullAll();
  } catch (e) {
    return setCloudState(e instanceof TypeError ? "offline · syncs when back online" : `not synced: ${e.message}`);
  }
  const takeCloud = () => {
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
  };
  const ready = () => {
    cloudReady = true;
    cloudPush();
  };
  if (!cloud.stats.length) return ready(); // nothing up there yet: this device fills it
  if (!stats.length) {
    takeCloud();
    return ready();
  }
  if (sameStats(stats.map(normalize), cloud.stats.map(normalize))) return ready();
  // both have stats and they differ: you choose. yes = the cloud's here, no (or tap off) = this device's up there
  setCloudState("waiting for you to choose");
  ask(`the cloud has ${cloud.stats.length} stat(s), this device has ${stats.length}. replace this device's with the cloud's? (no = this device's replace the cloud's)`, takeCloud);
  $("zeroDialog").addEventListener("close", ready, { once: true });
}

// ── the account page (menu → cloud) ──
function setCloudState(text) {
  cloudState = text;
  if ($("accountDialog").open) renderAccount();
}
function renderAccount() {
  const inside = !!session;
  $("loginForm").hidden = inside;
  $("accountIn").hidden = !inside;
  if (inside) {
    $("accountEmail").textContent = session.user.email;
    $("accountState").textContent = cloudState;
  }
}
$("accountBtn").onclick = () => {
  $("menuDialog").close();
  $("loginError").textContent = "";
  renderAccount();
  show($("accountDialog"));
};
$("loginForm").onsubmit = async (e) => {
  e.preventDefault();
  const email = $("loginEmail").value.trim();
  const password = $("loginPassword").value;
  if (!email || !password) return;
  $("loginError").textContent = "logging in…";
  try {
    storeSession(await authCall("grant_type=password", { email, password }));
  } catch (err) {
    $("loginError").textContent = err instanceof TypeError ? "no connection" : err.message;
    return;
  }
  $("loginPassword").value = "";
  $("loginError").textContent = "";
  cloudReady = false;
  renderAccount();
  cloudStart();
};
$("logoutBtn").onclick = async () => {
  const token = session && session.access_token;
  clearTimeout(pushTimer);
  storeSession(null);
  cloudReady = false;
  cloudState = "";
  renderAccount();
  // tell Supabase too (best effort; the stats on this device stay as they are)
  if (token) fetch(`${SB_URL}/auth/v1/logout`, { method: "POST", headers: { apikey: SB_KEY, Authorization: `Bearer ${token}` } }).catch(() => {});
};
$("accountBack").onclick = () => $("accountDialog").close();

// sync when the app opens, when the connection comes back, and when you come back to the app
window.addEventListener("online", () => cloudStart());
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") cloudStart();
});
setTimeout(cloudStart, 0);
