const STORAGE_KEY = "jingyang-sales-workspace-v2";
const LEGACY_STORAGE_KEY = "jingyang-sales-workspace-v1";
const IMPORT_VERSION = "customers-mobile-topbar-2026-06-26-v1";
const CLOUD_CONFIG_KEY = "jingyang-cloud-config-v1";
const REMEMBER_ME_KEY = "jingyang-remember-me-v1";
const GOOGLE_DRIVE_FOLDER_ID = "1eOqcHag3qUO_Cd7n2Hv4A4Q3K8NKgXvB";

const initialState = {
  activeSalesOwner: "all",
  salesOwners: ["蔡", "倫", "豪", "001", "002"],
  importVersion: "",
  stores: [],
  holds: [],
  photos: [],
  currentUser: null,
  currentPermissions: null,
};

let state = loadState();
mergeImportedStores();
let cloudConfig = loadCloudConfig();
let editingStoreId = null;

const views = {
  home: document.querySelector("#homeView"),
  stores: document.querySelector("#storesView"),
  holds: document.querySelector("#holdsView"),
  photos: document.querySelector("#photosView"),
  salesReport: document.querySelector("#salesReportView"),
  inventory: document.querySelector("#inventoryView"),
  admin: document.querySelector("#adminView"),
};

const viewNames = {
  home: "勁揚業務管家",
  stores: "店家",
  holds: "保留物品",
  photos: "上架拍照存檔",
  salesReport: "業績分析",
  inventory: "庫存查詢",
  admin: "後台管理",
};

document.addEventListener("click", (event) => {
  const viewButton = event.target.closest("[data-view]");
  if (!viewButton) return;
  setView(viewButton.dataset.view);
});

document.querySelector("#salesFilter").addEventListener("change", (event) => {
  state.activeSalesOwner = event.target.value;
  saveState();
  render();
});

setupStoreCombo("storeName");
setupStoreCombo("holdStore");
setupStoreCombo("photoStore");

document.querySelector("#storeForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const name = form.get("name").trim();
  const phone = form.get("phone").trim();
  const address = form.get("address").trim();
  const salesOwner = form.get("salesOwner");
  const note = form.get("note").trim();

  if (editingStoreId) {
    const store = state.stores.find((s) => s.id === editingStoreId);
    if (store) {
      if (store.salesOwner !== salesOwner) {
        store.ownerEdited = true;
      }
      store.name = name;
      store.phone = phone;
      store.address = address;
      store.salesOwner = salesOwner;
      store.note = note;
      store.edited = true;
      store.updatedAt = new Date().toISOString();
      toast("店家資料已更新");
    } else {
      toast("更新失敗，找不到店家");
    }
    cancelEditStore();
  } else {
    state.stores.unshift({
      id: crypto.randomUUID(),
      name,
      phone,
      address,
      salesOwner,
      note,
      createdAt: new Date().toISOString(),
    });
    event.currentTarget.reset();
    toast("店家資料已儲存");
  }
  saveState();
  render();
});

document.querySelector("#storeCancelButton")?.addEventListener("click", () => {
  cancelEditStore();
});

document.querySelector("#loginForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const username = String(form.get("username") || "").trim();
  const password = String(form.get("password") || "");
  const submitButton = event.currentTarget.querySelector("button[type='submit']");

  let apiUrl = getCloudApiUrl();
  const inputUrl = String(document.querySelector("#loginApiUrlInput")?.value || "").trim();
  
  if (!apiUrl && inputUrl) {
    apiUrl = inputUrl;
    cloudConfig.apiUrl = inputUrl;
    saveCloudConfig();
    toast("已為您自動儲存 API 連線網址");
  }

  if (!apiUrl) {
    toast("請先在下方「API 連線設定」中儲存 Apps Script 網址");
    return;
  }

  submitButton.disabled = true;
  submitButton.textContent = "登入中...";

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        action: "login",
        username,
        password
      })
    });
    const text = await response.text();
    let result;
    try {
      result = JSON.parse(text);
    } catch {
      throw new Error("API 登入回應格式不正確，請檢查 URL");
    }

    if (!result.ok) {
      throw new Error(result.error || "登入失敗，請檢查帳號密碼");
    }

    state.currentUser = result.user;
    state.currentPermissions = result.permissions;

    const rememberCheckbox = document.querySelector("#loginRememberMe");
    if (rememberCheckbox && rememberCheckbox.checked) {
      localStorage.setItem(REMEMBER_ME_KEY, JSON.stringify({ username, password }));
    } else {
      localStorage.removeItem(REMEMBER_ME_KEY);
    }

    if (!state.currentPermissions.canViewAllStores) {
      state.activeSalesOwner = state.currentUser.salesOwner;
    }

    saveState();
    render();
    toast("登入成功！歡迎 " + (state.currentUser.displayName || state.currentUser.username));
    setView("home");
  } catch (error) {
    toast(error.message || "登入連線失敗，請檢查網路或 API 網址");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "確認登入";
  }
});

document.querySelector("#loginSaveApiButton")?.addEventListener("click", () => {
  const url = String(document.querySelector("#loginApiUrlInput")?.value || "").trim();
  cloudConfig.apiUrl = url;
  saveCloudConfig();
  toast(url ? "連線網址儲存成功" : "已清除連線網址");
});

document.querySelector("#logoutButton")?.addEventListener("click", () => {
  if (!confirm("確定要登出系統嗎？")) return;
  state.currentUser = null;
  state.currentPermissions = null;
  state.activeSalesOwner = "all";
  saveState();
  render();
  toast("已登出帳號");
});

document.querySelector("#holdForm").addEventListener("submit", (event) => {
  event.preventDefault();
  syncHoldStoreIdFromInput();
  const form = new FormData(event.currentTarget);
  const storeId = form.get("storeId");
  if (!storeId) {
    toast("請從店家欄位選擇一筆店家資料");
    return;
  }
  const holdDate = form.get("holdDate");
  const reservationStatus = form.get("reservationStatus");
  const note = form.get("note").trim();
  const holdTiming = buildHoldTiming({
    holdDate,
    reservationStatus,
    item: form.get("item").trim(),
    note,
  });
  state.holds.unshift({
    id: crypto.randomUUID(),
    storeId,
    item: form.get("item").trim(),
    quantity: form.get("quantity").trim(),
    reservationStatus,
    holdAddress: form.get("holdAddress").trim(),
    holdDate,
    dueDate: holdTiming.expiresAt,
    expiresAt: holdTiming.expiresAt,
    reminderAt: holdTiming.reminderAt,
    reminderRule: holdTiming.rule,
    note,
    status: "open",
    createdAt: new Date().toISOString(),
  });
  event.currentTarget.reset();
  saveState();
  render();
  toast("保留物品提醒已建立");
});

document.querySelector("#photoCategorySelect")?.addEventListener("change", updatePhotoUploadRequirement);

document.querySelector("#salesOwnerForm")?.addEventListener("submit", (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const ownerName = String(form.get("ownerName") || "").trim();
  if (!ownerName) return;
  if (state.salesOwners.includes(ownerName)) {
    toast("這個業務名稱已存在");
    return;
  }
  state.salesOwners.push(ownerName);
  event.currentTarget.reset();
  saveState();
  render();
  toast("業務已新增");
});

