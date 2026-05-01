// nCheck — Andina Web Studio
// background.js — service worker principal

const IG = "https://www.instagram.com/";
const HASH_FOLLOWERS = "37479f2b8209594dde7facb0d904896a";
const HASH_FOLLOWING = "58712303d941c6855d4e888c5f0cd22f";

const RATE_LIMIT_WAIT  = 300000; // 5 min si Instagram nos frena fuerte
const RETRY_WAIT       = 15000;  // 15 seg en error genérico
const PAGE_DELAY       = 6000;   // delay entre páginas para no levantar sospechas
const BATCH_SIZE       = 24;     // usuarios por página

let state = {
  scanId: null,
  lastAction: 0,
  viewer: null,
  csrf: null,
  userId: null,
  followers: [],
  following: [],
  reciprocal: 0,
  dashTabId: null,
  scanning: false,
};

// ─── Abrir dashboard al hacer clic ───────────────────────────────────────────
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create(
    { url: chrome.runtime.getURL("dashboard.html") },
    (tab) => { state.dashTabId = tab.id; }
  );
});

// Registrar pestaña del dashboard cuando carga
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === "complete" && tab.url && tab.url.includes("dashboard.html")) {
    state.dashTabId = tabId;
  }
});

// ─── Mensajes desde el dashboard ─────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (!msg || !msg.type) return true;

  if (msg.type === "start-scan") {
    resetState();
    state.scanId = Date.now();
    startScan();
    reply({ ok: true });
  }

  if (msg.type === "get-state") {
    reply({
      scanning: state.scanning,
      viewer: state.viewer,
      followers: state.followers,
      following: state.following,
      reciprocal: state.reciprocal,
      scanId: state.scanId,
      lastAction: state.lastAction,
    });
  }

  return true;
});

// ─── Reset ────────────────────────────────────────────────────────────────────
function resetState() {
  state.viewer     = null;
  state.csrf       = null;
  state.userId     = null;
  state.followers  = [];
  state.following  = [];
  state.reciprocal = 0;
  state.scanning   = false;
}

// ─── Enviar evento al dashboard ───────────────────────────────────────────────
function emit(type, payload = {}) {
  if (!state.dashTabId) return;
  chrome.tabs.sendMessage(state.dashTabId, { type, ...payload }).catch(() => {});
}

// ─── Fetch con manejo de errores ──────────────────────────────────────────────
async function igFetch(url, scanId) {
  if (state.scanId !== scanId) return null; // scan cancelado

  const res = await fetch(url, { credentials: "include" });

  if (res.status === 429) {
    emit("rate-limit");
    await sleep(RATE_LIMIT_WAIT);
    return igFetch(url, scanId);
  }

  if (res.status === 403) {
    emit("error", { code: "not-authorized" });
    return null;
  }

  if (!res.ok) {
    emit("error", { code: "http-error", status: res.status });
    await sleep(RETRY_WAIT);
    return igFetch(url, scanId);
  }

  return res.json();
}

// ─── Arrancar el escaneo ──────────────────────────────────────────────────────
async function startScan() {
  state.scanning = true;
  const scanId = state.scanId;

  emit("scan-start");

  try {
    // 1. Obtener datos del viewer desde la página de Instagram
    const html = await fetch(IG, { credentials: "include" }).then(r => r.text());

    const csrfMatch    = html.match(/"csrf_token":"([^"]+)"/);
    const idMatch      = html.match(/"id":"(\d+)"/);
    const userMatch    = html.match(/"username":"([^"]+)"/);
    const nameMatch    = html.match(/"full_name":"([^"]+)"/);

    if (!csrfMatch || !idMatch || !userMatch) {
      emit("error", { code: "not-authorized" });
      state.scanning = false;
      return;
    }

    state.csrf   = csrfMatch[1];
    state.userId = idMatch[1];
    state.viewer = {
      id:        state.userId,
      username:  userMatch[1],
      full_name: nameMatch ? nameMatch[1] : "",
    };

    emit("viewer", { viewer: state.viewer });

    // 2. Cargar seguidores
    await loadFollowers(null, scanId);
    if (state.scanId !== scanId) return;

    // 3. Cargar siguiendo
    await loadFollowing(null, scanId);
    if (state.scanId !== scanId) return;

    // 4. Comparar
    buildResults();

  } catch (e) {
    emit("error", { code: "unexpected", message: e.message });
  }

  state.scanning = false;
}

