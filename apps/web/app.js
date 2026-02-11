const storedSessionToken = sessionStorage.getItem("arknas_token") || "";
const storedLocalToken = localStorage.getItem("arknas_token") || "";

const state = {
  token: storedSessionToken || storedLocalToken || "",
  user: null,
  page: "dashboard",
  refreshTimer: null,
  modalTimer: null,
  dockerTab: "containers",
  downloadsFilter: "all",
  downloadsDetailHash: "",
  systemMenu: "device"
};

const PAGE_TITLES = {
  dashboard: "仪表盘",
  containers: "Docker 中心",
  media: "影视",
  downloads: "下载管理",
  apps: "应用中心",
  ssl: "SSL 证书",
  settings: "系统设置"
};

const appEl = document.getElementById("app");
const loginOverlayEl = document.getElementById("loginOverlay");
const pageContentEl = document.getElementById("pageContent");
const pageTitleEl = document.getElementById("pageTitle");
const toastEl = document.getElementById("toast");
const modalEl = document.getElementById("modal");
const modalTitleEl = document.getElementById("modalTitle");
const modalBodyEl = document.getElementById("modalBody");

function showToast(message) {
  toastEl.textContent = message;
  toastEl.classList.remove("hidden");
  setTimeout(() => toastEl.classList.add("hidden"), 2500);
}

function clearModalTimer() {
  if (state.modalTimer) {
    clearInterval(state.modalTimer);
    state.modalTimer = null;
  }
}

function openModal(title, html) {
  clearModalTimer();
  modalTitleEl.textContent = title;
  modalBodyEl.innerHTML = html;
  modalEl.classList.remove("hidden");
}

function closeModal() {
  clearModalTimer();
  modalEl.classList.add("hidden");
  modalBodyEl.innerHTML = "";
}

document.getElementById("modalClose").addEventListener("click", closeModal);
modalEl.addEventListener("click", (e) => {
  if (e.target === modalEl) closeModal();
});

function formatBytes(bytes = 0) {
  if (!Number.isFinite(bytes)) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let val = bytes;
  let idx = 0;
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024;
    idx += 1;
  }
  return `${val.toFixed(idx === 0 ? 0 : 2)} ${units[idx]}`;
}

function formatSpeed(bytes = 0) {
  return `${formatBytes(bytes)}/s`;
}

function formatDate(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString();
}

function statusClass(stateValue) {
  if (stateValue === "running") return "status-running";
  if (stateValue === "stopped") return "status-stopped";
  if (stateValue === "error") return "status-error";
  return "status-other";
}

async function api(path, options = {}) {
  const { skipAuthHandling = false, ...fetchOptions } = options;
  const headers = { ...(fetchOptions.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;

  const res = await fetch(path, {
    ...fetchOptions,
    headers
  });

  let errorMessage = "";
  if (!res.ok) {
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      errorMessage = data.error || `HTTP ${res.status}`;
    } else {
      const text = await res.text().catch(() => "");
      errorMessage = text || `HTTP ${res.status}`;
    }
  }

  if (res.status === 401) {
    if (!skipAuthHandling) {
      forceLogout();
      throw new Error("登录已过期，请重新登录");
    }
    throw new Error(errorMessage || "认证失败");
  }

  if (!res.ok) {
    throw new Error(errorMessage || `HTTP ${res.status}`);
  }

  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return res.json();
  return res.text();
}

function setAuthedUI(authed) {
  appEl.classList.toggle("hidden", !authed);
  loginOverlayEl.classList.toggle("hidden", authed);
}

function forceLogout() {
  state.token = "";
  state.user = null;
  localStorage.removeItem("arknas_token");
  sessionStorage.removeItem("arknas_token");
  clearRefreshTimer();
  setAuthedUI(false);
}

function initLoginFormState() {
  const usernameInput = document.querySelector('input[name="username"]');
  const rememberInput = document.getElementById("rememberLogin");
  const lastUser = localStorage.getItem("arknas_last_user") || "";
  const remember = localStorage.getItem("arknas_remember") === "1";
  if (usernameInput && lastUser) usernameInput.value = lastUser;
  if (rememberInput) rememberInput.checked = remember;

  const nodeNameEl = document.getElementById("loginNodeName");
  if (nodeNameEl) {
    nodeNameEl.textContent = location.hostname || "管理节点";
  }
}

async function bootstrapAuth() {
  if (!state.token) {
    setAuthedUI(false);
    return;
  }

  try {
    const data = await api("/api/auth/me");
    state.user = data.user;
    setAuthedUI(true);
    await navigate("dashboard");
  } catch {
    forceLogout();
  }
}

function clearRefreshTimer() {
  if (state.refreshTimer) {
    clearInterval(state.refreshTimer);
    state.refreshTimer = null;
  }
}

function setPageTitle(page) {
  pageTitleEl.textContent = PAGE_TITLES[page] || page;
}

function setActiveNav(page) {
  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.page === page);
  });
}

async function navigate(page) {
  clearRefreshTimer();
  closeModal();
  state.page = page;
  setPageTitle(page);
  setActiveNav(page);

  if (page === "dashboard") {
    await renderDashboard();
    state.refreshTimer = setInterval(renderDashboard, 8000);
  } else if (page === "containers") {
    await renderContainers();
  } else if (page === "media") {
    await renderMedia();
  } else if (page === "downloads") {
    await renderDownloads();
  } else if (page === "apps") {
    await renderApps();
    state.refreshTimer = setInterval(renderApps, 5000);
  } else if (page === "ssl") {
    await renderSSL();
  } else if (page === "settings") {
    await renderSettings();
  }
}

async function renderDashboard() {
  try {
    const data = await api("/api/dashboard/overview");
    const containerSummary = data.containers.data?.summary || {
      total: 0,
      running: 0,
      stopped: 0,
      error: 0
    };

    const mediaSummary = data.media.data?.summary || {
      activeSessions: 0,
      continueCount: 0,
      latestCount: 0
    };

    const downloadSummary = data.downloads.data?.summary || {
      downloading: 0,
      seeding: 0,
      completed: 0,
      dlSpeed: 0,
      upSpeed: 0
    };

    const sys = data.system.data || {
      cpu: { usagePercent: 0 },
      memory: { usagePercent: 0 },
      disks: [],
      network: []
    };

    const latest = data.media.data?.latest || [];
    const completed = data.recentCompleted.data || [];
    const alerts = data.alerts || [];

    pageContentEl.innerHTML = `
      <section class="card">
        <h3>告警中心</h3>
        <div class="list">
          ${
            alerts.length
              ? alerts
                  .map(
                    (a) =>
                      `<div class="list-item"><div class="list-title">${a.code}</div><div class="text-muted">[${a.severity}] ${a.message}</div></div>`
                  )
                  .join("")
              : '<div class="text-muted">当前无告警</div>'
          }
        </div>
      </section>

      <section class="grid-4">
        <div class="card stat"><div class="stat-label">容器总数</div><div class="stat-value">${containerSummary.total}</div><div class="text-muted">运行 ${containerSummary.running} / 停止 ${containerSummary.stopped} / 异常 ${containerSummary.error}</div></div>
        <div class="card stat"><div class="stat-label">Jellyfin</div><div class="stat-value">${mediaSummary.activeSessions}</div><div class="text-muted">活跃播放会话</div></div>
        <div class="card stat"><div class="stat-label">qB 下载中</div><div class="stat-value">${downloadSummary.downloading}</div><div class="text-muted">下行 ${formatSpeed(downloadSummary.dlSpeed)}</div></div>
        <div class="card stat"><div class="stat-label">qB 上传</div><div class="stat-value">${formatSpeed(downloadSummary.upSpeed)}</div><div class="text-muted">做种 ${downloadSummary.seeding}</div></div>
      </section>

      <section class="grid-3">
        <div class="card">
          <h3>系统资源</h3>
          <div class="list">
            <div class="list-item"><div>CPU：${sys.cpu.usagePercent}%</div><div class="progress"><span style="width:${sys.cpu.usagePercent}%"></span></div></div>
            <div class="list-item"><div>内存：${sys.memory.usagePercent}%</div><div class="progress"><span style="width:${sys.memory.usagePercent}%"></span></div></div>
            <div class="list-item">磁盘：${(sys.disks || [])
              .map((d) => `${d.mount} ${d.usePercent}% (${formatBytes(d.available)} 可用)`)
              .join("<br />") || "-"}</div>
            <div class="list-item">网络：${(sys.network || [])
              .map((n) => `${n.iface} ↓${formatSpeed(n.rxSec)} ↑${formatSpeed(n.txSec)}`)
              .join("<br />") || "-"}</div>
          </div>
        </div>
        <div class="card">
          <h3>最近添加（影视）</h3>
          <div class="list">
            ${latest
              .slice(0, 8)
              .map(
                (it) => `<div class="list-item"><div class="list-title">${it.Name || "未命名"}</div><div class="text-muted">${it.Type || "-"} · ${formatDate(it.DateCreated)}</div></div>`
              )
              .join("") || '<div class="text-muted">暂无数据</div>'}
          </div>
        </div>
        <div class="card">
          <h3>最近完成下载</h3>
          <div class="list">
            ${completed
              .slice(0, 8)
              .map(
                (it) => `<div class="list-item"><div class="list-title">${it.name}</div><div class="text-muted">${formatBytes(it.size)} · 完成于 ${formatDate((it.completion_on || 0) * 1000)}</div></div>`
              )
              .join("") || '<div class="text-muted">暂无数据</div>'}
          </div>
        </div>
      </section>
    `;
  } catch (err) {
    pageContentEl.innerHTML = `<div class="card">加载失败：${err.message}</div>`;
  }
}