document.querySelector("#photoForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = event.currentTarget.querySelector("button[type='submit']");
  submitButton.disabled = true;
  submitButton.textContent = "照片處理中...";
  try {
    syncPhotoStoreIdFromInput();
    const form = new FormData(event.currentTarget);
    const storeId = form.get("storeId");
    if (!storeId) {
      toast("請從店家欄位選擇一筆店家資料");
      return;
    }
    const category = form.get("category");
    const note = form.get("note").trim();

    if (category === "下架") {
      const removed = state.photos.filter((photo) => photo.storeId === storeId).length;
      state.photos = state.photos.filter((photo) => photo.storeId !== storeId);
      event.currentTarget.reset();
      updatePhotoUploadRequirement();
      saveState();
      render();
      if (getCloudApiUrl()) await pushSnapshotToCloud();
      toast(removed ? `已下架並刪除 ${removed} 筆照片資訊` : "已下架，目前沒有照片資訊需要刪除");
      return;
    }

    const file = form.get("photo");
    const thumbnail = await resizeImageFile(file, 420, 0.68);
    const uploadImage = await resizeImageFile(file, 1600, 0.78);
    const photo = {
      id: crypto.randomUUID(),
      storeId,
      category,
      note,
      image: thumbnail,
      createdAt: new Date().toISOString(),
      cloudStatus: getCloudApiUrl() ? "uploading" : "local",
    };
    state.photos.unshift(photo);
    event.currentTarget.reset();
    updatePhotoUploadRequirement();
    saveState();
    render();
    toast(getCloudApiUrl() ? "照片已存本機，正在上傳 Google Drive" : "照片已存本機，設定雲端後可上傳 Drive");
    if (getCloudApiUrl()) await uploadPhotoToCloud(photo, uploadImage);
  } catch (error) {
    toast(error.message || "照片處理失敗");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "存入照片檔案";
  }
});

document.querySelector("#seedButton").addEventListener("click", () => {
  if (state.holds.length || state.photos.length) {
    toast("已有資料，未覆蓋目前內容");
    return;
  }
  const store = getVisibleStores()[0] || state.stores[0];
  if (!store) {
    toast("請先同步店家資料");
    return;
  }
  state.holds = [{
    id: crypto.randomUUID(),
    storeId: store.id,
    item: "A-1024、岩板系列",
    holdAddress: store.address || "台北市中山區南京東路一段 88 號",
    holdDate: toDateInput(new Date()),
    dueDate: toDateInput(addMonths(new Date(), 2)),
    expiresAt: toDateInput(addMonths(new Date(), 2)),
    reminderAt: toDateInput(addDays(addMonths(new Date(), 2), -7)),
    note: "保留物品期限為兩個月，到期前一週提醒所屬業務確認。",
    status: "open",
    createdAt: new Date().toISOString(),
  }];
  saveState();
  render();
  toast("範例保留提醒已建立");
});

document.querySelector("#importSheetButton").addEventListener("click", () => {
  const before = state.stores.length;
  state.importVersion = "";
  mergeImportedStores();
  render();
  toast(`已同步 ${state.stores.length - before} 筆新店家資料`);
});

document.querySelector("#exportButton").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `jingyang-sales-export-${toDateInput(new Date())}.json`;
  link.click();
  URL.revokeObjectURL(url);
});

document.querySelector("#clearButton").addEventListener("click", () => {
  if (!confirm("確定要清空目前瀏覽器內的資料嗎？")) return;
  state = { ...initialState };
  saveState();
  render();
  setView("home");
  toast("本機資料已清空");
});

document.querySelector("#cloudConfigForm")?.addEventListener("submit", (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  cloudConfig.apiUrl = String(form.get("cloudApiUrl") || "").trim();
  saveCloudConfig();
  renderCloudStatus();
  toast(cloudConfig.apiUrl ? "Google 雲端連線已儲存" : "已清除雲端連線");
});

document.querySelector("#cloudSetupButton")?.addEventListener("click", async () => {
  await runCloudTask("正在建立 Google 後台...", setupCloudBackend);
});

document.querySelector("#cloudSyncButton")?.addEventListener("click", async () => {
  await runCloudTask("正在從雲端同步...", syncFromCloud);
});

document.querySelector("#cloudPushButton")?.addEventListener("click", async () => {
  await runCloudTask("正在上傳目前資料...", pushSnapshotToCloud);
});

document.addEventListener("click", (event) => {
  const storeCard = event.target.closest(".store-card");
  if (storeCard && !event.target.closest("button") && !event.target.closest("[data-action]")) {
    const deleteBtn = storeCard.querySelector("[data-action='delete-store']");
    if (deleteBtn && deleteBtn.dataset.id) {
      startEditStore(deleteBtn.dataset.id);
      return;
    }
  }

  const action = event.target.closest("[data-action]");
  if (!action) return;
  const { action: actionName, id } = action.dataset;

  if (actionName === "done") {
    const hold = state.holds.find((item) => item.id === id);
    if (!hold) {
      toast("找不到這筆保留資料");
      return;
    }
    hold.status = hold.status === "done" ? "open" : "done";
    saveState();
    render();
    toast(hold.status === "done" ? "保留提醒已標記完成" : "保留提醒已重新開啟");
  }
  if (actionName === "delete-store") {
    if (editingStoreId === id) {
      cancelEditStore();
    }
    state.stores = state.stores.filter((store) => store.id !== id);
    state.holds = state.holds.filter((hold) => hold.storeId !== id);
    state.photos = state.photos.filter((photo) => photo.storeId !== id);
    saveState();
    render();
    toast("店家與相關資料已刪除");
  }
  if (actionName === "edit-store") {
    startEditStore(id);
    return;
  }
  if (actionName === "delete-hold") {
    const before = state.holds.length;
    state.holds = state.holds.filter((hold) => hold.id !== id);
    saveState();
    render();
    toast(before === state.holds.length ? "找不到這筆保留資料" : "保留提醒已刪除");
  }
  if (actionName === "delete-photo") {
    const before = state.photos.length;
    state.photos = state.photos.filter((photo) => photo.id !== id);
    saveState();
    render();
    toast(before === state.photos.length ? "找不到這張照片資料" : "照片資料已刪除");
  }
  if (actionName === "reload-frame") {
    reloadFrame(action.dataset.frame);
  }
  if (!["done", "delete-store", "edit-store", "delete-hold", "delete-photo", "reload-frame", "rename-sales-owner", "delete-sales-owner"].includes(actionName)) {
    toast("這個按鈕尚未設定功能");
  }
  if (actionName === "rename-sales-owner") {
    renameSalesOwner(id, action.closest(".sales-owner-row")?.querySelector("[data-owner-input]")?.value);
  }
  if (actionName === "delete-sales-owner") {
    deleteSalesOwner(id);
  }
});

