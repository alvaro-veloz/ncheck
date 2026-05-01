// nCheck — dashboard.js
// Andina Web Studio

const $ = id => document.getElementById(id);

let currentTab = "following";
let allFollowing = [];
let allFollowers = [];

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  $("btnScan").addEventListener("click", startScan);
  $("btnRescan").addEventListener("click", startScan);
  $("searchInput").addEventListener("input", renderList);

  document.querySelectorAll(".tab").forEach(tab => {
    tab.addEventListener("click", () => {
      currentTab = tab.dataset.tab;
      document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      renderList();
    });
  });

  // Recuperar estado si hay un escaneo previo
  chrome.runtime.sendMessage({ type: "get-state" }, (res) => {
    if (!res) return;
    if (res.following?.length || res.followers?.length) {
      applyResults(res);
    }
  });
});

// ─── Escuchar mensajes del background ────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || !msg.type) return;

  switch (msg.type) {
    case "scan-start":
      setStatus("scanning", "Escaneando...");
      showState("scanning");
      $("btnScan").disabled = true;
      $("btnRescan").disabled = true;
      $("progressSection").style.display = "flex";
      $("errorBanner").style.display = "none";
      break;

    case "viewer":
      updateViewer(msg.viewer);
      break;

    case "followers-progress":
      $("scanningTitle").textContent = "Cargando seguidores...";
      $("scanningSubtitle").textContent = `${msg.count} seguidores cargados hasta ahora`;
      $("progFollowersCount").textContent = msg.count;
      $("progFollowers").style.width = Math.min(100, (msg.count / 500) * 100) + "%";
      break;

    case "following-progress":
      $("scanningTitle").textContent = "Cargando siguiendo...";
      $("scanningSubtitle").textContent = `${msg.count} cuentas cargadas`;
      $("progFollowingCount").textContent = msg.count;
      $("progFollowing").style.width = Math.min(100, (msg.count / 500) * 100) + "%";
      break;

    case "scan-complete":
      applyResults(msg);
      break;

    case "rate-limit":
      $("scanningTitle").textContent = "Pausa obligatoria ☕";
      $("scanningSubtitle").textContent = "Instagram nos pidió esperar un momento. El escaneo continuará automáticamente.";
      break;

    case "profile-pic":
      updateAvatarPic(msg.id, msg.pic);
      break;
  }
});

// ─── Funciones ────────────────────────────────────────────────────────────────

function startScan() {
  allFollowing = [];
  allFollowers = [];
  $("progFollowers").style.width = "0%";
  $("progFollowing").style.width = "0%";
  $("progFollowersCount").textContent = "0";
  $("progFollowingCount").textContent = "0";
  resetStats();

  chrome.runtime.sendMessage({ type: "start-scan" });
}

function applyResults(data) {
  if (data.viewer) updateViewer(data.viewer);

  allFollowing = data.following || [];
  allFollowers = data.followers || [];

  const noFollow = allFollowing.filter(u => !u.follows_back).length;

  $("statFollowers").textContent = allFollowers.length.toLocaleString();
  $("statFollowing").textContent = allFollowing.length.toLocaleString();
  $("statNoFollow").textContent  = noFollow.toLocaleString();
  $("statRecip").textContent     = (data.reciprocal || 0).toLocaleString();

  setStatus("done", "Escaneo completo");
  showState("results");
  $("btnScan").disabled    = false;
  $("btnRescan").disabled  = false;
  $("progressSection").style.display = "none";
  renderList();
}

function updateViewer(viewer) {
  if (!viewer) return;
  const initials = (viewer.full_name || viewer.username || "?")
    .split(" ").slice(0, 2).map(w => w[0]).join("").toUpperCase();
  $("viewerAvatar").textContent = initials;
  $("viewerName").textContent   = viewer.full_name || viewer.username;
  $("viewerHandle").textContent = "@" + viewer.username;
}