async function renderContainers() {
  try {
    const tabs = [
      { id: "containers", label: "容器" },
      { id: "compose", label: "Compose 项目" },
      { id: "images", label: "本地镜像" },
      { id: "registry", label: "镜像仓库" },
      { id: "networks", label: "网络" }
    ];

    let bodyHtml = "";

    if (state.dockerTab === "containers") {
      const data = await api("/api/containers/summary");
      const list = data.containers || [];
      bodyHtml = `
        <section class="card">
          <div class="actions" style="justify-content: space-between;">
            <div class="text-muted">总计 ${data.summary.total}，运行 ${data.summary.running}，停止 ${data.summary.stopped}，异常 ${data.summary.error}</div>
            <button id="reloadContainers" class="btn btn-secondary">刷新列表</button>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>容器</th><th>项目</th><th>状态</th><th>CPU</th><th>内存</th><th>网络</th><th>端口</th><th>操作</th>
                </tr>
              </thead>
              <tbody>
                ${list
                  .map(
                    (c) => `
                      <tr>
                        <td>${c.name}<div class="text-muted">${c.image}</div></td>
                        <td>${c.project}</td>
                        <td><span class="status-dot ${statusClass(c.state)}"></span>${c.status}</td>
                        <td>${c.metrics.cpuPercent}%</td>
                        <td>${formatBytes(c.metrics.memoryBytes)}</td>
                        <td>↓${formatSpeed(c.metrics.netInBytes)}<br />↑${formatSpeed(c.metrics.netOutBytes)}</td>
                        <td>${(c.ports || [])
                          .map((p) => `${p.publicPort || "-"}:${p.privatePort}/${p.type}`)
                          .join("<br />")}</td>
                        <td>
                          <div class="actions">
                            <button class="btn btn-secondary" data-action="start" data-id="${c.id}">启动</button>
                            <button class="btn btn-secondary" data-action="stop" data-id="${c.id}">停止</button>
                            <button class="btn btn-secondary" data-action="restart" data-id="${c.id}">重启</button>
                            <button class="btn btn-secondary" data-action="logs" data-id="${c.id}" data-name="${c.name}">日志</button>
                            <button class="btn btn-danger" data-action="update" data-id="${c.id}">更新</button>
                          </div>
                        </td>
                      </tr>
                    `
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </section>
      `;
    }

    if (state.dockerTab === "compose") {
      const projects = await api("/api/containers/compose/projects");
      bodyHtml = `
        <section class="card">
          <h3>Compose 项目管理</h3>
          <div class="table-wrap">
            <table>
              <thead><tr><th>项目</th><th>服务数</th><th>容器</th><th>运行</th><th>停止</th><th>操作</th></tr></thead>
              <tbody>
                ${projects
                  .map(
                    (p) => `
                      <tr>
                        <td>${p.name}<div class="text-muted">${p.services.join(", ") || "-"}</div></td>
                        <td>${p.services.length}</td>
                        <td>${p.total}</td>
                        <td>${p.running}</td>
                        <td>${p.stopped}</td>
                        <td>
                          <div class="actions">
                            <button class="btn btn-secondary" data-compose-action="start" data-project="${p.name}">启动</button>
                            <button class="btn btn-secondary" data-compose-action="stop" data-project="${p.name}">停止</button>
                            <button class="btn btn-secondary" data-compose-action="restart" data-project="${p.name}">重启</button>
                          </div>
                        </td>
                      </tr>
                    `
                  )
                  .join("") || "<tr><td colspan='6'>未发现 Compose 项目</td></tr>"}
              </tbody>
            </table>
          </div>
        </section>
      `;
    }

    if (state.dockerTab === "images") {
      const images = await api("/api/containers/images");
      bodyHtml = `
        <section class="card">
          <div class="actions" style="justify-content: space-between;">
            <h3 style="margin:0;">本地镜像</h3>
            <div class="actions">
              <input id="pullImageInput" placeholder="例如: nginx:latest" />
              <button id="pullImageBtn" class="btn btn-primary">拉取镜像</button>
            </div>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>标签</th><th>ID</th><th>大小</th><th>容器占用</th><th>创建时间</th><th>操作</th></tr></thead>
              <tbody>
                ${images
                  .map(
                    (img) => `
                      <tr>
                        <td>${(img.tags || []).join("<br />") || "<none>"}</td>
                        <td>${img.shortId}</td>
                        <td>${formatBytes(img.size)}</td>
                        <td>${img.containers}</td>
                        <td>${formatDate(img.createdAt)}</td>
                        <td><button class="btn btn-danger" data-image-remove="${img.id}">删除</button></td>
                      </tr>
                    `
                  )
                  .join("") || "<tr><td colspan='6'>暂无镜像</td></tr>"}
              </tbody>
            </table>
          </div>
        </section>
      `;
    }

    if (state.dockerTab === "registry") {
      bodyHtml = `
        <section class="card">
          <div class="actions">
            <input id="registrySearchInput" placeholder="搜索 Docker Hub 镜像，例如 jellyfin" />
            <button id="registrySearchBtn" class="btn btn-primary">搜索</button>
          </div>
          <div id="registrySearchResult" class="list" style="margin-top: 10px;"></div>
        </section>
      `;
    }

    if (state.dockerTab === "networks") {
      const [networks, containerSummary] = await Promise.all([
        api("/api/containers/networks"),
        api("/api/containers/summary")
      ]);

      const options = (containerSummary.containers || [])
        .map((c) => `<option value="${c.id}">${c.name}</option>`)
        .join("");

      bodyHtml = `
        <section class="card">
          <div class="actions" style="justify-content: space-between;">
            <h3 style="margin:0;">网络管理</h3>
            <div class="actions">
              <input id="networkNameInput" placeholder="新网络名称" />
              <button id="networkCreateBtn" class="btn btn-primary">新建网络</button>
            </div>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>名称</th><th>驱动</th><th>容器数</th><th>容器管理</th><th>操作</th></tr></thead>
              <tbody>
                ${networks
                  .map(
                    (n) => `
                      <tr>
                        <td>${n.name}</td>
                        <td>${n.driver}</td>
                        <td>${n.containerCount}</td>
                        <td>
                          <div class="actions">
                            <select data-network-container="${n.id}">
                              <option value="">选择容器</option>
                              ${options}
                            </select>
                            <button class="btn btn-secondary" data-network-action="connect" data-network-id="${n.id}">加入</button>
                            <button class="btn btn-secondary" data-network-action="disconnect" data-network-id="${n.id}">移出</button>
                          </div>
                        </td>
                        <td>
                          <button class="btn btn-danger" data-network-remove="${n.id}">删除</button>
                        </td>
                      </tr>
                    `
                  )
                  .join("") || "<tr><td colspan='5'>暂无网络</td></tr>"}
              </tbody>
            </table>
          </div>
        </section>
      `;
    }

    pageContentEl.innerHTML = `
      <section class="card">
        <div class="pill-tabs">
          ${tabs
            .map(
              (t) =>
                `<button class="pill-tab ${state.dockerTab === t.id ? "active" : ""}" data-docker-tab="${t.id}">${t.label}</button>`
            )
            .join("")}
        </div>
      </section>
      ${bodyHtml}
    `;

    pageContentEl.querySelectorAll("[data-docker-tab]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        state.dockerTab = btn.dataset.dockerTab;
        await renderContainers();
      });
    });

    pageContentEl.querySelectorAll("button[data-action]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const action = btn.dataset.action;
        const id = btn.dataset.id;
        try {
          if (action === "logs") {
            const name = btn.dataset.name || id;
            const logs = await api(`/api/containers/${id}/logs?lines=300`);
            openModal(`日志 - ${name}`, `<textarea readonly>${logs}</textarea>`);
            return;
          }

          if (action === "update") {
            const recreate = confirm("是否执行重建更新？\n确定=拉镜像并重建，取消=仅拉镜像");
            await api(`/api/containers/${id}/update`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ recreate })
            });
            showToast("更新请求已执行");
            await renderContainers();
            return;
          }

          await api(`/api/containers/${id}/${action}`, { method: "POST" });
          showToast(`容器${action}成功`);
          await renderContainers();
        } catch (err) {
          showToast(err.message);
        }
      });
    });

    pageContentEl.querySelectorAll("[data-compose-action]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          const project = btn.dataset.project;
          const action = btn.dataset.composeAction;
          await api(`/api/containers/compose/projects/${encodeURIComponent(project)}/${action}`, {
            method: "POST"
          });
          showToast(`项目 ${action} 完成`);
          await renderContainers();
        } catch (err) {
          showToast(err.message);
        }
      });
    });

    const pullBtn = document.getElementById("pullImageBtn");
    if (pullBtn) {
      pullBtn.addEventListener("click", async () => {
        try {
          const image = document.getElementById("pullImageInput").value.trim();
          await api("/api/containers/images/pull", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ image })
          });
          showToast("镜像拉取成功");
          await renderContainers();
        } catch (err) {
          showToast(err.message);
        }
      });
    }

    pageContentEl.querySelectorAll("[data-image-remove]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          const id = btn.dataset.imageRemove;
          await api(`/api/containers/images/${encodeURIComponent(id)}?force=1`, { method: "DELETE" });
          showToast("镜像删除成功");
          await renderContainers();
        } catch (err) {
          showToast(err.message);
        }
      });
    });

    const registryBtn = document.getElementById("registrySearchBtn");
    if (registryBtn) {
      registryBtn.addEventListener("click", async () => {
        try {
          const q = document.getElementById("registrySearchInput").value.trim();
          const result = await api(`/api/containers/registry/search?q=${encodeURIComponent(q)}&limit=20`);
          const box = document.getElementById("registrySearchResult");
          box.innerHTML =
            result.results
              .map(
                (r) => `<div class="list-item">
                  <div class="list-title">${r.name}</div>
                  <div class="text-muted">${r.shortDescription || "-"}</div>
                  <div class="text-muted">⭐ ${r.starCount} · Pulls ${r.pullCount}</div>
                  <button class="btn btn-secondary" data-registry-pull="${r.name}">拉取</button>
                </div>`
              )
              .join("") || '<div class="text-muted">无结果</div>';

          box.querySelectorAll("[data-registry-pull]").forEach((btn) => {
            btn.addEventListener("click", async () => {
              const image = btn.dataset.registryPull;
              try {
                await api("/api/containers/images/pull", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ image })
                });
                showToast(`已拉取 ${image}`);
              } catch (err) {
                showToast(err.message);
              }
            });
          });
        } catch (err) {
          showToast(err.message);
        }
      });
    }

    const createNetworkBtn = document.getElementById("networkCreateBtn");
    if (createNetworkBtn) {
      createNetworkBtn.addEventListener("click", async () => {
        try {
          const name = document.getElementById("networkNameInput").value.trim();
          await api("/api/containers/networks", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, driver: "bridge", attachable: true })
          });
          showToast("网络已创建");
          await renderContainers();
        } catch (err) {
          showToast(err.message);
        }
      });
    }

    pageContentEl.querySelectorAll("[data-network-remove]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          await api(`/api/containers/networks/${btn.dataset.networkRemove}`, { method: "DELETE" });
          showToast("网络已删除");
          await renderContainers();
        } catch (err) {
          showToast(err.message);
        }
      });
    });

    pageContentEl.querySelectorAll("[data-network-action]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          const networkId = btn.dataset.networkId;
          const action = btn.dataset.networkAction;
          const select = pageContentEl.querySelector(`[data-network-container="${networkId}"]`);
          const containerId = select?.value || "";
          if (!containerId) {
            showToast("请先选择容器");
            return;
          }
          await api(`/api/containers/networks/${networkId}/${action}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ containerId, force: true })
          });
          showToast("网络操作成功");
          await renderContainers();
        } catch (err) {
          showToast(err.message);
        }
      });
    });
  } catch (err) {
    pageContentEl.innerHTML = `<div class="card">加载失败：${err.message}</div>`;
  }
}

async function renderMedia() {
  try {
    const [data, integrations] = await Promise.all([
      api("/api/media/summary"),
      api("/api/settings/integrations")
    ]);
    const cw = data.continueWatching || [];
    const latest = data.latest || [];
    const sessions = data.sessions || [];
    const notConfigured = data.configured === false;
    const baseUrl = String(integrations.jellyfinBaseUrl || "").replace(/\/$/, "");
    const latestCards = latest.map((item) => {
      const detailUrl = baseUrl ? `${baseUrl}/web/index.html#!/details?id=${item.Id}` : "#";
      return `
        <div class="list-item">
          ${
            item.imageUrl
              ? `<img src="${item.imageUrl}" alt="${item.Name || ""}" style="width:100%;height:120px;object-fit:cover;border-radius:10px;" />`
              : ""
          }
          <div class="list-title">${item.Name || "未命名"}</div>
          <div class="text-muted">${item.Type || "-"} · ${formatDate(item.DateCreated)}</div>
          ${baseUrl ? `<a class="btn btn-secondary" href="${detailUrl}" target="_blank">打开详情</a>` : ""}
        </div>
      `;
    });

    pageContentEl.innerHTML = `
      <section class="card">
        <div class="actions" style="justify-content: space-between;">
          <div class="text-muted">活跃会话 ${data.summary.activeSessions}</div>
          <div class="actions">
            <button id="mediaRefreshBtn" class="btn btn-secondary">刷新页面</button>
            <button id="libraryRefreshBtn" class="btn btn-primary">刷新媒体库</button>
          </div>
        </div>
        ${notConfigured ? `<div class="text-muted" style="margin-top:8px;">${data.reason || "影视模块未配置，当前展示空数据。请到“设置”补全 Jellyfin 配置。"}</div>` : ""}
      </section>

      <section class="grid-3">
        <div class="card">
          <h3>继续观看</h3>
          <div class="list">
            ${cw
              .map(
                (item) => `<div class="list-item">
                  <div class="list-title">${item.Name || "未命名"}</div>
                  <div class="text-muted">进度 ${(item.UserData?.PlayedPercentage || 0).toFixed(1)}%</div>
                  ${
                    baseUrl
                      ? `<a class="btn btn-secondary" href="${baseUrl}/web/index.html#!/details?id=${item.Id}" target="_blank">继续播放</a>`
                      : ""
                  }
                </div>`
              )
              .join("") || '<div class="text-muted">暂无数据</div>'}
          </div>
        </div>
        <div class="card">
          <h3>最近添加</h3>
          <div class="grid-2">
            ${latestCards.join("") || '<div class="text-muted">暂无数据</div>'}
          </div>
        </div>
        <div class="card">
          <h3>活跃会话</h3>
          <div class="list">
            ${sessions
              .map(
                (s) => `<div class="list-item"><div class="list-title">${s.NowPlayingItem?.Name || "空闲"}</div><div class="text-muted">${s.UserName || "-"} · ${s.DeviceName || "-"}</div></div>`
              )
              .join("") || '<div class="text-muted">暂无会话</div>'}
          </div>
        </div>
      </section>
    `;

    document.getElementById("mediaRefreshBtn").addEventListener("click", renderMedia);
    document.getElementById("libraryRefreshBtn").addEventListener("click", async () => {
      try {
        await api("/api/media/refresh", { method: "POST" });
        showToast("媒体库刷新已触发");
      } catch (err) {
        showToast(err.message);
      }
    });
  } catch (err) {
    pageContentEl.innerHTML = `<div class="card">加载失败：${err.message}</div>`;
  }
}