function render() {
  const loginView = document.querySelector("#loginView");
  const userPill = document.querySelector("#userDisplayName");
  const logoutBtn = document.querySelector("#logoutButton");

  const loginApiUrlInput = document.querySelector("#loginApiUrlInput");
  if (loginApiUrlInput && !loginApiUrlInput.value) {
    loginApiUrlInput.value = getCloudApiUrl();
  }

  if (!state.currentUser) {
    if (loginView) loginView.classList.add("active");
    if (userPill) userPill.style.display = "none";
    if (logoutBtn) logoutBtn.style.display = "none";
    fillRememberedCredentials();
    return;
  }

  if (loginView) loginView.classList.remove("active");
  if (userPill) {
    userPill.textContent = state.currentUser.displayName || state.currentUser.username;
    userPill.style.display = "inline-flex";
  }
  if (logoutBtn) {
    logoutBtn.style.display = "inline-flex";
  }

  renderSalesOptions();
  renderCounts();
  renderSelects();
  renderStores();
  renderHolds();
  renderPhotos();
  renderHome();
  renderCloudStatus();
  renderSalesOwnerAdmin();

  const openReportLink = document.querySelector("#openOriginalReportLink");
  if (openReportLink) {
    let href = "https://script.google.com/macros/s/AKfycbwonMKbfTbmkacvvNFXbqZXIi42KcRpXLtcEaYrLqH2SPbbh7z-A9QPYR257uJ0V0ha/exec";
    const permissions = state.currentPermissions || { canViewAllStores: true };
    if (!permissions.canViewAllStores && state.currentUser && state.currentUser.salesOwner) {
      href += "?salesperson=" + encodeURIComponent(state.currentUser.salesOwner);
    }
    openReportLink.href = href;
  }
  applyRoleAesthetic();
}

function fillRememberedCredentials() {
  try {
    const saved = localStorage.getItem(REMEMBER_ME_KEY);
    if (!saved) return;
    const { username, password } = JSON.parse(saved);
    const usernameInput = document.querySelector("#loginForm input[name='username']");
    const passwordInput = document.querySelector("#loginForm input[name='password']");
    const rememberCheckbox = document.querySelector("#loginRememberMe");
    
    if (usernameInput && !usernameInput.value) usernameInput.value = username || "";
    if (passwordInput && !passwordInput.value) passwordInput.value = password || "";
    if (rememberCheckbox) rememberCheckbox.checked = true;
  } catch (e) {
    console.error("Failed to load remembered credentials", e);
  }
}

function renderCounts() {
  const visibleStores = getVisibleStores();
  const visibleStoreIds = new Set(visibleStores.map((store) => store.id));
  const visibleHolds = state.holds.filter((hold) => visibleStoreIds.has(hold.storeId));
  const visiblePhotos = state.photos.filter((photo) => visibleStoreIds.has(photo.storeId));
  const unreadCount = getUnreadReminderCount(visibleStoreIds);
  setText("#storeCount", visibleStores.length);
  setText("#holdCount", visibleHolds.filter((hold) => hold.status !== "done").length);
  setText("#photoCount", visiblePhotos.length);
  setText("#unreadCount", unreadCount);
  document.querySelector("#unreadCount")?.classList.toggle("zero", unreadCount === 0);
  setText("#adminStoreCount", `${state.stores.length} 筆`);
  setText("#adminHoldCount", `${state.holds.length} 筆`);
  setText("#adminPhotoCount", `${state.photos.length} 張`);
}

function renderSalesOptions() {
  normalizeSalesOwners();
  const permissions = state.currentPermissions || { canViewAllStores: true, visibleSalesOwner: "全部" };

  let options = [];
  if (permissions.canViewAllStores) {
    options.push(`<option value="all">全部業務</option>`);
    options.push(...state.salesOwners.map((owner) => `<option value="${escapeHtml(owner)}">${escapeHtml(owner)}</option>`));
  } else {
    options.push(`<option value="${escapeHtml(permissions.visibleSalesOwner)}">${escapeHtml(permissions.visibleSalesOwner)}</option>`);
  }

  const salesFilterSelect = document.querySelector("#salesFilter");
  if (salesFilterSelect) {
    salesFilterSelect.innerHTML = options.join("");
    if (permissions.canViewAllStores) {
      salesFilterSelect.disabled = false;
      salesFilterSelect.value = state.activeSalesOwner || "all";
    } else {
      salesFilterSelect.disabled = true;
      salesFilterSelect.value = permissions.visibleSalesOwner;
    }
  }

  const storeSalesSelect = document.querySelector("#storeSalesSelect");
  if (storeSalesSelect) {
    if (permissions.canViewAllStores) {
      storeSalesSelect.innerHTML = state.salesOwners
        .map((owner) => `<option value="${escapeHtml(owner)}">${escapeHtml(owner)}</option>`)
        .join("");
      storeSalesSelect.disabled = false;
    } else {
      storeSalesSelect.innerHTML = `<option value="${escapeHtml(permissions.visibleSalesOwner)}">${escapeHtml(permissions.visibleSalesOwner)}</option>`;
      storeSalesSelect.disabled = true;
    }
  }
}

function renderSalesOwnerAdmin() {
  const list = document.querySelector("#salesOwnerList");
  if (!list) return;
  normalizeSalesOwners();
  list.innerHTML = state.salesOwners.map((owner) => {
    const count = state.stores.filter((store) => store.salesOwner === owner).length;
    return `
      <div class="sales-owner-row">
        <input data-owner-input value="${escapeHtml(owner)}" aria-label="${escapeHtml(owner)} 業務名稱" />
        <span class="status-pill">${count} 家</span>
        <button class="small-button" data-action="rename-sales-owner" data-id="${escapeHtml(owner)}">儲存</button>
        <button class="small-button" data-action="delete-sales-owner" data-id="${escapeHtml(owner)}">刪除</button>
      </div>
    `;
  }).join("");
}

function normalizeSalesOwners() {
  if (!Array.isArray(state.salesOwners) || !state.salesOwners.length) {
    state.salesOwners = ["蔡", "倫", "豪", "001", "002"];
  }
}

function renderSelects() {
  renderComboOptions("storeName");
  renderComboOptions("holdStore");
  renderComboOptions("photoStore");
  syncHoldStoreIdFromInput();
  syncPhotoStoreIdFromInput();
}

function renderStores() {
  const list = document.querySelector("#storeList");
  const stores = getVisibleStores();
  if (!stores.length) {
    list.innerHTML = emptyState(t("尚未建立店家資料"));
    return;
  }
  list.innerHTML = stores.map((store) => `
    <article class="info-card store-card">
      ${storeReminderChip(store)}
      <div class="card-header store-card-header">
        <h2>${escapeHtml(store.name)}</h2>
      </div>
      <div class="meta">
        ${t("負責業務")}：${escapeHtml(store.salesOwner || "未分配")}<br />
        ${escapeHtml(storePhoneLine(store))}<br />
        ${escapeHtml(store.address || t("未填地址"))}<br />
        ${escapeHtml(storeInfoLine(store))}
      </div>
      <div class="card-actions">
        <button class="small-button" data-action="edit-store" data-id="${store.id}">編輯</button>
        <button class="small-button" data-action="delete-store" data-id="${store.id}">刪除</button>
      </div>
    </article>
  `).join("");
}

function startEditStore(storeId) {
  const store = getStore(storeId);
  if (!store) {
    toast("找不到店家資料");
    return;
  }
  editingStoreId = store.id;

  const form = document.querySelector("#storeForm");
  if (!form) return;

  const idInput = document.querySelector("#storeFormId");
  if (idInput) idInput.value = store.id;

  document.querySelector("#storeNameInput").value = store.name;
  form.querySelector("[name='phone']").value = store.phone || "";
  form.querySelector("[name='address']").value = store.address || "";
  document.querySelector("#storeSalesSelect").value = store.salesOwner || "蔡";
  form.querySelector("[name='note']").value = store.note || "";

  const submitBtn = document.querySelector("#storeSubmitButton");
  if (submitBtn) submitBtn.textContent = t("更新店家資料");

  const cancelBtn = document.querySelector("#storeCancelButton");
  if (cancelBtn) cancelBtn.style.display = "inline-flex";

  form.scrollIntoView({ behavior: "smooth", block: "start" });
  toast(`正在編輯：${store.name}`);
}