function renderList() {
  const query = ($("searchInput").value || "").toLowerCase().trim();
  const list  = currentTab === "following" ? allFollowing : allFollowers;

  let filtered = query
    ? list.filter(u =>
        (u.username || "").toLowerCase().includes(query) ||
        (u.full_name || "").toLowerCase().includes(query)
      )
    : list;

  // En tab "following" mostrar primero los que no siguen de vuelta
  if (currentTab === "following") {
    filtered = [...filtered].sort((a, b) => {
      if (!a.follows_back && b.follows_back) return -1;
      if (a.follows_back && !b.follows_back) return 1;
      return 0;
    });
  }

  $("filterCount").textContent = `${filtered.length} usuario${filtered.length !== 1 ? "s" : ""}`;

  const html = filtered.map(user => buildUserRow(user)).join("");
  $("userList").innerHTML = html || `<div style="padding:2rem; text-align:center; color:var(--muted); font-size:0.85rem;">No se encontraron usuarios</div>`;
  $("stateResults").style.display = "block";
}

function buildUserRow(user) {
  const isFollowingTab = currentTab === "following";
  const noFollow = isFollowingTab ? !user.follows_back : !user.you_follow;

  const colors = ["#c8f04a","#7c5cfc","#f07070","#4ac8f0","#f0c84a","#c84af0"];
  const colorIdx = user.username ? user.username.charCodeAt(0) % colors.length : 0;
  const color = colors[colorIdx];
  const textColor = color === "#c8f04a" || color === "#f0c84a" ? "#050508" : "#f0ede8";

  const initials = (user.full_name || user.username || "?")
    .split(" ").slice(0, 2).map(w => w[0]).join("").toUpperCase();

  const avatarContent = user.pic_b64
    ? `<img src="${user.pic_b64}" style="width:40px;height:40px;border-radius:50%;object-fit:cover;" alt="${escHtml(user.username)}">`
    : `<span style="color:${textColor}">${initials}</span>`;

  const tagHtml = noFollow
    ? `<span class="tag tag-no">No sigue</span>`
    : `<span class="tag tag-yes">Recíproco</span>`;

  return `
    <div class="user-row ${noFollow ? "highlight" : ""}" data-uid="${user.id}">
      <div class="user-avatar" style="background:${user.pic_b64 ? "transparent" : color};">${avatarContent}</div>
      <div class="user-info">
        <div class="user-name">${escHtml(user.full_name || user.username)}</div>
        <div class="user-handle">@${escHtml(user.username)}</div>
      </div>
      ${tagHtml}
      <a href="https://www.instagram.com/${encodeURIComponent(user.username)}/" target="_blank" class="ig-link">Ver perfil →</a>
    </div>
  `;
}

function updateAvatarPic(id, pic) {
  // Actualizar en memoria
  [allFollowing, allFollowers].forEach(list => {
    const user = list.find(u => u.id === id);
    if (user) user.pic_b64 = pic;
  });

  // Actualizar en el DOM directamente sin re-renderizar toda la lista
  const row = document.querySelector(`.user-row[data-uid="${id}"]`);
  if (!row) return;
  const avatarDiv = row.querySelector(".user-avatar");
  if (!avatarDiv) return;
  avatarDiv.style.background = "transparent";
  avatarDiv.innerHTML = `<img src="${pic}" style="width:40px;height:40px;border-radius:50%;object-fit:cover;">`;
}

function handleError(code) {
  setStatus("error", "Error");
  showState("initial");
  $("btnScan").disabled   = false;
  $("btnRescan").disabled = false;
  $("progressSection").style.display = "none";

  const messages = {
    "not-authorized": "⚠️ Instagram no está abierto o tu sesión expiró. Abre Instagram en otra pestaña y vuelve a intentarlo.",
    "http-error":     "❌ Error de conexión. Verifica tu internet y vuelve a intentarlo.",
    "unexpected":     "❌ Ocurrió un error inesperado. Recarga la página e intenta de nuevo.",
  };

  const banner = $("errorBanner");
  banner.textContent = messages[code] || messages["unexpected"];
  banner.style.display = "block";
}

function setStatus(type, text) {
  $("statusDot").className = "status-dot " + type;
  $("statusText").textContent = text;
}

function showState(state) {
  $("stateInitial").style.display  = state === "initial"  ? "flex" : "none";
  $("stateScanning").style.display = state === "scanning" ? "flex" : "none";
  $("stateResults").style.display  = state === "results"  ? "block" : "none";
}

function resetStats() {
  ["statFollowers","statFollowing","statNoFollow","statRecip"].forEach(id => {
    $(id).textContent = "—";
  });
  $("viewerAvatar").textContent  = "?";
  $("viewerName").textContent    = "Tu cuenta";
  $("viewerHandle").textContent  = "Escaneando...";
}

function escHtml(str) {
  return (str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