async function renderDownloads() {
  try {
    const filters = [
      { id: "all", label: "全部" },
      { id: "downloading", label: "下载中" },
      { id: "completed", label: "完成" },
      { id: "uploading", label: "做种" },
      { id: "active", label: "活动" },
      { id: "inactive", label: "空闲" },
      { id: "paused", label: "暂停" },
      { id: "errored", label: "错误" }
    ];

    const [summaryData, tasks] = await Promise.all([
      api("/api/downloads/summary"),
      api(`/api/downloads/tasks?filter=${encodeURIComponent(state.downloadsFilter)}`)
    ]);
    const notConfigured = summaryData.configured === false;
    const selectedTask = tasks.find((t) => t.hash === state.downloadsDetailHash) || tasks[0] || null;
    state.downloadsDetailHash = selectedTask?.hash || "";

    pageContentEl.innerHTML = `
      <section class="split">
        <aside class="menu-list">
          <div class="nav-group-title" style="margin-top:0;">任务分类</div>
          ${filters
            .map(
              (f) =>
                `<button class="menu-item ${state.downloadsFilter === f.id ? "active" : ""}" data-download-filter="${f.id}">
                  ${f.label} (${f.id === "all" ? tasks.length : tasks.filter((t) => String(t.state).includes(f.id)).length})
                </button>`
            )
            .join("")}
        </aside>
        <div class="card">
          <div class="actions" style="justify-content: space-between; align-items: center;">
            <div class="text-muted">下载中 ${summaryData.summary.downloading} · 做种 ${summaryData.summary.seeding} · 完成 ${summaryData.summary.completed} · ↓${formatSpeed(summaryData.summary.dlSpeed)} ↑${formatSpeed(summaryData.summary.upSpeed)}</div>
            <div class="actions">
              <button id="downloadRefreshBtn" class="btn btn-secondary">刷新</button>
              <button id="addMagnetBtn" class="btn btn-primary">添加磁力</button>
              <button id="addTorrentBtn" class="btn btn-secondary">上传种子</button>
            </div>
          </div>
          ${notConfigured ? `<div class="text-muted" style="margin-top:8px;">${summaryData.reason || "下载模块未配置，当前展示空数据。请到“设置”补全 qBittorrent 配置。"}</div>` : ""}
          <div class="table-wrap" style="margin-top:10px;">
            <table>
              <thead>
                <tr>
                  <th>任务</th><th>状态</th><th>进度</th><th>速度</th><th>剩余</th><th>操作</th>
                </tr>
              </thead>
              <tbody>
                ${tasks
                  .map(
                    (t) => `
                    <tr data-download-row="${t.hash}" style="cursor:pointer;">
                      <td>${t.name}<div class="text-muted">${formatBytes(t.size)}</div></td>
                      <td>${t.state}</td>
                      <td><div>${(t.progress * 100).toFixed(2)}%</div><div class="progress"><span style="width:${Math.min(100, t.progress * 100)}%"></span></div></td>
                      <td>↓${formatSpeed(t.dlspeed)} ↑${formatSpeed(t.upspeed)}</td>
                      <td>${t.eta > 0 ? `${Math.round(t.eta / 60)} 分钟` : "-"}</td>
                      <td>
                        <div class="actions">
                          <button class="btn btn-secondary" data-qaction="pause" data-hash="${t.hash}">暂停</button>
                          <button class="btn btn-secondary" data-qaction="resume" data-hash="${t.hash}">继续</button>
                          <button class="btn btn-danger" data-qaction="delete" data-hash="${t.hash}">删除</button>
                        </div>
                      </td>
                    </tr>
                  `
                  )
                  .join("") || "<tr><td colspan='6'>暂无任务</td></tr>"}
              </tbody>
            </table>
          </div>
        </div>
      </section>
      <section class="card table-wrap">
        <h3>任务详情</h3>
        ${
          selectedTask
            ? `<div class="grid-3">
                <div class="list-item"><div class="list-title">名称</div><div>${selectedTask.name}</div></div>
                <div class="list-item"><div class="list-title">Hash</div><div class="text-muted">${selectedTask.hash}</div></div>
                <div class="list-item"><div class="list-title">状态</div><div>${selectedTask.state}</div></div>
                <div class="list-item"><div class="list-title">下载路径</div><div class="text-muted">${selectedTask.save_path || "-"}</div></div>
                <div class="list-item"><div class="list-title">连接数</div><div>${selectedTask.num_seeds || 0}/${selectedTask.num_leechs || 0}</div></div>
                <div class="list-item"><div class="list-title">剩余</div><div>${selectedTask.amount_left ? formatBytes(selectedTask.amount_left) : "-"}</div></div>
              </div>`
            : '<div class="text-muted">请选择一个任务查看详情</div>'
        }
      </section>
    `;

    pageContentEl.querySelectorAll("[data-download-filter]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        state.downloadsFilter = btn.dataset.downloadFilter;
        await renderDownloads();
      });
    });

    pageContentEl.querySelectorAll("[data-download-row]").forEach((row) => {
      row.addEventListener("click", async () => {
        state.downloadsDetailHash = row.dataset.downloadRow;
        await renderDownloads();
      });
    });

    document.getElementById("downloadRefreshBtn").addEventListener("click", renderDownloads);

    document.getElementById("addMagnetBtn").addEventListener("click", () => {
      openModal(
        "添加磁力任务",
        `
        <div class="list">
          <label>磁力/链接（可多行）<textarea id="magnetUrls" placeholder="magnet:?xt=..."></textarea></label>
          <label>保存路径（可选）<input id="magnetSavePath" placeholder="/srv/downloads" /></label>
          <button id="submitMagnet" class="btn btn-primary">提交</button>
        </div>
      `
      );

      document.getElementById("submitMagnet").addEventListener("click", async () => {
        try {
          const urls = document.getElementById("magnetUrls").value.trim();
          const savepath = document.getElementById("magnetSavePath").value.trim();
          await api("/api/downloads/add-magnet", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ urls, savepath })
          });
          closeModal();
          showToast("任务已添加");
          await renderDownloads();
        } catch (err) {
          showToast(err.message);
        }
      });
    });

    document.getElementById("addTorrentBtn").addEventListener("click", () => {
      openModal(
        "上传种子任务",
        `
        <div class="list">
          <label>种子文件<input id="torrentFile" type="file" accept=".torrent" /></label>
          <label>保存路径（可选）<input id="torrentSavePath" placeholder="/srv/downloads" /></label>
          <button id="submitTorrent" class="btn btn-primary">提交</button>
        </div>
      `
      );

      document.getElementById("submitTorrent").addEventListener("click", async () => {
        try {
          const fileInput = document.getElementById("torrentFile");
          if (!fileInput.files || !fileInput.files[0]) {
            showToast("请选择 .torrent 文件");
            return;
          }

          const form = new FormData();
          form.append("torrent", fileInput.files[0]);
          form.append("savepath", document.getElementById("torrentSavePath").value.trim());

          await api("/api/downloads/add-torrent", {
            method: "POST",
            body: form
          });

          closeModal();
          showToast("种子任务已添加");
          await renderDownloads();
        } catch (err) {
          showToast(err.message);
        }
      });
    });

    pageContentEl.querySelectorAll("button[data-qaction]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const action = btn.dataset.qaction;
        const hash = btn.dataset.hash;
        try {
          if (action === "delete") {
            const deleteFiles = confirm("是否同时删除文件？\n确定=删除文件，取消=仅删除任务");
            await api("/api/downloads/delete", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ hashes: hash, deleteFiles })
            });
          } else {
            await api(`/api/downloads/${action}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ hashes: hash })
            });
          }
          showToast("操作成功");
          await renderDownloads();
        } catch (err) {
          showToast(err.message);
        }
      });
    });
  } catch (err) {
    pageContentEl.innerHTML = `<div class="card">加载失败：${err.message}</div>`;
  }
}

async function renderApps() {
  try {
    const [apps, tasks, bundles] = await Promise.all([
      api("/api/apps"),
      api("/api/apps/tasks?limit=80"),
      api("/api/apps/bundles")
    ]);
    const integrations = await api("/api/settings/integrations");
    const mediaBundle = bundles.find((b) => b.id === "media-stack");
    const activeTasks = tasks.filter((t) => t.status === "queued" || t.status === "running");
    const taskByApp = new Map();
    for (const t of activeTasks) {
      if (!taskByApp.has(t.app_id)) taskByApp.set(t.app_id, t);
    }

    const appCards = apps
      .map((app) => {
        const statusText = app.installed
          ? app.running
            ? "运行中"
            : "已安装（未运行）"
          : "未安装";
        const healthText =
          app.health === "healthy" || app.health === "running"
            ? "健康"
            : app.health === "stopped"
              ? "未运行"
              : app.health === "unhealthy"
                ? "异常"
                : app.health === "not_installed"
                  ? "未安装"
                  : app.health || "未知";

        const openUrl = app.openPortKey
          ? `http://${location.hostname}:${integrations[app.openPortKey]}`
          : "";
        const activeTask = taskByApp.get(app.id);
        const busy = Boolean(activeTask);

        return `
          <div class="card">
            <h3>${app.name}</h3>
            <p class="text-muted">${app.description || ""}</p>
            <p class="text-muted">分类：${app.category || "-"}</p>
            <p class="text-muted">容器名：${app.containerName}</p>
            <p>状态：${statusText}</p>
            <p>健康：${healthText}${app.health_error ? `（${app.health_error}）` : ""}</p>
            ${
              activeTask
                ? `<div class="list-item"><div class="list-title">任务 #${activeTask.id} ${activeTask.action}</div><div class="text-muted">${activeTask.message || ""}</div><div class="progress"><span style="width:${activeTask.progress}%"></span></div></div>`
                : ""
            }
            <div class="actions">
              ${
                !app.installed
                  ? `<button class="btn btn-primary" data-app-action="install" data-app-id="${app.id}" ${busy ? "disabled" : ""}>安装</button>`
                  : `
                    <button class="btn btn-secondary" data-app-action="start" data-app-id="${app.id}" ${busy ? "disabled" : ""}>启动</button>
                    <button class="btn btn-secondary" data-app-action="stop" data-app-id="${app.id}" ${busy ? "disabled" : ""}>停止</button>
                    <button class="btn btn-secondary" data-app-action="restart" data-app-id="${app.id}" ${busy ? "disabled" : ""}>重启</button>
                    <button class="btn btn-danger" data-app-action="uninstall" data-app-id="${app.id}" ${busy ? "disabled" : ""}>卸载</button>
                    ${openUrl ? `<a class="btn btn-secondary" href="${openUrl}" target="_blank">打开</a>` : ""}
                  `
              }
            </div>
          </div>
        `;
      })
      .join("");

    pageContentEl.innerHTML = `
      <section class="card">
        <h3>应用中心</h3>
        <p class="text-muted">可在面板内一键安装/管理 Jellyfin、qBittorrent、Portainer、Watchtower。安装参数可在“设置”页调整。</p>
        ${
          mediaBundle
            ? `<div class="actions" style="margin-top: 10px;"><button class="btn btn-primary" data-bundle-install="${mediaBundle.id}">一键安装 ${mediaBundle.name}</button></div>`
            : ""
        }
      </section>
      <section class="grid-2">${appCards}</section>
      <section class="card">
        <h3>任务中心</h3>
        <div class="table-wrap">
          <table>
            <thead><tr><th>ID</th><th>应用</th><th>动作</th><th>状态</th><th>进度</th><th>信息</th><th>错误</th><th>来源</th><th>时间</th><th>操作</th></tr></thead>
            <tbody>
              ${
                tasks
                  .map(
                    (t) => `<tr>
                      <td>#${t.id}</td>
                      <td>${t.app_id}</td>
                      <td>${t.action}</td>
                      <td>${t.status}</td>
                      <td>${t.progress}%</td>
                      <td>${t.message || "-"}</td>
                      <td>${t.error_detail || "-"}</td>
                      <td>${t.retried_from ? `重试 #${t.retried_from}` : "-"}</td>
                      <td>${formatDate(t.created_at)}</td>
                      <td>
                        <div class="actions">
                          <button class="btn btn-secondary" data-task-action="logs" data-task-id="${t.id}">日志</button>
                          ${
                            t.status === "failed"
                              ? `<button class="btn btn-danger" data-task-action="retry" data-task-id="${t.id}">重试</button>`
                              : ""
                          }
                        </div>
                      </td>
                    </tr>`
                  )
                  .join("") || "<tr><td colspan='10'>暂无任务</td></tr>"
              }
            </tbody>
          </table>
        </div>
      </section>
    `;

    pageContentEl.querySelectorAll("[data-app-action]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const action = btn.dataset.appAction;
        const appId = btn.dataset.appId;
        try {
          if (action === "install") {
            const task = await api(`/api/apps/${appId}/install`, { method: "POST" });
            showToast(`任务已创建 #${task.id}`);
          } else if (action === "uninstall") {
            const removeData = confirm("是否同时删除应用数据目录？");
            const task = await api(`/api/apps/${appId}?removeData=${removeData ? "1" : "0"}`, {
              method: "DELETE"
            });
            showToast(`任务已创建 #${task.id}`);
          } else {
            const task = await api(`/api/apps/${appId}/${action}`, { method: "POST" });
            showToast(`任务已创建 #${task.id}`);
          }
          await renderApps();
        } catch (err) {
          showToast(err.message);
        }
      });
    });

    pageContentEl.querySelectorAll("[data-bundle-install]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          const bundleId = btn.dataset.bundleInstall;
          const task = await api(`/api/apps/bundles/${bundleId}/install`, {
            method: "POST"
          });
          showToast(`套件任务已创建 #${task.id}`);
          await renderApps();
        } catch (err) {
          showToast(err.message);
        }
      });
    });

    pageContentEl.querySelectorAll("[data-task-action]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const action = btn.dataset.taskAction;
        const taskId = btn.dataset.taskId;
        try {
          if (action === "retry") {
            const task = await api(`/api/apps/tasks/${taskId}/retry`, { method: "POST" });
            showToast(`重试任务已创建 #${task.id}`);
            await renderApps();
            return;
          }

          openModal(
            `任务日志 #${taskId}`,
            `<p class="text-muted">每 2 秒自动刷新，关闭弹窗后自动停止。</p><textarea id="taskLogBox" readonly></textarea>`
          );

          const textarea = document.getElementById("taskLogBox");
          let lastLen = 0;
          const loadLogs = async () => {
            const logs = await api(`/api/apps/tasks/${taskId}/logs`);
            const text = logs.logText || "";
            const shouldStickBottom =
              !textarea.value ||
              textarea.scrollTop + textarea.clientHeight + 24 >= textarea.scrollHeight ||
              text.length < lastLen;
            textarea.value = text;
            lastLen = text.length;
            if (shouldStickBottom) {
              textarea.scrollTop = textarea.scrollHeight;
            }
          };

          await loadLogs();
          state.modalTimer = setInterval(() => {
            loadLogs().catch((err) => {
              showToast(err.message);
              clearModalTimer();
            });
          }, 2000);
        } catch (err) {
          showToast(err.message);
        }
      });
    });
  } catch (err) {
    pageContentEl.innerHTML = `<div class="card">加载失败：${err.message}</div>`;
  }
}