function cancelEditStore() {
  editingStoreId = null;
  const form = document.querySelector("#storeForm");
  if (form) form.reset();

  const idInput = document.querySelector("#storeFormId");
  if (idInput) idInput.value = "";

  const submitBtn = document.querySelector("#storeSubmitButton");
  if (submitBtn) submitBtn.textContent = t("儲存店家資料");

  const cancelBtn = document.querySelector("#storeCancelButton");
  if (cancelBtn) cancelBtn.style.display = "none";
}

function renderHolds() {
  const list = document.querySelector("#holdList");
  const ids = new Set(getVisibleStores().map((store) => store.id));
  const holds = state.holds.filter((hold) => ids.has(hold.storeId));
  if (!holds.length) {
    list.innerHTML = emptyState("尚未建立保留物品提醒");
    return;
  }
  list.innerHTML = [...holds]
    .sort((a, b) => getHoldTiming(a).expiresAt.localeCompare(getHoldTiming(b).expiresAt))
    .map((hold) => holdCard(hold))
    .join("");
}

function renderHome() {
  const due = getDueHolds();
  document.querySelector("#dueList").innerHTML = due.length
    ? due.map((hold) => holdCard(hold, true)).join("")
    : emptyState("目前沒有近期到期提醒");

  const permissions = state.currentPermissions || { canViewAllStores: true };
  const salesReportCard = document.querySelector("#salesReportCard");
  if (salesReportCard) salesReportCard.style.display = "grid";

  const adminCard = document.querySelector("#adminCard");
  if (adminCard) adminCard.style.display = permissions.canViewAllStores ? "grid" : "none";

  const navAdminButton = document.querySelector("#navAdminButton");
  if (navAdminButton) navAdminButton.style.display = permissions.canViewAllStores ? "inline-flex" : "none";

  const nav = document.querySelector(".bottom-nav");
  if (nav) {
    nav.style.gridTemplateColumns = permissions.canViewAllStores ? "repeat(5, 1fr)" : "repeat(4, 1fr)";
  }
}

function renderPhotos() {
  const list = document.querySelector("#photoFolderList");
  const stores = getVisibleStores();
  if (!stores.length) {
    list.innerHTML = emptyState(t("請先建立店家資料，再替店家上架拍照存檔"));
    return;
  }
  list.innerHTML = stores.map((store) => photoFolderCard(store)).join("");
}

function holdCard(hold, compact = false) {
  const store = getStore(hold.storeId);
  const timing = getHoldTiming(hold);
  const badge = dueBadge(hold);
  return `
    <details class="info-card hold-card" ${compact ? "open" : ""}>
      <summary class="hold-summary">
        <span class="hold-summary-text">
          <strong>${escapeHtml(store?.name || t("未指定店家"))}</strong>
          <span>保留物品：${escapeHtml(hold.item)}${hold.quantity ? ` / ${escapeHtml(hold.quantity)}` : ""}</span>
          <span>保留起始日期：${formatDate(timing.holdDate)}</span>
        </span>
        <span class="badge ${badge.type}">${badge.label}</span>
      </summary>
      <div class="meta hold-detail">
        所屬業務：${escapeHtml(store?.salesOwner || "未分配")}<br />
        收訂狀態：${escapeHtml(hold.reservationStatus || "未收訂")}<br />
        數量：${escapeHtml(hold.quantity || "未填")}<br />
        保留地址：${escapeHtml(hold.holdAddress || store?.address || "未填保留地址")}<br />
        ${timing.rule === "oneWeek" ? "一週追蹤日" : "兩個月到期日"}：${timing.expiresAt ? formatDate(timing.expiresAt) : "不留貨"}<br />
        提醒日：${timing.reminderAt ? formatDate(timing.reminderAt) : "不提醒"}<br />
        ${escapeHtml(timing.message)}<br />
        ${escapeHtml(hold.note || "無提醒備註")}
      </div>
      ${compact ? "" : `<div class="card-actions">
        <button class="small-button" data-action="done" data-id="${hold.id}">${hold.status === "done" ? "重新開啟" : "標記完成"}</button>
        <button class="small-button" data-action="delete-hold" data-id="${hold.id}">刪除</button>
      </div>`}
    </details>
  `;
}

function photoFolderCard(store) {
  const photos = state.photos.filter((photo) => photo.storeId === store.id);
  const previewHtml = photos.slice(0, 3).length
    ? photos.slice(0, 3).map((photo) => `<img src="${photo.image}" alt="${escapeHtml(store.name)}照片" />`).join("")
    : `<div class="folder-placeholder">尚無照片</div>`;
  return `
    <section class="info-card folder-card">
      <div class="card-header">
        <h2>${escapeHtml(store.name)}</h2>
        <span class="badge">${photos.length} 張</span>
      </div>
      <div class="meta">固定地址：${escapeHtml(store.address || "未填地址")}</div>
      <div class="folder-preview">${previewHtml}</div>
      <div class="photo-grid">${photos.length ? photos.map((photo) => photoCard(photo)).join("") : ""}</div>
    </section>
  `;
}

function photoCard(photo) {
  const store = getStore(photo.storeId);
  const cloudLine = photo.driveUrl
    ? `<br /><a class="inline-link" href="${escapeHtml(photo.driveUrl)}" target="_blank" rel="noopener">查看 Google Drive 照片</a>`
    : `<br />雲端狀態：${escapeHtml(cloudStatusLabel(photo.cloudStatus))}`;
  return `
    <article class="photo-card">
      <img src="${photo.image}" alt="${escapeHtml(photo.category)}照片" />
      <div class="photo-body">
        <div class="card-header">
          <h2>${escapeHtml(photo.category)}</h2>
          <span class="badge">${formatDate(photo.createdAt)}</span>
        </div>
        <div class="meta">${escapeHtml(store?.name || t("未指定店家"))}<br />${escapeHtml(photo.note || "無備註")}${cloudLine}</div>
        <button class="small-button" data-action="delete-photo" data-id="${photo.id}">刪除</button>
      </div>
    </article>
  `;
}


function loadCloudConfig() {
  try {
    return JSON.parse(localStorage.getItem(CLOUD_CONFIG_KEY)) || { apiUrl: "" };
  } catch {
    return { apiUrl: "" };
  }
}

function saveCloudConfig() {
  localStorage.setItem(CLOUD_CONFIG_KEY, JSON.stringify(cloudConfig));
}

function getCloudApiUrl() {
  return String(cloudConfig.apiUrl || "").trim();
}

function renderCloudStatus() {
  const urlInput = document.querySelector("#cloudApiUrl");
  if (urlInput && document.activeElement !== urlInput) urlInput.value = getCloudApiUrl();
  const status = document.querySelector("#cloudStatus");
  const summary = document.querySelector("#cloudSummary");
  if (!status || !summary) return;
  if (!getCloudApiUrl()) {
    status.textContent = "尚未連線";
    status.className = "status-pill";
    summary.textContent = `Drive 資料夾已設定，但尚未填入 Apps Script URL。Folder ID：${GOOGLE_DRIVE_FOLDER_ID}`;
    return;
  }
  status.textContent = "已設定";
  status.className = "status-pill connected";
  summary.textContent = `已設定雲端後台。店家 ${state.stores.length} 筆、保留 ${state.holds.length} 筆、照片 ${state.photos.length} 張，可同步到 Google Sheet / Drive。`;
}