// ─── Cargar followers paginado ────────────────────────────────────────────────
async function loadFollowers(cursor, scanId) {
  if (state.scanId !== scanId) return;

  const vars = cursor
    ? `{"id":"${state.userId}","first":${BATCH_SIZE},"after":"${cursor}"}`
    : `{"id":"${state.userId}","first":${BATCH_SIZE}}`;

  const url = `${IG}graphql/query/?query_hash=${HASH_FOLLOWERS}&variables=${encodeURIComponent(vars)}`;
  const data = await igFetch(url, scanId);
  if (!data) return;

  const edge    = data?.data?.user?.edge_followed_by;
  const edges   = edge?.edges ?? [];
  const hasNext = edge?.page_info?.has_next_page;
  const endCursor = edge?.page_info?.end_cursor;

  state.followers = state.followers.concat(edges.map(e => e.node));
  state.lastAction = Date.now();

  emit("followers-progress", { count: state.followers.length });

  if (hasNext && endCursor) {
    await sleep(PAGE_DELAY + Math.random() * 2000);
    await loadFollowers(endCursor, scanId);
  }
}

// ─── Cargar following paginado ────────────────────────────────────────────────
async function loadFollowing(cursor, scanId) {
  if (state.scanId !== scanId) return;

  const vars = cursor
    ? `{"id":"${state.userId}","first":${BATCH_SIZE},"after":"${cursor}"}`
    : `{"id":"${state.userId}","first":${BATCH_SIZE}}`;

  const url = `${IG}graphql/query/?query_hash=${HASH_FOLLOWING}&variables=${encodeURIComponent(vars)}`;
  const data = await igFetch(url, scanId);
  if (!data) return;

  const edge    = data?.data?.user?.edge_follow;
  const edges   = edge?.edges ?? [];
  const hasNext = edge?.page_info?.has_next_page;
  const endCursor = edge?.page_info?.end_cursor;

  state.following = state.following.concat(edges.map(e => e.node));
  state.lastAction = Date.now();

  emit("following-progress", { count: state.following.length });

  if (hasNext && endCursor) {
    await sleep(PAGE_DELAY + Math.random() * 2000);
    await loadFollowing(endCursor, scanId);
  }
}

// ─── Comparar listas ──────────────────────────────────────────────────────────
function buildResults() {
  const followerIds = new Set(state.followers.map(u => u.id));

  let reciprocal = 0;
  state.following = state.following.map(u => {
    const follows_back = followerIds.has(u.id);
    if (follows_back) reciprocal++;
    return { ...u, follows_back };
  });

  state.followers = state.followers.map(u => {
    const youFollow = state.following.some(f => f.id === u.id);
    return { ...u, you_follow: youFollow };
  });

  state.reciprocal = reciprocal;

  emit("scan-complete", {
    viewer:     state.viewer,
    followers:  state.followers,
    following:  state.following,
    reciprocal: state.reciprocal,
  });

  // Cargar fotos de perfil en segundo plano después de mostrar resultados
  loadProfilePics([...state.following, ...state.followers]);
}

// ─── Cargar fotos de perfil ───────────────────────────────────────────────────
async function loadProfilePics(users) {
  const unique = [...new Map(users.map(u => [u.id, u])).values()];
  for (const user of unique) {
    if (!user.profile_pic_url) continue;
    try {
      const res = await fetch(user.profile_pic_url, { credentials: "omit" });
      if (!res.ok) continue;
      const buf = await res.arrayBuffer();
      const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
      const mime = res.headers.get("content-type") || "image/jpeg";
      user.pic_b64 = `data:${mime};base64,${b64}`;
      emit("profile-pic", { id: user.id, pic: user.pic_b64 });
    } catch (_) {
      // fallback silencioso a iniciales en el dashboard
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