async function renderSSL() {
  try {
    const certs = await api("/api/ssl/certs");

    pageContentEl.innerHTML = `
      <section class="card">
        <h3>签发新证书（Cloudflare DNS）</h3>
        <div class="grid-3">
          <label>主域名<input id="sslDomain" placeholder="nas.example.com" /></label>
          <label>SAN（逗号分隔）<input id="sslSans" placeholder="media.example.com,download.example.com" /></label>
          <label>通知邮箱（可选）<input id="sslEmail" placeholder="admin@example.com" /></label>
        </div>
        <div class="actions" style="margin-top: 10px;">
          <button id="issueCertBtn" class="btn btn-primary">签发证书</button>
        </div>
      </section>

      <section class="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>域名</th><th>有效期</th><th>状态</th><th>绑定路由</th><th>操作</th>
            </tr>
          </thead>
          <tbody>
            ${certs
              .map(
                (c) => `
                <tr>
                  <td>${c.domain}<div class="text-muted">${(c.sans || []).join(", ")}</div></td>
                  <td>${formatDate(c.valid_from)} ~ ${formatDate(c.valid_to)}</td>
                  <td>${c.status}</td>
                  <td>${(c.bound_routes || []).join("<br />") || "-"}</td>
                  <td>
                    <div class="actions">
                      <button class="btn btn-secondary" data-ssl-action="renew" data-id="${c.id}">续期</button>
                      <button class="btn btn-secondary" data-ssl-action="bind" data-id="${c.id}">绑定</button>
                      <a class="btn btn-secondary" href="/api/ssl/certs/${c.id}/download?type=fullchain" target="_blank">下载</a>
                      <button class="btn btn-danger" data-ssl-action="delete" data-id="${c.id}">删除</button>
                    </div>
                  </td>
                </tr>
              `
              )
              .join("")}
          </tbody>
        </table>
      </section>
    `;

    document.getElementById("issueCertBtn").addEventListener("click", async () => {
      try {
        const domain = document.getElementById("sslDomain").value.trim();
        const sans = document
          .getElementById("sslSans")
          .value.split(",")
          .map((v) => v.trim())
          .filter(Boolean);
        const email = document.getElementById("sslEmail").value.trim();

        await api("/api/ssl/certs/issue", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ domain, sans, email, autoRenew: true })
        });

        showToast("签发请求完成");
        await renderSSL();
      } catch (err) {
        showToast(err.message);
      }
    });

    pageContentEl.querySelectorAll("button[data-ssl-action]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const action = btn.dataset.sslAction;
        const id = btn.dataset.id;
        try {
          if (action === "renew") {
            await api(`/api/ssl/certs/${id}/renew`, { method: "POST" });
          } else if (action === "bind") {
            const routes = prompt("请输入绑定路由，逗号分隔", "/,/media,/downloads") || "";
            await api(`/api/ssl/certs/${id}/bind`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ routes: routes.split(",").map((v) => v.trim()).filter(Boolean) })
            });
          } else if (action === "delete") {
            if (!confirm("确认删除该证书记录？")) return;
            await api(`/api/ssl/certs/${id}`, { method: "DELETE" });
          }

          showToast("操作成功");
          await renderSSL();
        } catch (err) {
          showToast(err.message);
        }
      });
    });
  } catch (err) {
    pageContentEl.innerHTML = `<div class="card">加载失败：${err.message}</div>`;
  }
}