async function runCloudTask(workingMessage, task) {
  try {
    if (!getCloudApiUrl()) {
      toast("請先貼上 Apps Script Web App URL");
      setView("admin");
      return;
    }
    toast(workingMessage);
    const result = await task();
    render();
    toast(result?.message || "雲端同步完成");
  } catch (error) {
    toast(error.message || "雲端同步失敗");
  }
}

async function setupCloudBackend() {
  return sendCloudAction("setup", {
    driveFolderId: GOOGLE_DRIVE_FOLDER_ID,
    stores: state.stores,
    salesOwners: state.salesOwners,
  });
}

async function pushSnapshotToCloud() {
  return sendCloudAction("snapshot", {
    driveFolderId: GOOGLE_DRIVE_FOLDER_ID,
    stores: state.stores,
    holds: state.holds,
    photos: state.photos.map(({ image, ...photo }) => photo),
    salesOwners: state.salesOwners,
  });
}

async function syncFromCloud() {
  const result = await sendCloudAction("readAll", { driveFolderId: GOOGLE_DRIVE_FOLDER_ID });
  if (Array.isArray(result.stores) && result.stores.length) state.stores = mergeById(state.stores, result.stores);
  if (Array.isArray(result.holds)) state.holds = mergeById(state.holds, result.holds);
  if (Array.isArray(result.photos)) state.photos = mergeById(state.photos, result.photos);
  saveState();
  return { message: "已從 Google 後台同步資料" };
}

async function uploadPhotoToCloud(photo, imageDataUrl) {
  try {
    const store = getStore(photo.storeId);
    const result = await sendCloudAction("uploadPhoto", {
      driveFolderId: GOOGLE_DRIVE_FOLDER_ID,
      photo: {
        ...photo,
        storeName: store?.name || "",
        salesOwner: store?.salesOwner || "",
        storeAddress: store?.address || "",
      },
      imageDataUrl,
    });
    Object.assign(photo, {
      cloudStatus: "uploaded",
      driveUrl: result.driveUrl,
      fileId: result.fileId,
      folderId: result.folderId,
      uploadedAt: result.uploadedAt,
    });
    saveState();
    render();
    toast("照片已上傳 Google Drive");
  } catch (error) {
    photo.cloudStatus = "failed";
    photo.cloudError = error.message;
    saveState();
    render();
    toast("照片已存本機，但雲端上傳失敗");
  }
}

async function sendCloudAction(action, payload = {}) {
  if (action === "readAll") {
    return sendCloudRead();
  }
  await sendCloudWrite(action, payload);
  const messages = {
    setup: "Google 後台建立指令已送出",
    snapshot: "目前資料已送出到 Google Sheet",
    uploadPhoto: "照片上傳指令已送出到 Google Drive",
  };
  return { ok: true, message: messages[action] || "雲端指令已送出" };
}

async function sendCloudWrite(action, payload = {}) {
  const body = JSON.stringify({ action, ...payload });
  const timeout = new Promise((_, reject) => {
    window.setTimeout(() => reject(new Error("Google 後台回應逾時，但資料可能已送出，請稍後重新整理 Google Sheet 確認。")), 20000);
  });
  await Promise.race([
    fetch(getCloudApiUrl(), {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body,
    }),
    timeout,
  ]);
}

async function sendCloudRead() {
  const response = await fetch(getCloudApiUrl(), {
    method: "GET",
    cache: "no-store",
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Google 後台讀取失敗，請直接開啟 Apps Script URL 確認是否為 JSON 畫面。");
  }
  if (!data.ok) throw new Error(data.error || "Google 後台處理失敗");
  return data;
}

function mergeById(localItems, cloudItems) {
  const merged = new Map(localItems.map((item) => [item.id, item]));
  cloudItems.forEach((item) => {
    if (!item.id) return;
    const localItem = merged.get(item.id);
    if (localItem) {
      if (localItem.edited) {
        merged.set(item.id, {
          ...item,
          ...localItem,
          edited: true
        });
      } else if (localItem.ownerEdited) {
        merged.set(item.id, {
          ...item,
          ...localItem,
          salesOwner: localItem.salesOwner,
          ownerEdited: true
        });
      } else {
        merged.set(item.id, { ...localItem, ...item });
      }
    } else {
      merged.set(item.id, item);
    }
  });
  return [...merged.values()];
}

function cloudStatusLabel(status) {
  const labels = {
    uploaded: "已上傳",
    uploading: "上傳中",
    failed: "上傳失敗",
    local: "本機暫存",
  };
  return labels[status] || "尚未上傳";
}

function resizeImageFile(file, maxSize, quality) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type?.startsWith("image/")) {
      reject(new Error("請選擇照片檔案"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const ratio = Math.min(1, maxSize / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * ratio));
        canvas.height = Math.max(1, Math.round(image.height * ratio));
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      image.onerror = () => reject(new Error("照片讀取失敗"));
      image.src = reader.result;
    };
    reader.onerror = () => reject(new Error("照片讀取失敗"));
    reader.readAsDataURL(file);
  });
}

function updatePhotoUploadRequirement() {
  const category = document.querySelector("#photoCategorySelect")?.value;
  const input = document.querySelector("#photoFileInput");
  if (!input) return;
  input.required = category !== "下架";
  input.closest("label")?.classList.toggle("is-optional", category === "下架");
}

function setView(view) {
  if (!views[view]) {
    toast("找不到這個頁面");
    return;
  }
  Object.entries(views).forEach(([name, element]) => element.classList.toggle("active", name === view));
  document.querySelectorAll("[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  
  let title = viewNames[view];
  if (state.currentUser && state.currentUser.role === "retail") {
    if (view === "stores") title = "設計公司/業主";
    if (view === "photos") title = "案場拍照存檔";
  }
  setTextSafe("#viewTitle", title);
  
  closeComboPanels();
  loadExternalFrame(view);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function loadExternalFrame(view) {
  const frameByView = { salesReport: "salesReportFrame", inventory: "inventoryFrame" };
  const frameId = frameByView[view];
  if (!frameId) return;
  const frame = document.querySelector(`#${frameId}`);
  if (frame && !frame.src) {
    let src = frame.dataset.src;
    if (view === "salesReport") {
      const permissions = state.currentPermissions || { canViewAllStores: true };
      if (!permissions.canViewAllStores && state.currentUser && state.currentUser.salesOwner) {
        src += (src.includes("?") ? "&" : "?") + "salesperson=" + encodeURIComponent(state.currentUser.salesOwner);
      }
    }
    frame.src = src;
  }
}

function reloadFrame(frameId) {
  const frame = document.querySelector(`#${frameId}`);
  if (!frame) {
    toast("找不到要重新整理的表格");
    return;
  }
  let src = frame.dataset.src;
  if (frameId === "salesReportFrame") {
    const permissions = state.currentPermissions || { canViewAllStores: true };
    if (!permissions.canViewAllStores && state.currentUser && state.currentUser.salesOwner) {
      src += (src.includes("?") ? "&" : "?") + "salesperson=" + encodeURIComponent(state.currentUser.salesOwner);
    }
  }
  frame.src = src;
  toast("已重新整理連動表");
}

function getDueHolds() {
  const today = toDateInput(new Date());
  const ids = new Set(getVisibleStores().map((store) => store.id));
  return state.holds.filter((hold) => {
    const timing = getHoldTiming(hold);
    return hold.status !== "done" && timing.reminderAt && timing.reminderAt <= today && ids.has(hold.storeId);
  });
}

function getUnreadReminderCount(storeIds = new Set(getVisibleStores().map((store) => store.id))) {
  const today = toDateInput(new Date());
  return state.holds.filter((hold) => {
    const timing = getHoldTiming(hold);
    return hold.status !== "done" && timing.reminderAt && timing.reminderAt <= today && storeIds.has(hold.storeId);
  }).length;
}

function getStoreReminderStats(storeId) {
  const today = toDateInput(new Date());
  const openHolds = state.holds.filter((hold) => hold.storeId === storeId && hold.status !== "done");
  const unread = openHolds.filter((hold) => getHoldTiming(hold).reminderAt <= today).length;
  return { total: openHolds.length, unread };
}

function storeReminderChip(store) {
  const stats = getStoreReminderStats(store.id);
  const isUnread = stats.unread > 0;
  const count = isUnread ? stats.unread : stats.total;
  const label = isUnread ? "未讀" : "提醒";
  const aria = isUnread ? `${store.name} 有 ${stats.unread} 則未讀提醒` : `${store.name} 有 ${stats.total} 個提醒`;
  return `
    <button class="reminder-chip ${isUnread ? "unread" : ""}" data-view="holds" aria-label="${escapeHtml(aria)}">
      <span class="reminder-bell" aria-hidden="true">!</span>
      <span class="reminder-number">${count}</span>
      <span class="reminder-label">${label}</span>
    </button>
  `;
}

function dueBadge(hold) {
  if (hold.status === "done") return { label: "已完成", type: "" };
  const timing = getHoldTiming(hold);
  if (timing.rule === "report") return { label: "報備", type: "" };
  const today = toDateInput(new Date());
  if (timing.expiresAt < today) return { label: timing.rule === "oneWeek" ? "需追蹤" : "已逾期", type: "danger" };
  if (timing.expiresAt === today) return { label: timing.rule === "oneWeek" ? "今日追蹤" : "今日到期", type: "danger" };
  if (timing.reminderAt <= today) return { label: timing.rule === "oneWeek" ? "一週追蹤" : "一週內到期", type: "warning" };
  return { label: timing.rule === "oneWeek" ? "一週內追蹤" : "計時中", type: "" };
}

function getHoldTiming(hold) {
  const holdDate = hold.holdDate || toDateInput(new Date());
  const timing = buildHoldTiming({
    holdDate,
    reservationStatus: hold.reservationStatus,
    item: hold.item,
    note: hold.note,
    existingExpiresAt: hold.expiresAt || hold.dueDate,
    existingReminderAt: hold.reminderAt,
    existingRule: hold.reminderRule,
  });
  if (timing.rule === "report") {
    return {
      holdDate,
      expiresAt: "",
      reminderAt: "",
      daysLeft: null,
      rule: timing.rule,
      message: "報備僅記錄案場地址，不幫忙留貨，也不列入留貨倒數。",
    };
  }
  const daysLeft = diffDays(toDateInput(new Date()), timing.expiresAt);
  let message = timing.rule === "oneWeek"
    ? `一週追蹤，倒數 ${daysLeft} 天詢問是否付訂保留`
    : `倒數 ${daysLeft} 天到期`;
  if (daysLeft < 0) message = timing.rule === "oneWeek"
    ? `已超過一週 ${Math.abs(daysLeft)} 天，請詢問是否付訂保留`
    : `已逾期 ${Math.abs(daysLeft)} 天，請立即提醒所屬業務`;
  else if (daysLeft === 0) message = timing.rule === "oneWeek"
    ? "今天滿一週，請詢問是否付訂保留"
    : "今天到期，請立即提醒所屬業務";
  else if (daysLeft <= 7 && timing.rule !== "oneWeek") message = `倒數 ${daysLeft} 天到期，請提醒所屬業務`;
  return { holdDate, expiresAt: timing.expiresAt, reminderAt: timing.reminderAt, daysLeft, rule: timing.rule, message };
}

function buildHoldTiming({ holdDate, reservationStatus, item = "", note = "", existingExpiresAt = "", existingReminderAt = "", existingRule = "" }) {
  const rule = existingRule || resolveHoldRule({ reservationStatus, item, note });
  if (rule === "report") return { rule, expiresAt: "", reminderAt: "" };
  if (existingRule && existingExpiresAt && existingReminderAt) return { rule, expiresAt: existingExpiresAt, reminderAt: existingReminderAt };
  const start = parseDateInput(holdDate);
  if (rule === "oneWeek") {
    const expiresAt = toDateInput(addDays(start, 7));
    return { rule, expiresAt, reminderAt: expiresAt };
  }
  const expiresAt = toDateInput(addMonths(start, 2));
  return { rule, expiresAt, reminderAt: toDateInput(addDays(parseDateInput(expiresAt), -7)) };
}

function resolveHoldRule({ reservationStatus, item = "", note = "" }) {
  if (reservationStatus === "報備") return "report";
  const text = normalizeSearch([item, note].filter(Boolean).join(" "));
  if (text.includes("保留一週") || text.includes("一週") || text.includes("1週") || text.includes("7天")) return "oneWeek";
  return "twoMonths";
}

function getVisibleStores() {
  const permissions = state.currentPermissions || { canViewAllStores: true, visibleSalesOwner: "全部" };
  if (!permissions.canViewAllStores) {
    return state.stores.filter((store) => store.salesOwner === permissions.visibleSalesOwner);
  }

  if (!state.activeSalesOwner || state.activeSalesOwner === "all") {
    return state.stores;
  }
  return state.stores.filter((store) => store.salesOwner === state.activeSalesOwner);
}

function renameSalesOwner(oldName, nextName) {
  const newName = String(nextName || "").trim();
  if (!oldName || !newName) return;
  if (oldName !== newName && state.salesOwners.includes(newName)) {
    toast("這個業務名稱已存在");
    return;
  }
  state.salesOwners = state.salesOwners.map((owner) => owner === oldName ? newName : owner);
  state.stores.forEach((store) => {
    if (store.salesOwner === oldName) {
      store.salesOwner = newName;
      store.ownerEdited = true;
    }
  });
  if (state.activeSalesOwner === oldName) state.activeSalesOwner = newName;
  saveState();
  render();
  toast("業務名稱已更新");
}

function deleteSalesOwner(ownerName) {
  if (!ownerName) return;
  if (["蔡", "倫", "豪"].includes(ownerName)) {
    toast("主要業務目前保留，請用改名調整");
    return;
  }
  const used = state.stores.some((store) => store.salesOwner === ownerName);
  if (used) {
    toast("此業務已有店家，請先改名或調整店家歸屬");
    return;
  }
  state.salesOwners = (state.salesOwners || []).filter((owner) => owner !== ownerName);
  if (state.activeSalesOwner === ownerName) state.activeSalesOwner = "all";
  saveState();
  render();
  toast(`已刪除業務：${ownerName}`);
}

function setupStoreCombo(combo) {
  const config = getComboConfig(combo);
  const input = document.querySelector(config?.input);
  if (!input) return;

  input.addEventListener("input", () => {
    if (config.hidden) syncStoreIdFromInput(config.input, config.hidden);
    renderComboOptions(combo, true);
  });
  input.addEventListener("focus", () => renderComboOptions(combo, false));
  input.addEventListener("change", () => {
    if (config.hidden) syncStoreIdFromInput(config.input, config.hidden);
    renderComboOptions(combo, false);
  });
}

document.addEventListener("click", (event) => {
  const toggle = event.target.closest("[data-combo-toggle]");
  if (toggle) {
    event.preventDefault();
    toggleComboPanel(toggle.dataset.comboToggle);
    return;
  }

  const pick = event.target.closest("[data-combo-pick]");
  if (pick) {
    event.preventDefault();
    const store = getStore(pick.dataset.storeId);
    if (store) selectComboStore(pick.dataset.comboPick, store);
    return;
  }

  if (!event.target.closest(".search-combo")) closeComboPanels();
});

function toggleComboPanel(combo) {
  const panel = document.querySelector(`[data-combo-panel="${combo}"]`);
  const isOpen = panel?.classList.contains("open");
  closeComboPanels();
  renderComboOptions(combo, !isOpen);
}

function closeComboPanels() {
  document.querySelectorAll(".combo-panel.open").forEach((panel) => panel.classList.remove("open"));
}

function renderComboOptions(combo, forceOpen = false) {
  const config = getComboConfig(combo);
  const input = document.querySelector(config?.input);
  const panel = document.querySelector(`[data-combo-panel="${combo}"]`);
  if (!input || !panel) return;

  const query = normalizeSearch(input.value);
  const stores = getVisibleStores();
  const matches = query ? rankedStoreMatches(query, stores, 500) : stores.slice(0, 500);

  panel.innerHTML = matches.length
    ? matches.map((store) => comboOptionButton(combo, store)).join("")
    : `<div class="combo-empty">${t("找不到符合的店家")}</div>`;

  if (forceOpen) {
    document.querySelectorAll(".combo-panel.open").forEach((openPanel) => {
      if (openPanel !== panel) openPanel.classList.remove("open");
    });
    panel.classList.add("open");
  }
}

function comboOptionButton(combo, store) {
  const subline = [store.shortName, store.salesOwner ? `${t("負責業務")}：${store.salesOwner}` : "", store.contactName]
    .filter(Boolean)
    .join("｜") || t("店家資料");
  return `
    <button class="combo-option" type="button" data-combo-pick="${combo}" data-store-id="${escapeHtml(store.id)}">
      <strong>${escapeHtml(storeOptionLabel(store))}</strong>
      <span>${escapeHtml(subline)}</span>
    </button>
  `;
}

function selectComboStore(combo, store) {
  const config = getComboConfig(combo);
  const input = document.querySelector(config?.input);
  if (!input) return;
  input.value = storeOptionLabel(store);
  if (config.hidden) document.querySelector(config.hidden).value = store.id;
  closeComboPanels();
}

function getComboConfig(combo) {
  return {
    storeName: { input: "#storeNameInput" },
    holdStore: { input: "#holdStoreInput", hidden: "#holdStoreId" },
    photoStore: { input: "#photoStoreInput", hidden: "#photoStoreId" },
  }[combo];
}

function syncHoldStoreIdFromInput() {
  syncStoreIdFromInput("#holdStoreInput", "#holdStoreId");
}

function syncPhotoStoreIdFromInput() {
  syncStoreIdFromInput("#photoStoreInput", "#photoStoreId");
}

function syncStoreIdFromInput(inputSelector, hiddenSelector) {
  const input = document.querySelector(inputSelector);
  const hidden = document.querySelector(hiddenSelector);
  if (!input || !hidden) return;
  const store = resolveStoreFromInput(input.value, getVisibleStores());
  hidden.value = store?.id || "";
}

function resolveStoreFromInput(value, stores) {
  const query = normalizeSearch(value);
  if (!query) return null;
  const exact = stores.find((store) => {
    return [
      storeOptionLabel(store),
      store.customerCode,
      store.name,
      store.shortName,
    ].filter(Boolean).some((candidate) => normalizeSearch(candidate) === query);
  });
  if (exact) return exact;
  const matches = stores.filter((store) => storeSearchText(store).includes(query));
  return matches.length === 1 ? matches[0] : null;
}

function storeSearchText(store) {
  return normalizeSearch([
    store.customerCode,
    store.name,
    store.shortName,
    store.contactName,
    store.taxId,
    store.phone,
    store.mobile,
    store.address,
    store.region,
  ].filter(Boolean).join(" "));
}

function rankedStoreMatches(query, stores, limit = 500) {
  const buckets = [[], [], [], []];
  stores.forEach((store) => {
    const code = normalizeSearch(store.customerCode);
    const shortName = normalizeSearch(store.shortName);
    const name = normalizeSearch(store.name);
    if (code.startsWith(query)) buckets[0].push(store);
    else if (shortName.startsWith(query) || name.startsWith(query)) buckets[1].push(store);
    else if (code.includes(query) || shortName.includes(query) || name.includes(query)) buckets[2].push(store);
    else if (storeSearchText(store).includes(query)) buckets[3].push(store);
  });
  return buckets.flat().slice(0, limit);
}

function storeOptionLabel(store) {
  return [store.customerCode, store.name].filter(Boolean).join("｜") || store.name;
}

function normalizeSearch(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, "");
}

function getStore(id) {
  return state.stores.find((store) => store.id === id);
}

function mergeImportedStores() {
  const importedStores = window.JINGYANG_IMPORTED_STORES || [];
  if (!importedStores.length) return;
  const existingByCode = new Map(state.stores.filter((store) => store.customerCode).map((store) => [store.customerCode, store]));
  const missingImportedStores = importedStores.filter((store) => !existingByCode.has(store.customerCode));
  const importedByCode = new Map(importedStores.map((store) => [store.customerCode, store]));
  const ownerMismatches = state.stores.filter((store) => {
    const incoming = importedByCode.get(store.customerCode);
    return incoming && !store.ownerEdited && store.salesOwner !== incoming.salesOwner;
  });
  const shouldRefreshImportedStores = state.importVersion !== IMPORT_VERSION || missingImportedStores.length > 0 || ownerMismatches.length > 0 || state.stores.length < importedStores.length;
  if (!shouldRefreshImportedStores) return;

  importedStores.forEach((incoming) => {
    const existing = existingByCode.get(incoming.customerCode);
    const resolvedIncomingOwner = state.salesOwners.includes(incoming.salesOwner) ? incoming.salesOwner : "未分配";
    if (existing) {
      const preservedOwner = incoming.ownerSource === "area-simulation-18x6"
        ? resolvedIncomingOwner
        : ((existing.ownerEdited || existing.edited) ? existing.salesOwner : resolvedIncomingOwner);
      
      if (existing.edited) {
        const savedFields = {
          name: existing.name,
          phone: existing.phone,
          address: existing.address,
          salesOwner: preservedOwner,
          note: existing.note,
          edited: true,
          ownerEdited: existing.ownerEdited || false
        };
        Object.assign(existing, incoming, savedFields);
      } else {
        Object.assign(existing, incoming, {
          salesOwner: preservedOwner,
          ownerEdited: incoming.ownerSource === "area-simulation-18x6" ? false : (existing.ownerEdited || false)
        });
      }
      delete existing.monthlySales;
      return;
    }
    state.stores.push({ ...incoming, salesOwner: resolvedIncomingOwner });
    existingByCode.set(incoming.customerCode, incoming);
  });
  normalizeSalesOwners();
  state.importVersion = IMPORT_VERSION;
  saveState();
}

function storeInfoLine(store) {
  const parts = [];
  if (store.customerCode) parts.push(`客戶編號：${store.customerCode}`);
  if (store.shortName) parts.push(`簡稱：${store.shortName}`);
  if (store.contactName) parts.push(`聯絡人：${store.contactName}`);
  if (store.taxId) parts.push(`統一編號：${store.taxId}`);
  if (store.region) parts.push(`區域：${store.region}`);
  if (!parts.length && store.note) {
    return store.note.split("｜").filter((part) => !part.includes("單月業績")).join("｜") || "無備註";
  }
  return parts.join("｜") || "無備註";
}

function storePhoneLine(store) {
  const phones = [store.phone, store.phone2, store.mobile].filter((value) => value && /\d/.test(value));
  return phones.length ? `電話：${phones.join(" / ")}` : "未填電話";
}

function countByStore(collection, storeId) {
  return collection.filter((item) => item.storeId === storeId).length;
}

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
    return { ...initialState, ...JSON.parse(saved) };
  } catch {
    return { ...initialState };
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function addMonths(date, months) {
  const next = new Date(date);
  const originalDate = next.getDate();
  next.setMonth(next.getMonth() + months);
  if (next.getDate() !== originalDate) next.setDate(0);
  return next;
}

function parseDateInput(value) {
  if (value instanceof Date) return value;
  const [year, month, day] = String(value).slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return new Date();
  return new Date(year, month - 1, day, 12);
}

function toDateInput(date) {
  const value = parseDateInput(date);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function diffDays(fromDate, toDate) {
  return Math.round((parseDateInput(toDate) - parseDateInput(fromDate)) / 86400000);
}

function formatDate(value) {
  return new Intl.DateTimeFormat("zh-Hant-TW", { year: "numeric", month: "2-digit", day: "2-digit" }).format(parseDateInput(value));
}

function isThisMonth(value) {
  const date = new Date(value);
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
}

function setText(selector, value) {
  document.querySelector(selector).textContent = value;
}

function setTextSafe(selector, value) {
  const node = document.querySelector(selector);
  if (node) node.textContent = value;
}

function emptyState(text) {
  return `<div class="empty-state">${text}</div>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function toast(message) {
  const element = document.querySelector("#toast");
  element.textContent = message;
  element.classList.add("show");
  window.setTimeout(() => element.classList.remove("show"), 2200);
}

function t(term) {
  const role = state.currentUser ? state.currentUser.role : null;
  if (role === "retail") {
    switch (term) {
      case "店家": return "設計公司/業主";
      case "店家資料": return "案場資料";
      case "店家名稱": return "設計案名 / 業主姓名";
      case "店家名稱Placeholder": return "例：設計案名、業主案名關鍵字";
      case "負責業務": return "負責人";
      case "未指定店家": return "未指定設計/業主";
      case "找不到符合的店家": return "找不到符合的項目";
      case "尚未建立店家資料": return "尚未建立設計案或業主資料";
      case "更新店家資料": return "更新案場資料";
      case "儲存店家資料": return "儲存案場資料";
      case "請先建立店家資料，再替店家上架拍照存檔": return "請先建立案場資料，再進行拍照存檔";
      case "店家已選": return "設計/業主已選";
      case "找不到店家資料": return "找不到案場資料";
      case "地址": return "施工/送貨地址";
      case "地址Placeholder": return "例：工地地址或送貨地址...";
      case "未填地址": return "未填施工送貨地址";
      default: return term;
    }
  }
  
  // 預設（sales / admin）
  switch (term) {
    case "店家名稱Placeholder": return "例：輸入店家編號或名稱關鍵字";
    case "地址Placeholder": return "例：台北市中山區...";
    case "未填地址": return "未填地址";
    default: return term;
  }
}

function applyRoleAesthetic() {
  const role = state.currentUser ? state.currentUser.role : null;
  const isRetail = (role === "retail");

  // 1. 首頁選單卡片
  const storesMenuCard = document.querySelector(".menu-card[data-view='stores']");
  if (storesMenuCard) {
    const strong = storesMenuCard.querySelector("strong");
    const p = storesMenuCard.querySelector("p");
    if (strong) strong.textContent = isRetail ? "設計公司/業主" : "店家";
    if (p) p.textContent = isRetail ? "查看名下設計公司、設計師、業主案名與工地資料" : "查看業務名下店家、電話、地址與聯絡資料";
  }

  const photosMenuCard = document.querySelector(".menu-card[data-view='photos']");
  if (photosMenuCard) {
    const p = photosMenuCard.querySelector("p");
    if (p) p.textContent = isRetail ? "每個設計案都有專屬照片檔案夾" : "每個店家都有專屬照片檔案夾";
  }

  // 2. 底部導覽列按鈕
  const storesNavBtn = document.querySelector(".bottom-nav .nav-item[data-view='stores']");
  if (storesNavBtn) {
    storesNavBtn.textContent = isRetail ? "設計/業主" : "店家";
  }

  // 3. 店家表單的 Label 和 Placeholder
  const storeForm = document.querySelector("#storeForm");
  if (storeForm) {
    const storesHeader = document.querySelector("#storesView .view-toolbar h1");
    if (storesHeader) storesHeader.textContent = isRetail ? "設計公司/業主" : "店家";

    const nameLabelText = document.querySelector(".stores-label-storeName");
    if (nameLabelText) nameLabelText.textContent = isRetail ? "設計案名 / 業主姓名" : "店家名稱";

    const nameInput = document.querySelector("#storeNameInput");
    if (nameInput) nameInput.placeholder = t("店家名稱Placeholder");

    const addressLabelText = document.querySelector(".stores-label-address");
    if (addressLabelText) addressLabelText.textContent = isRetail ? "施工/送貨地址" : "地址";

    const addressInput = storeForm.querySelector("[name='address']");
    if (addressInput) addressInput.placeholder = t("地址Placeholder");

    const submitBtn = document.querySelector("#storeSubmitButton");
    if (submitBtn) {
      if (submitBtn.textContent.indexOf("儲存") === 0) {
        submitBtn.textContent = t("儲存店家資料");
      } else if (submitBtn.textContent.indexOf("更新") === 0) {
        submitBtn.textContent = t("更新店家資料");
      }
    }
  }

  // 4. 保留提醒表單的 Label 和 Placeholder
  const holdForm = document.querySelector("#holdForm");
  if (holdForm) {
    const storeLabelText = document.querySelector(".holds-label-store");
    if (storeLabelText) storeLabelText.textContent = isRetail ? "設計公司/業主" : "店家";

    const storeInput = document.querySelector("#holdStoreInput");
    if (storeInput) storeInput.placeholder = isRetail ? "輸入設計案名或設計公司關鍵字" : "輸入店家編號或名稱關鍵字";

    const addressLabelText = document.querySelector(".holds-label-address");
    if (addressLabelText) addressLabelText.textContent = isRetail ? "保留案場地址" : "保留地址";
  }

  // 5. 拍照上傳表單的 Label
  const photoForm = document.querySelector("#photoForm");
  if (photoForm) {
    const storeLabelText = document.querySelector(".photos-label-store");
    if (storeLabelText) storeLabelText.textContent = isRetail ? "設計公司/業主" : "店家";

    const storeInput = document.querySelector("#photoStoreInput");
    if (storeInput) storeInput.placeholder = isRetail ? "輸入設計案名或設計公司關鍵字" : "輸入店家編號或名稱關鍵字";
  }
}

render();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js?v=20260627-retail").catch(() => {});
  });
}