async function renderSettings() {
  try {
    const menus = [
      { id: "device", label: "设备信息" },
      { id: "users", label: "用户管理" },
      { id: "groups", label: "用户组" },
      { id: "storage", label: "存储空间" },
      { id: "network", label: "网络设置" },
      { id: "remote", label: "远程访问" },
      { id: "security", label: "安全性" },
      { id: "share", label: "文件共享协议" },
      { id: "integrations", label: "集成配置" },
      { id: "audit", label: "审计日志" }
    ];

    let body = "";

    if (state.systemMenu === "device" || state.systemMenu === "storage" || state.systemMenu === "network") {
      const overview = await api("/api/system/device-overview");
      if (state.systemMenu === "device") {
        body = `
          <section class="card">
            <h3>设备概览</h3>
            <div class="grid-3">
              <div class="list-item"><div class="list-title">主机名</div><div>${overview.device.hostname || "-"}</div></div>
              <div class="list-item"><div class="list-title">系统</div><div>${overview.device.distro} ${overview.device.release}</div></div>
              <div class="list-item"><div class="list-title">内核</div><div>${overview.device.kernel}</div></div>
              <div class="list-item"><div class="list-title">CPU</div><div>${overview.hardware.cpuBrand}</div></div>
              <div class="list-item"><div class="list-title">核心</div><div>${overview.hardware.physicalCores}C / ${overview.hardware.cores}T</div></div>
              <div class="list-item"><div class="list-title">内存</div><div>${formatBytes(overview.hardware.memoryTotal)}</div></div>
            </div>
          </section>
        `;
      }
      if (state.systemMenu === "storage") {
        body = `
          <section class="card">
            <h3>存储空间</h3>
            <div class="table-wrap">
              <table>
                <thead><tr><th>挂载点</th><th>文件系统</th><th>总容量</th><th>已用</th><th>可用</th><th>占用</th></tr></thead>
                <tbody>
                  ${(overview.storage || [])
                    .map(
                      (s) => `<tr>
                        <td>${s.mount}</td>
                        <td>${s.type || "-"}</td>
                        <td>${formatBytes(s.size)}</td>
                        <td>${formatBytes(s.used)}</td>
                        <td>${formatBytes(s.available)}</td>
                        <td>${Number(s.usePercent || 0).toFixed(2)}%</td>
                      </tr>`
                    )
                    .join("") || "<tr><td colspan='6'>暂无磁盘信息</td></tr>"}
                </tbody>
              </table>
            </div>
          </section>
        `;
      }
      if (state.systemMenu === "network") {
        body = `
          <section class="card">
            <h3>网卡信息</h3>
            <div class="table-wrap">
              <table>
                <thead><tr><th>接口</th><th>IPv4</th><th>IPv6</th><th>MAC</th><th>状态</th><th>速率</th><th>MTU</th></tr></thead>
                <tbody>
                  ${(overview.network.interfaces || [])
                    .map(
                      (n) => `<tr>
                        <td>${n.iface}</td>
                        <td>${n.ip4 || "-"}</td>
                        <td>${n.ip6 || "-"}</td>
                        <td>${n.mac || "-"}</td>
                        <td>${n.operstate || "-"}</td>
                        <td>${n.speed || "-"} Mbps</td>
                        <td>${n.mtu || "-"}</td>
                      </tr>`
                    )
                    .join("") || "<tr><td colspan='7'>暂无网卡信息</td></tr>"}
                </tbody>
              </table>
            </div>
          </section>
        `;
      }
    }

    if (state.systemMenu === "users") {
      const users = await api("/api/system/users");
      body = `
        <section class="card">
          <div class="actions" style="justify-content: space-between;">
            <h3 style="margin:0;">用户管理</h3>
            <div class="actions">
              <input id="newUserName" placeholder="用户名" />
              <input id="newUserPass" placeholder="初始密码(>=8位)" />
              <select id="newUserRole"><option value="user">user</option><option value="admin">admin</option></select>
              <button id="createUserBtn" class="btn btn-primary">新建用户</button>
            </div>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>ID</th><th>用户名</th><th>角色</th><th>用户组</th><th>操作</th></tr></thead>
              <tbody>
                ${users
                  .map(
                    (u) => `<tr>
                      <td>${u.id}</td>
                      <td>${u.username}</td>
                      <td>${u.role}</td>
                      <td>${(u.groups || []).join(", ") || "-"}</td>
                      <td>
                        <div class="actions">
                          <button class="btn btn-secondary" data-user-role="${u.id}" data-next-role="${u.role === "admin" ? "user" : "admin"}">切换角色</button>
                          <button class="btn btn-secondary" data-user-reset="${u.id}">重置密码</button>
                          <button class="btn btn-danger" data-user-delete="${u.id}">删除</button>
                        </div>
                      </td>
                    </tr>`
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </section>
      `;
    }

    if (state.systemMenu === "groups") {
      const [groups, users] = await Promise.all([api("/api/system/groups"), api("/api/system/users")]);
      const userOptions = users.map((u) => `<option value="${u.id}">${u.username}</option>`).join("");
      body = `
        <section class="card">
          <div class="actions" style="justify-content: space-between;">
            <h3 style="margin:0;">用户组管理</h3>
            <div class="actions">
              <input id="newGroupName" placeholder="新用户组名称" />
              <input id="newGroupDesc" placeholder="描述" />
              <button id="createGroupBtn" class="btn btn-primary">新建用户组</button>
            </div>
          </div>
          <div class="list">
            ${groups
              .map(
                (g) => `<div class="list-item">
                  <div class="actions" style="justify-content: space-between;">
                    <div><div class="list-title">${g.name}</div><div class="text-muted">${g.description || "-"}</div></div>
                    <button class="btn btn-danger" data-group-delete="${g.id}">删除</button>
                  </div>
                  <div class="text-muted">成员：${(g.members || []).map((m) => m.username).join(", ") || "无"}</div>
                  <div class="actions">
                    <select data-group-user="${g.id}">
                      <option value="">选择用户</option>
                      ${userOptions}
                    </select>
                    <button class="btn btn-secondary" data-group-add="${g.id}">添加成员</button>
                  </div>
                </div>`
              )
              .join("") || '<div class="text-muted">暂无用户组</div>'}
          </div>
        </section>
      `;
    }

    if (state.systemMenu === "remote") {
      const [remote, ddns] = await Promise.all([api("/api/system/remote"), api("/api/system/ddns")]);
      body = `
        <section class="card">
          <h3>远程访问配置</h3>
          <div class="grid-2">
            <label>启用远程访问<select id="remoteEnabled"><option value="1" ${remote.enabled ? "selected" : ""}>启用</option><option value="0" ${!remote.enabled ? "selected" : ""}>禁用</option></select></label>
            <label>服务商<input id="remoteProvider" value="${remote.provider || "cloudflare"}" /></label>
            <label>域名<input id="remoteDomain" value="${remote.domain || ""}" /></label>
            <label>Token<input id="remoteToken" placeholder="${remote.tokenMasked || "可留空"}" /></label>
          </div>
          <div class="actions" style="margin-top:10px;"><button id="saveRemoteBtn" class="btn btn-primary">保存远程配置</button></div>
        </section>
        <section class="card">
          <h3>DDNS 记录</h3>
          <div class="actions">
            <input id="ddnsDomain" placeholder="域名，例如 nas.example.com" />
            <input id="ddnsIP" placeholder="IP，可留空" />
            <button id="addDdnsBtn" class="btn btn-primary">新增记录</button>
          </div>
          <div class="table-wrap" style="margin-top:10px;">
            <table>
              <thead><tr><th>ID</th><th>服务商</th><th>域名</th><th>IP</th><th>状态</th><th>更新时间</th><th>操作</th></tr></thead>
              <tbody>
                ${ddns
                  .map(
                    (r) => `<tr><td>${r.id}</td><td>${r.provider}</td><td>${r.domain}</td><td>${r.ip_address || "-"}</td><td>${r.status}</td><td>${formatDate(r.updated_at)}</td><td><button class="btn btn-danger" data-ddns-delete="${r.id}">删除</button></td></tr>`
                  )
                  .join("") || "<tr><td colspan='7'>暂无记录</td></tr>"}
              </tbody>
            </table>
          </div>
        </section>
      `;
    }

    if (state.systemMenu === "security" || state.systemMenu === "share") {
      const services = await api("/api/system/services");
      const keys =
        state.systemMenu === "security"
          ? [
              ["sshEnabled", "SSH"],
              ["firewallEnabled", "防火墙"],
              ["notifyEnabled", "通知"],
              ["autoUpdateEnabled", "自动更新"]
            ]
          : [
              ["smbEnabled", "SMB"],
              ["webdavEnabled", "WebDAV"],
              ["ftpEnabled", "FTP"],
              ["nfsEnabled", "NFS"],
              ["dlnaEnabled", "DLNA"]
            ];
      body = `
        <section class="card">
          <h3>${state.systemMenu === "security" ? "安全性" : "文件共享协议"}</h3>
          <div class="grid-2">
            ${keys
              .map(
                ([key, label]) => `
                  <label>${label}
                    <select data-service-key="${key}">
                      <option value="1" ${services[key] ? "selected" : ""}>启用</option>
                      <option value="0" ${!services[key] ? "selected" : ""}>禁用</option>
                    </select>
                  </label>`
              )
              .join("")}
          </div>
          <div class="actions" style="margin-top:10px;">
            <button id="saveServiceSwitchBtn" class="btn btn-primary">保存开关</button>
          </div>
        </section>
      `;
    }

    if (state.systemMenu === "integrations") {
      const integrations = await api("/api/settings/integrations");
      body = `
        <section class="card">
          <h3>集成配置</h3>
          <div class="grid-2">
            <label>Jellyfin 地址<input id="s_jellyfinBaseUrl" value="${integrations.jellyfinBaseUrl || ""}" /></label>
            <label>Jellyfin API Key<input id="s_jellyfinApiKey" value="${integrations.jellyfinApiKey || ""}" /></label>
            <label>Jellyfin User ID<input id="s_jellyfinUserId" value="${integrations.jellyfinUserId || ""}" /></label>
            <label>qB 地址<input id="s_qbBaseUrl" value="${integrations.qbBaseUrl || ""}" /></label>
            <label>qB 用户名<input id="s_qbUsername" value="${integrations.qbUsername || ""}" /></label>
            <label>qB 密码<input id="s_qbPassword" value="${integrations.qbPassword || ""}" /></label>
            <label>媒体目录<input id="s_mediaPath" value="${integrations.mediaPath || "/srv/media"}" /></label>
            <label>下载目录<input id="s_downloadsPath" value="${integrations.downloadsPath || "/srv/downloads"}" /></label>
            <label>Docker 数据目录<input id="s_dockerDataPath" value="${integrations.dockerDataPath || "/srv/docker"}" /></label>
            <label>Jellyfin 对外端口<input id="s_jellyfinHostPort" type="number" value="${integrations.jellyfinHostPort || 18096}" /></label>
            <label>qB Web 端口<input id="s_qbWebPort" type="number" value="${integrations.qbWebPort || 18080}" /></label>
            <label>qB Peer 端口<input id="s_qbPeerPort" type="number" value="${integrations.qbPeerPort || 16881}" /></label>
            <label>Portainer 端口<input id="s_portainerHostPort" type="number" value="${integrations.portainerHostPort || 19000}" /></label>
            <label>Watchtower 间隔(秒)<input id="s_watchtowerInterval" type="number" value="${integrations.watchtowerInterval || 86400}" /></label>
          </div>
          <div class="actions" style="margin-top:10px;">
            <button id="saveSettingsBtn" class="btn btn-primary">保存设置</button>
          </div>
        </section>
      `;
    }

    if (state.systemMenu === "audit") {
      const auditLogs = await api("/api/settings/audit-logs?limit=200");
      body = `
        <section class="card">
          <h3>审计日志</h3>
          <div class="table-wrap">
            <table>
              <thead><tr><th>时间</th><th>操作</th><th>执行人</th><th>目标</th><th>状态</th><th>详情</th></tr></thead>
              <tbody>
                ${auditLogs
                  .map(
                    (l) => `<tr><td>${formatDate(l.created_at)}</td><td>${l.action}</td><td>${l.actor}</td><td>${l.target || "-"}</td><td>${l.status}</td><td>${l.detail || "-"}</td></tr>`
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </section>
      `;
    }

    pageContentEl.innerHTML = `
      <section class="split">
        <aside class="menu-list">
          ${menus
            .map(
              (m) =>
                `<button class="menu-item ${state.systemMenu === m.id ? "active" : ""}" data-system-menu="${m.id}">${m.label}</button>`
            )
            .join("")}
        </aside>
        <div class="list">${body}</div>
      </section>
    `;

    pageContentEl.querySelectorAll("[data-system-menu]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        state.systemMenu = btn.dataset.systemMenu;
        await renderSettings();
      });
    });

    const saveIntegrationBtn = document.getElementById("saveSettingsBtn");
    if (saveIntegrationBtn) {
      saveIntegrationBtn.addEventListener("click", async () => {
        try {
          const payload = {
            jellyfinBaseUrl: document.getElementById("s_jellyfinBaseUrl").value.trim(),
            jellyfinApiKey: document.getElementById("s_jellyfinApiKey").value.trim(),
            jellyfinUserId: document.getElementById("s_jellyfinUserId").value.trim(),
            qbBaseUrl: document.getElementById("s_qbBaseUrl").value.trim(),
            qbUsername: document.getElementById("s_qbUsername").value.trim(),
            qbPassword: document.getElementById("s_qbPassword").value.trim(),
            mediaPath: document.getElementById("s_mediaPath").value.trim(),
            downloadsPath: document.getElementById("s_downloadsPath").value.trim(),
            dockerDataPath: document.getElementById("s_dockerDataPath").value.trim(),
            jellyfinHostPort: Number(document.getElementById("s_jellyfinHostPort").value || 18096),
            qbWebPort: Number(document.getElementById("s_qbWebPort").value || 18080),
            qbPeerPort: Number(document.getElementById("s_qbPeerPort").value || 16881),
            portainerHostPort: Number(document.getElementById("s_portainerHostPort").value || 19000),
            watchtowerInterval: Number(document.getElementById("s_watchtowerInterval").value || 86400)
          };
          await api("/api/settings/integrations", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          });
          showToast("集成配置已保存");
        } catch (err) {
          showToast(err.message);
        }
      });
    }

    const createUserBtn = document.getElementById("createUserBtn");
    if (createUserBtn) {
      createUserBtn.addEventListener("click", async () => {
        try {
          await api("/api/system/users", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              username: document.getElementById("newUserName").value.trim(),
              password: document.getElementById("newUserPass").value.trim(),
              role: document.getElementById("newUserRole").value
            })
          });
          showToast("用户已创建");
          await renderSettings();
        } catch (err) {
          showToast(err.message);
        }
      });
    }

    pageContentEl.querySelectorAll("[data-user-role]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          await api(`/api/system/users/${btn.dataset.userRole}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ role: btn.dataset.nextRole })
          });
          showToast("角色已更新");
          await renderSettings();
        } catch (err) {
          showToast(err.message);
        }
      });
    });

    pageContentEl.querySelectorAll("[data-user-reset]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const password = prompt("请输入新密码（至少8位）", "");
        if (!password) return;
        try {
          await api(`/api/system/users/${btn.dataset.userReset}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password })
          });
          showToast("密码已重置");
        } catch (err) {
          showToast(err.message);
        }
      });
    });

    pageContentEl.querySelectorAll("[data-user-delete]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          await api(`/api/system/users/${btn.dataset.userDelete}`, { method: "DELETE" });
          showToast("用户已删除");
          await renderSettings();
        } catch (err) {
          showToast(err.message);
        }
      });
    });

    const createGroupBtn = document.getElementById("createGroupBtn");
    if (createGroupBtn) {
      createGroupBtn.addEventListener("click", async () => {
        try {
          await api("/api/system/groups", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: document.getElementById("newGroupName").value.trim(),
              description: document.getElementById("newGroupDesc").value.trim()
            })
          });
          showToast("用户组已创建");
          await renderSettings();
        } catch (err) {
          showToast(err.message);
        }
      });
    }

    pageContentEl.querySelectorAll("[data-group-delete]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          await api(`/api/system/groups/${btn.dataset.groupDelete}`, { method: "DELETE" });
          showToast("用户组已删除");
          await renderSettings();
        } catch (err) {
          showToast(err.message);
        }
      });
    });

    pageContentEl.querySelectorAll("[data-group-add]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          const groupId = btn.dataset.groupAdd;
          const select = pageContentEl.querySelector(`[data-group-user="${groupId}"]`);
          const userId = select?.value || "";
          if (!userId) {
            showToast("请选择用户");
            return;
          }
          await api(`/api/system/groups/${groupId}/members`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId })
          });
          showToast("成员已添加");
          await renderSettings();
        } catch (err) {
          showToast(err.message);
        }
      });
    });

    const saveRemoteBtn = document.getElementById("saveRemoteBtn");
    if (saveRemoteBtn) {
      saveRemoteBtn.addEventListener("click", async () => {
        try {
          await api("/api/system/remote", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              enabled: document.getElementById("remoteEnabled").value === "1",
              provider: document.getElementById("remoteProvider").value.trim(),
              domain: document.getElementById("remoteDomain").value.trim(),
              token: document.getElementById("remoteToken").value.trim()
            })
          });
          showToast("远程访问配置已保存");
        } catch (err) {
          showToast(err.message);
        }
      });
    }

    const addDdnsBtn = document.getElementById("addDdnsBtn");
    if (addDdnsBtn) {
      addDdnsBtn.addEventListener("click", async () => {
        try {
          await api("/api/system/ddns", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              provider: "cloudflare",
              domain: document.getElementById("ddnsDomain").value.trim(),
              ipAddress: document.getElementById("ddnsIP").value.trim(),
              status: "success"
            })
          });
          showToast("DDNS 记录已添加");
          await renderSettings();
        } catch (err) {
          showToast(err.message);
        }
      });
    }

    pageContentEl.querySelectorAll("[data-ddns-delete]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          await api(`/api/system/ddns/${btn.dataset.ddnsDelete}`, { method: "DELETE" });
          showToast("DDNS 记录已删除");
          await renderSettings();
        } catch (err) {
          showToast(err.message);
        }
      });
    });

    const saveServiceSwitchBtn = document.getElementById("saveServiceSwitchBtn");
    if (saveServiceSwitchBtn) {
      saveServiceSwitchBtn.addEventListener("click", async () => {
        try {
          const payload = {};
          pageContentEl.querySelectorAll("[data-service-key]").forEach((el) => {
            payload[el.dataset.serviceKey] = el.value === "1";
          });
          await api("/api/system/services", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          });
          showToast("服务开关已保存");
        } catch (err) {
          showToast(err.message);
        }
      });
    }
  } catch (err) {
    pageContentEl.innerHTML = `<div class="card">加载失败：${err.message}</div>`;
  }
}

document.getElementById("navMenu").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-page]");
  if (!btn) return;
  await navigate(btn.dataset.page);
});

document.getElementById("refreshBtn").addEventListener("click", async () => {
  await navigate(state.page);
});

document.getElementById("logoutBtn").addEventListener("click", async () => {
  try {
    await api("/api/auth/logout", { method: "POST" });
  } catch {
    // noop
  }
  forceLogout();
});

document.getElementById("logoutBtnSide").addEventListener("click", async () => {
  try {
    await api("/api/auth/logout", { method: "POST" });
  } catch {
    // noop
  }
  forceLogout();
});

document.getElementById("globalSearch").addEventListener("keydown", async (e) => {
  if (e.key !== "Enter") return;
  const keyword = String(e.target.value || "").toLowerCase().trim();
  if (!keyword) return;
  const map = {
    dashboard: ["总览", "dashboard", "仪表盘"],
    containers: ["docker", "容器", "compose", "镜像", "网络"],
    downloads: ["下载", "qb", "torrent"],
    media: ["影视", "jellyfin", "媒体"],
    apps: ["应用", "app"],
    ssl: ["ssl", "证书", "https"],
    settings: ["设置", "系统", "用户", "存储", "网络", "安全"]
  };
  const found = Object.entries(map).find(([, arr]) => arr.some((k) => keyword.includes(k.toLowerCase())));
  if (found) {
    await navigate(found[0]);
  } else {
    showToast("未匹配到模块");
  }
});

document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  const username = String(form.get("username") || "").trim();
  const password = String(form.get("password") || "").trim();
  const remember = Boolean(form.get("remember"));

  try {
    const data = await api("/api/auth/login", {
      skipAuthHandling: true,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });

    state.token = data.token;
    state.user = data.user;
    localStorage.setItem("arknas_last_user", username);
    localStorage.setItem("arknas_remember", remember ? "1" : "0");
    if (remember) {
      localStorage.setItem("arknas_token", state.token);
      sessionStorage.removeItem("arknas_token");
    } else {
      sessionStorage.setItem("arknas_token", state.token);
      localStorage.removeItem("arknas_token");
    }
    setAuthedUI(true);
    showToast(`欢迎，${state.user.username}`);
    await navigate("dashboard");
  } catch (err) {
    showToast(err.message);
  }
});

document.getElementById("togglePasswordBtn").addEventListener("click", () => {
  const input = document.getElementById("loginPassword");
  if (!input) return;
  const toText = input.type === "password";
  input.type = toText ? "text" : "password";
  document.getElementById("togglePasswordBtn").textContent = toText ? "隐藏" : "显示";
});

document.getElementById("forgotPasswordBtn").addEventListener("click", () => {
  openModal(
    "重置管理员密码",
    `<div class="list">
      <div class="list-item">
        <div class="list-title">服务器执行以下命令：</div>
        <textarea readonly>cd ~/arknas-hub
./scripts/manage.sh reset-admin-password 'NewStrongPassword123' admin
./scripts/manage.sh restart</textarea>
      </div>
      <div class="text-muted">密码至少 8 位。该操作会更新数据库中的管理员密码。</div>
    </div>`
  );
});

initLoginFormState();
bootstrapAuth();
