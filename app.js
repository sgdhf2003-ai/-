const STORAGE_KEY = "jingyang-sales-workspace-v2";
const LEGACY_STORAGE_KEY = "jingyang-sales-workspace-v1";
const IMPORT_VERSION = "customers-mobile-topbar-2026-06-26-v1";
const CLOUD_CONFIG_KEY = "jingyang-cloud-config-v1";
const REMEMBER_ME_KEY = "jingyang-remember-me-v1";
const APP_SETTINGS_KEY = "jingyang-app-settings-v1";
const GOOGLE_DRIVE_FOLDER_ID = "1eOqcHag3qUO_Cd7n2Hv4A4Q3K8NKgXvB";
const DEFAULT_CLOUD_API_URL = "https://script.google.com/macros/s/AKfycbw6p15f3mfeOmnVjvp4niO05J3A_YGMRhmJXqGQ6Jcg_7VQiWZ_4lskjBCZQ2gqbmUKKw/exec";
const SALES_REPORT_URL = "https://script.google.com/macros/s/AKfycbwonMKbfTbmkacvvNFXbqZXIi42KcRpXLtcEaYrLqH2SPbbh7z-A9QPYR257uJ0V0ha/exec";

const initialState = {
  activeSalesOwner: "all",
  salesOwners: ["蔡", "倫", "豪", "001", "002"],
  importVersion: "",
  stores: [],
  holds: [],
  projects: [],
  samples: [],
  complaints: [],
  photos: [],
  tasks: [],
  auditLogs: [],
  deletedRecords: [],
  currentUser: null,
  currentPermissions: null,
  settings: [],
};

let state = loadState();
mergeImportedStores();
let cloudConfig = loadCloudConfig();
let appSettings = loadAppSettings();
let editingStoreId = null;
const pwaTaskStatusInFlight = new Set();
const pwaTaskIssueReasonOpen = new Set();
const pwaTaskWaitingReasonOpen = new Set();
let taskSearchKeyword = "";
let filterTaskDueDate = "all";
let sortTaskOrder = "default";

const views = {
  home: document.querySelector("#homeView"),
  stores: document.querySelector("#storesView"),
  holds: document.querySelector("#holdsView"),
  projects: document.querySelector("#projectsView"),
  samples: document.querySelector("#samplesView"),
  complaints: document.querySelector("#complaintsView"),
  calculator: document.querySelector("#calculatorView"),
  salesReport: document.querySelector("#salesReportView"),
  inventory: document.querySelector("#inventoryView"),
  admin: document.querySelector("#adminView"),
  tasks: document.querySelector("#tasksView"),
};

const viewNames = {
  home: "勁揚業務管家",
  stores: "店家",
  holds: "保留物品",
  projects: "案場報備",
  samples: "樣品與展示架",
  complaints: "售後客訴",
  calculator: "報價試算器",
  salesReport: "業績分析",
  inventory: "庫存查詢",
  admin: "後台管理",
  tasks: "工作任務",
};

document.addEventListener("click", (event) => {
  const shortcut = event.target.closest("[data-shortcut-view]");
  if (shortcut) {
    event.preventDefault();
    event.stopPropagation();
    setView(shortcut.dataset.shortcutView);
    return;
  }

  const completeBtn = event.target.closest("[data-task-complete-btn]");
  if (completeBtn) {
    event.preventDefault();
    event.stopPropagation();
    const taskId = decodeURIComponent(completeBtn.dataset.taskCompleteBtn);
    completeTaskFromPwa_(taskId);
    return;
  }

  const issueToggleBtn = event.target.closest("[data-task-issue-toggle-btn]");
  if (issueToggleBtn) {
    event.preventDefault();
    event.stopPropagation();
    const taskId = decodeURIComponent(issueToggleBtn.dataset.taskIssueToggleBtn);
    if (pwaTaskIssueReasonOpen.has(taskId)) {
      pwaTaskIssueReasonOpen.delete(taskId);
    } else {
      pwaTaskIssueReasonOpen.add(taskId);
    }
    renderTasks();
    return;
  }

  const issueSubmitBtn = event.target.closest("[data-task-issue-submit-btn]");
  if (issueSubmitBtn) {
    event.preventDefault();
    event.stopPropagation();
    const taskId = decodeURIComponent(issueSubmitBtn.dataset.taskIssueSubmitBtn);
    const reason = issueSubmitBtn.dataset.reason;
    reportTaskIssueFromPwa_(taskId, reason);
    return;
  }

  const waitingToggleBtn = event.target.closest("[data-task-waiting-toggle-btn]");
  if (waitingToggleBtn) {
    event.preventDefault();
    event.stopPropagation();
    const taskId = decodeURIComponent(waitingToggleBtn.dataset.taskWaitingToggleBtn);
    if (pwaTaskWaitingReasonOpen.has(taskId)) {
      pwaTaskWaitingReasonOpen.delete(taskId);
    } else {
      pwaTaskWaitingReasonOpen.add(taskId);
    }
    renderTasks();
    return;
  }

  const waitingSubmitBtn = event.target.closest("[data-task-waiting-submit-btn]");
  if (waitingSubmitBtn) {
    event.preventDefault();
    event.stopPropagation();
    const taskId = decodeURIComponent(waitingSubmitBtn.dataset.taskWaitingSubmitBtn);
    const reason = waitingSubmitBtn.dataset.reason;
    requestTaskInfoFromPwa_(taskId, reason);
    return;
  }

  const detailToggle = event.target.closest("[data-task-detail-toggle]");
  if (detailToggle) {
    event.preventDefault();
    event.stopPropagation();
    const taskId = detailToggle.dataset.taskDetailToggle;
    const panel = document.getElementById(`detail-panel-${taskId}`);
    if (panel) {
      const isHidden = panel.style.display === "none";
      panel.style.display = isHidden ? "block" : "none";
      detailToggle.innerHTML = isHidden ? "收合詳情 ▴" : "查看詳情 ▾";
    }
    return;
  }

  const summaryFilterBtn = event.target.closest("[data-task-summary-filter]");
  if (summaryFilterBtn) {
    event.preventDefault();
    event.stopPropagation();
    const targetStatus = summaryFilterBtn.dataset.taskSummaryFilter;
    const statusSelect = document.querySelector("#filterTaskStatus");
    if (statusSelect) {
      statusSelect.value = targetStatus;
      renderTasks();
    }
    return;
  }

  const viewButton = event.target.closest("[data-view]");
  if (!viewButton) return;
  setView(viewButton.dataset.view);
});

document.querySelector("#salesFilter").addEventListener("change", (event) => {
  state.activeSalesOwner = event.target.value;
  saveState();
  render();
});

document.querySelector("#quickShortcutToggle")?.addEventListener("change", (event) => {
  appSettings.quickShortcutsEnabled = event.target.checked;
  saveAppSettings();
  applyQuickShortcutSetting();
  toast(event.target.checked ? "首頁卡片快捷鍵已開啟" : "首頁卡片快捷鍵已關閉");
});

setupStoreCombo("storeName");
setupStoreCombo("holdStore");
setupStoreCombo("photoStore");
setupStoreCombo("projectStore");
setupStoreCombo("sampleStore");
setupStoreCombo("complaintStore");
initCalculator();
setupExternalFrameLoaders();

document.querySelector("#storeForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const name = form.get("name").trim();
  const phone = form.get("phone").trim();
  const address = form.get("address").trim();
  const salesOwner = form.get("salesOwner");
  const note = form.get("note").trim();

  let savedStore = null;

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
      savedStore = store;
      toast(store.ownerEdited ? "店家資料已更新，業務歸屬已鎖定" : "店家資料已更新");
    } else {
      toast("更新失敗，找不到店家");
    }
    cancelEditStore();
  } else {
    savedStore = {
      id: crypto.randomUUID(),
      name,
      phone,
      address,
      salesOwner,
      note,
      edited: true,
      ownerEdited: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    state.stores.unshift(savedStore);
    event.currentTarget.reset();
    toast("店家資料已儲存");
  }
  saveState();
  render();

  if (savedStore && getCloudApiUrl()) {
    try {
      await sendCloudWrite("upsertStore", { store: savedStore });
    } catch (error) {
      console.error(error);
      toast("店家已存在本機，但雲端鎖定送出失敗");
    }
  }
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

  submitButton.disabled = true;
  submitButton.textContent = "登入中...";

  try {
    const loginUrl = new URL(apiUrl);
    loginUrl.searchParams.set("action", "login");
    loginUrl.searchParams.set("username", username);
    loginUrl.searchParams.set("password", password);
    
    const storedLineUserId = localStorage.getItem("lineUserId");
    if (storedLineUserId) {
      loginUrl.searchParams.set("lineUserId", storedLineUserId);
    }
    
    const response = await fetch(loginUrl.toString(), {
      method: "GET",
      cache: "no-store"
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
    
    // Clear lineUserId from localStorage on successful login
    localStorage.removeItem("lineUserId");

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
    warmSalesReportFrame();
    toast("登入成功！歡迎 " + (state.currentUser.displayName || state.currentUser.username));
    requestNotificationPermission();
    startAutoSync();
    syncFromCloud(true).catch((e) => console.warn("Sync on login failed:", e));
    setView(consumePendingInitialView() || "home");
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
  stopAutoSync();
  saveState();
  if (window.OneSignal) {
    OneSignal.logout().catch(e => console.warn("OneSignal logout failed:", e));
  }
  render();
  toast("已登出帳號");
});

document.querySelector("#pwaReloadButton")?.addEventListener("click", async () => {
  toast("正在檢查更新並重新整理...");
  if ("serviceWorker" in navigator) {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (let registration of registrations) {
        await registration.update();
      }
    } catch (e) {
      console.warn("Service worker update failed:", e);
    }
  }
  window.location.reload(true);
});

document.querySelector("#holdForm").addEventListener("submit", async (event) => {
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
  const newHold = {
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
    edited: true,
    createdAt: new Date().toISOString(),
  };
  state.holds.unshift(newHold);
  event.currentTarget.reset();
  saveState();
  render();
  toast("保留物品提醒已建立");

  if (getCloudApiUrl()) {
    try {
      await sendCloudWrite("upsertHold", { hold: newHold });
    } catch (error) {
      console.error(error);
      toast("保留提醒已儲存於本機，但雲端送出失敗");
    }
  }
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

let editingProjectId = null;
let editingSampleId = null;
let editingComplaintId = null;

document.querySelector("#projectForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  syncProjectStoreIdFromInput();
  const form = new FormData(event.currentTarget);
  const storeId = form.get("storeId");
  if (!storeId) {
    toast("請從店家欄位選擇一筆店家資料");
    return;
  }
  const id = form.get("id") || crypto.randomUUID();
  const projectName = form.get("projectName").trim();
  const projectAddress = form.get("projectAddress").trim();
  const tileDetails = form.get("tileDetails").trim();
  const expectedDeliveryDate = form.get("expectedDeliveryDate");
  const status = form.get("status");
  const note = form.get("note").trim();

  const store = getStore(storeId);
  const project = {
    id,
    storeId,
    storeName: store?.name || "",
    salesOwner: store?.salesOwner || "",
    projectName,
    projectAddress,
    tileDetails,
    expectedDeliveryDate,
    status,
    note,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const existingIndex = (state.projects || []).findIndex(p => p.id === id);
  if (existingIndex > -1) {
    project.createdAt = state.projects[existingIndex].createdAt || project.createdAt;
    project.edited = true;
    state.projects[existingIndex] = project;
    toast("案場報備已更新");
  } else {
    if (!state.projects) state.projects = [];
    state.projects.unshift(project);
    toast("案場報備已建立");
  }

  cancelEditProject();
  saveState();
  render();

  if (getCloudApiUrl()) {
    try {
      await sendCloudWrite("upsertProject", { project });
    } catch (e) {
      console.error(e);
    }
  }
});

function startEditProject(id) {
  const project = state.projects.find(p => p.id === id);
  if (!project) return;
  editingProjectId = id;
  const store = getStore(project.storeId);
  
  const form = document.querySelector("#projectForm");
  form.querySelector("#projectFormId").value = project.id;
  form.querySelector("#projectStoreId").value = project.storeId;
  form.querySelector("#projectStoreInput").value = store ? storeOptionLabel(store) : "";
  form.querySelector("[name='projectName']").value = project.projectName || "";
  form.querySelector("[name='projectAddress']").value = project.projectAddress || "";
  form.querySelector("[name='tileDetails']").value = project.tileDetails || "";
  form.querySelector("[name='expectedDeliveryDate']").value = project.expectedDeliveryDate || "";
  form.querySelector("[name='status']").value = project.status || "洽談中";
  form.querySelector("[name='note']").value = project.note || "";

  document.querySelector("#projectSubmitButton").textContent = t("更新案場資料");
  document.querySelector("#projectCancelButton").style.display = "inline-block";
  form.scrollIntoView({ behavior: "smooth" });
}

function cancelEditProject() {
  editingProjectId = null;
  const form = document.querySelector("#projectForm");
  if (!form) return;
  form.reset();
  form.querySelector("#projectFormId").value = "";
  form.querySelector("#projectStoreId").value = "";
  form.querySelector("#projectStoreInput").value = "";
  document.querySelector("#projectSubmitButton").textContent = state.currentUser?.role === "retail" ? "新增案場登錄" : "新增案場報備";
  document.querySelector("#projectCancelButton").style.display = "none";
}

document.querySelector("#projectCancelButton")?.addEventListener("click", () => {
  cancelEditProject();
});

document.querySelector("#sampleForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = event.currentTarget.querySelector("button[type='submit']");
  submitButton.disabled = true;
  submitButton.textContent = "樣品處理中...";
  try {
    syncSampleStoreIdFromInput();
    const form = new FormData(event.currentTarget);
    const storeId = form.get("storeId");
    if (!storeId) {
      toast("請從店家欄位選擇一筆店家資料");
      return;
    }
    const id = form.get("id") || crypto.randomUUID();
    const itemType = form.get("itemType");
    const quantity = form.get("quantity");
    const modelName = form.get("modelName").trim();
    const status = form.get("status");
    const note = form.get("note").trim();

    const store = getStore(storeId);
    const sample = {
      id,
      storeId,
      storeName: store?.name || "",
      salesOwner: store?.salesOwner || "",
      itemType,
      quantity,
      modelName,
      status,
      note,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const existingSample = (state.samples || []).find(s => s.id === id);
    if (existingSample) {
      sample.image = existingSample.image;
      sample.driveUrl = existingSample.driveUrl;
      sample.fileId = existingSample.fileId;
      sample.cloudStatus = existingSample.cloudStatus;
      sample.createdAt = existingSample.createdAt || sample.createdAt;
    }

    const fileInput = document.querySelector("#sampleFileInput");
    const file = fileInput?.files?.[0];
    let thumbnail = null;
    let uploadImage = null;
    if (file) {
      thumbnail = await resizeImageFile(file, 420, 0.68);
      uploadImage = await resizeImageFile(file, 1600, 0.78);
      sample.image = thumbnail;
      sample.cloudStatus = getCloudApiUrl() ? "uploading" : "local";
    }

    const existingIndex = (state.samples || []).findIndex(s => s.id === id);
    if (existingIndex > -1) {
      sample.edited = true;
      state.samples[existingIndex] = sample;
      toast("樣品展架記錄已更新");
    } else {
      if (!state.samples) state.samples = [];
      state.samples.unshift(sample);
      toast("樣品展架記錄已建立");
    }

    cancelEditSample();
    saveState();
    render();

    if (file && uploadImage) {
      if (getCloudApiUrl()) {
        await uploadPhotoToCloud(sample, uploadImage, "samples");
      }
    } else {
      if (getCloudApiUrl()) {
        try {
          await sendCloudWrite("upsertSample", { sample });
        } catch (e) {
          console.error(e);
        }
      }
    }
  } catch (error) {
    toast(error.message || "處理失敗");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "新增樣品展架記錄";
  }
});

function startEditSample(id) {
  const sample = state.samples.find(s => s.id === id);
  if (!sample) return;
  editingSampleId = id;
  const store = getStore(sample.storeId);

  const form = document.querySelector("#sampleForm");
  form.querySelector("#sampleFormId").value = sample.id;
  form.querySelector("#sampleStoreId").value = sample.storeId;
  form.querySelector("#sampleStoreInput").value = store ? storeOptionLabel(store) : "";
  form.querySelector("[name='itemType']").value = sample.itemType || "展示架";
  form.querySelector("[name='quantity']").value = sample.quantity || "1";
  form.querySelector("[name='modelName']").value = sample.modelName || "";
  form.querySelector("[name='status']").value = sample.status || "已送達/上架";
  form.querySelector("[name='note']").value = sample.note || "";
  
  if (form.querySelector("#sampleFileInput")) form.querySelector("#sampleFileInput").value = "";

  document.querySelector("#sampleSubmitButton").textContent = "更新樣品展架記錄";
  document.querySelector("#sampleCancelButton").style.display = "inline-block";
  form.scrollIntoView({ behavior: "smooth" });
}

function cancelEditSample() {
  editingSampleId = null;
  const form = document.querySelector("#sampleForm");
  if (!form) return;
  form.reset();
  form.querySelector("#sampleFormId").value = "";
  form.querySelector("#sampleStoreId").value = "";
  form.querySelector("#sampleStoreInput").value = "";
  document.querySelector("#sampleSubmitButton").textContent = "新增樣品展架記錄";
  document.querySelector("#sampleCancelButton").style.display = "none";
}

document.querySelector("#sampleCancelButton")?.addEventListener("click", () => {
  cancelEditSample();
});

document.querySelector("#complaintForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = event.currentTarget.querySelector("button[type='submit']");
  submitButton.disabled = true;
  submitButton.textContent = "客訴單處理中...";
  try {
    syncComplaintStoreIdFromInput();
    const form = new FormData(event.currentTarget);
    const storeId = form.get("storeId");
    if (!storeId) {
      toast("請從店家欄位選擇一筆店家資料");
      return;
    }
    const id = form.get("id") || crypto.randomUUID();
    const category = form.get("category");
    const status = form.get("status");
    const issueDescription = form.get("issueDescription").trim();
    const coordinationLog = form.get("coordinationLog").trim();

    const store = getStore(storeId);
    const complaint = {
      id,
      storeId,
      storeName: store?.name || "",
      salesOwner: store?.salesOwner || "",
      category,
      status,
      issueDescription,
      coordinationLog,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const existingComplaint = (state.complaints || []).find(c => c.id === id);
    if (existingComplaint) {
      complaint.image = existingComplaint.image;
      complaint.driveUrl = existingComplaint.driveUrl;
      complaint.fileId = existingComplaint.fileId;
      complaint.cloudStatus = existingComplaint.cloudStatus;
      complaint.createdAt = existingComplaint.createdAt || complaint.createdAt;
    }

    const fileInput = document.querySelector("#complaintFileInput");
    const file = fileInput?.files?.[0];
    let thumbnail = null;
    let uploadImage = null;
    if (file) {
      thumbnail = await resizeImageFile(file, 420, 0.68);
      uploadImage = await resizeImageFile(file, 1600, 0.78);
      complaint.image = thumbnail;
      complaint.cloudStatus = getCloudApiUrl() ? "uploading" : "local";
    }

    const existingIndex = (state.complaints || []).findIndex(c => c.id === id);
    if (existingIndex > -1) {
      complaint.edited = true;
      state.complaints[existingIndex] = complaint;
      toast("售後客訴單已更新");
    } else {
      if (!state.complaints) state.complaints = [];
      state.complaints.unshift(complaint);
      toast("售後客訴單已建立");
    }

    cancelEditComplaint();
    saveState();
    render();

    if (file && uploadImage) {
      if (getCloudApiUrl()) {
        await uploadPhotoToCloud(complaint, uploadImage, "complaints");
      }
    } else {
      if (getCloudApiUrl()) {
        try {
          await sendCloudWrite("upsertComplaint", { complaint });
        } catch (e) {
          console.error(e);
        }
      }
    }
  } catch (error) {
    toast(error.message || "處理失敗");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "新增售後客訴單";
  }
});

function startEditComplaint(id) {
  const complaint = state.complaints.find(c => c.id === id);
  if (!complaint) return;
  editingComplaintId = id;
  const store = getStore(complaint.storeId);

  const form = document.querySelector("#complaintForm");
  form.querySelector("#complaintFormId").value = complaint.id;
  form.querySelector("#complaintStoreId").value = complaint.storeId;
  form.querySelector("#complaintStoreInput").value = store ? storeOptionLabel(store) : "";
  form.querySelector("[name='category']").value = complaint.category || "色差問題";
  form.querySelector("[name='status']").value = complaint.status || "待處理";
  form.querySelector("[name='issueDescription']").value = complaint.issueDescription || "";
  form.querySelector("[name='coordinationLog']").value = complaint.coordinationLog || "";

  if (form.querySelector("#complaintFileInput")) form.querySelector("#complaintFileInput").value = "";

  document.querySelector("#complaintSubmitButton").textContent = "更新售後客訴單";
  document.querySelector("#complaintCancelButton").style.display = "inline-block";
  form.scrollIntoView({ behavior: "smooth" });
}

function cancelEditComplaint() {
  editingComplaintId = null;
  const form = document.querySelector("#complaintForm");
  if (!form) return;
  form.reset();
  form.querySelector("#complaintFormId").value = "";
  form.querySelector("#complaintStoreId").value = "";
  form.querySelector("#complaintStoreInput").value = "";
  document.querySelector("#complaintSubmitButton").textContent = "新增售後客訴單";
  document.querySelector("#complaintCancelButton").style.display = "none";
}

document.querySelector("#complaintCancelButton")?.addEventListener("click", () => {
  cancelEditComplaint();
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

document.querySelector("#lineNotifyForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitBtn = document.querySelector("#lineNotifySaveButton");
  const appId = String(document.querySelector("#oneSignalAppIdInput")?.value || "").trim();
  const apiKey = String(document.querySelector("#oneSignalApiKeyInput")?.value || "").trim();

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "儲存中...";
  }

  try {
    if (!getCloudApiUrl()) {
      throw new Error("請先設定 Google 雲端連線網址");
    }

    if (!Array.isArray(state.settings)) state.settings = [];
    
    // Save App ID
    let appIdSetting = state.settings.find(s => s.key === "oneSignalAppId");
    if (appIdSetting) {
      appIdSetting.value = appId;
      appIdSetting.updatedAt = new Date().toISOString();
    } else {
      state.settings.push({
        key: "oneSignalAppId",
        value: appId,
        updatedAt: new Date().toISOString()
      });
    }

    // Save API Key
    let apiKeySetting = state.settings.find(s => s.key === "oneSignalApiKey");
    if (apiKeySetting) {
      apiKeySetting.value = apiKey;
      apiKeySetting.updatedAt = new Date().toISOString();
    } else {
      state.settings.push({
        key: "oneSignalApiKey",
        value: apiKey,
        updatedAt: new Date().toISOString()
      });
    }

    saveState();

    await sendCloudWrite("saveSetting", { key: "oneSignalAppId", value: appId });
    await sendCloudWrite("saveSetting", { key: "oneSignalApiKey", value: apiKey });
    toast("OneSignal 推播設定儲存成功");
  } catch (error) {
    toast(error.message || "儲存推播設定失敗");
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "儲存設定";
    }
  }
});

document.querySelector("#lineNotifyTestButton")?.addEventListener("click", async () => {
  const testBtn = document.querySelector("#lineNotifyTestButton");
  const appId = String(document.querySelector("#oneSignalAppIdInput")?.value || "").trim();
  const apiKey = String(document.querySelector("#oneSignalApiKeyInput")?.value || "").trim();

  if (testBtn) {
    testBtn.disabled = true;
    testBtn.textContent = "發送中...";
  }

  try {
    if (!getCloudApiUrl()) {
      throw new Error("請先設定 Google 雲端連線網址");
    }

    const testUrl = new URL(getCloudApiUrl());
    testUrl.searchParams.set("action", "testLineNotify");
    testUrl.searchParams.set("appId", appId);
    testUrl.searchParams.set("apiKey", apiKey);

    const response = await fetch(testUrl.toString(), {
      method: "GET",
      cache: "no-store"
    });
    const text = await response.text();
    const result = JSON.parse(text);

    if (result.ok) {
      toast(result.message || "測試訊息發送成功！");
    } else {
      throw new Error(result.error || "測試訊息發送失敗");
    }
  } catch (error) {
    toast(error.message || "測試連線失敗，請確認 API Key 是否填寫正確");
  } finally {
    if (testBtn) {
      testBtn.disabled = false;
      testBtn.textContent = "發送測試訊息";
    }
  }
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
    hold.edited = true;
    saveState();
    render();
    toast(hold.status === "done" ? "保留提醒已標記完成" : "保留提醒已重新開啟");
    if (getCloudApiUrl()) {
      sendCloudWrite("upsertHold", { hold }).catch(console.error);
    }
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
    if (getCloudApiUrl()) {
      pushSnapshotToCloud().catch(console.error);
    }
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
    if (getCloudApiUrl()) {
      pushSnapshotToCloud().catch(console.error);
    }
  }
  if (actionName === "delete-photo") {
    const before = state.photos.length;
    state.photos = state.photos.filter((photo) => photo.id !== id);
    saveState();
    render();
    toast(before === state.photos.length ? "找不到這張照片資料" : "照片資料已刪除");
    if (getCloudApiUrl()) {
      pushSnapshotToCloud().catch(console.error);
    }
  }
  if (actionName === "delete-project") {
    const before = (state.projects || []).length;
    state.projects = (state.projects || []).filter((proj) => proj.id !== id);
    saveState();
    render();
    toast(before === (state.projects || []).length ? "找不到這筆案場資料" : "案場報備已刪除");
    if (getCloudApiUrl()) {
      pushSnapshotToCloud().catch(console.error);
    }
  }
  if (actionName === "edit-project") {
    startEditProject(id);
    return;
  }
  if (actionName === "delete-sample") {
    const before = (state.samples || []).length;
    state.samples = (state.samples || []).filter((s) => s.id !== id);
    saveState();
    render();
    toast(before === (state.samples || []).length ? "找不到這筆樣品展架記錄" : "樣品展架記錄已刪除");
    if (getCloudApiUrl()) {
      pushSnapshotToCloud().catch(console.error);
    }
  }
  if (actionName === "edit-sample") {
    startEditSample(id);
    return;
  }
  if (actionName === "delete-complaint") {
    const before = (state.complaints || []).length;
    state.complaints = (state.complaints || []).filter((c) => c.id !== id);
    saveState();
    render();
    toast(before === (state.complaints || []).length ? "找不到這筆客訴資料" : "售後客訴單已刪除");
    if (getCloudApiUrl()) {
      pushSnapshotToCloud().catch(console.error);
    }
  }
  if (actionName === "edit-complaint") {
    startEditComplaint(id);
    return;
  }
  if (actionName === "reload-frame") {
    reloadFrame(action.dataset.frame);
  }
  if (!["done", "delete-store", "edit-store", "delete-hold", "delete-photo", "reload-frame", "rename-sales-owner", "delete-sales-owner", "delete-project", "edit-project", "delete-sample", "edit-sample", "delete-complaint", "edit-complaint"].includes(actionName)) {
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
  applyQuickShortcutSetting();
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

  const activeView = Object.keys(views).find(name => views[name]?.classList.contains("active")) || "home";

  if (activeView === "home") {
    renderHome();
  } else if (activeView === "stores") {
    renderSelects();
    renderStores();
  } else if (activeView === "holds") {
    renderHolds();
  } else if (activeView === "projects") {
    renderProjects();
  } else if (activeView === "samples") {
    renderSamples();
  } else if (activeView === "complaints") {
    renderComplaints();
  } else if (activeView === "tasks") {
    renderTasks();
  } else if (activeView === "admin") {
    renderSalesOwnerAdmin();
    renderCloudStatus();
    renderAppSettings();
    populateSettingsUI();
  }

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

function populateSettingsUI() {
  if (!Array.isArray(state.settings)) return;
  
  const appIdSetting = state.settings.find(s => s.key === "oneSignalAppId");
  const appIdInput = document.querySelector("#oneSignalAppIdInput");
  if (appIdInput && appIdSetting && appIdSetting.value) {
    appIdInput.value = appIdSetting.value;
  }
  
  const apiKeySetting = state.settings.find(s => s.key === "oneSignalApiKey");
  const apiKeyInput = document.querySelector("#oneSignalApiKeyInput");
  if (apiKeyInput && apiKeySetting && apiKeySetting.value) {
    apiKeyInput.value = apiKeySetting.value;
  }
}

function renderAppSettings() {
  const quickShortcutToggle = document.querySelector("#quickShortcutToggle");
  if (quickShortcutToggle) quickShortcutToggle.checked = appSettings.quickShortcutsEnabled !== false;
}

function applyQuickShortcutSetting() {
  document.body.classList.toggle("quick-shortcuts-off", appSettings.quickShortcutsEnabled === false);
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
  const visibleProjects = (state.projects || []).filter((proj) => visibleStoreIds.has(proj.storeId));
  const visibleSamples = (state.samples || []).filter((s) => visibleStoreIds.has(s.storeId));
  const visibleComplaints = (state.complaints || []).filter((c) => visibleStoreIds.has(c.storeId));
  const unreadCount = getUnreadReminderCount(visibleStoreIds);

  setText("#storeCount", visibleStores.length);
  setText("#holdCount", visibleHolds.filter((hold) => hold.status !== "done").length);
  setText("#projectCount", visibleProjects.length);
  setText("#sampleCount", visibleSamples.length);
  setText("#complaintCount", visibleComplaints.length);
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

function renderProjects() {
  const list = document.querySelector("#projectList");
  if (!list) return;
  const ids = new Set(getVisibleStores().map((store) => store.id));
  const projects = (state.projects || []).filter((proj) => ids.has(proj.storeId));
  if (!projects.length) {
    list.innerHTML = emptyState("尚未建立案場報備資料");
    return;
  }
  list.innerHTML = [...projects]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((proj) => projectCard(proj))
    .join("");
}

function projectCard(proj) {
  const store = getStore(proj.storeId);
  return `
    <details class="info-card project-card">
      <summary class="hold-summary">
        <span class="hold-summary-text">
          <strong>${escapeHtml(proj.projectName)}</strong>
          <span>${escapeHtml(store?.name || t("未指定店家"))}</span>
          <span>預估進場：${formatDate(proj.expectedDeliveryDate)}</span>
        </span>
        <span class="badge status-${proj.status}">${escapeHtml(proj.status)}</span>
      </summary>
      <div class="meta hold-detail">
        案場地址：${escapeHtml(proj.projectAddress || "未填")}<br />
        預估出貨明細：<br />
        <pre class="pre-text">${escapeHtml(proj.tileDetails)}</pre>
        備註：${escapeHtml(proj.note || "無備註")}<br />
        建立時間：${formatDate(proj.createdAt)}
      </div>
      <div class="card-actions">
        <button class="small-button" data-action="edit-project" data-id="${proj.id}">編輯</button>
        <button class="small-button" data-action="delete-project" data-id="${proj.id}">刪除</button>
      </div>
    </details>
  `;
}

function renderSamples() {
  const list = document.querySelector("#sampleList");
  if (!list) return;
  const ids = new Set(getVisibleStores().map((store) => store.id));
  const samples = (state.samples || []).filter((s) => ids.has(s.storeId));
  if (!samples.length) {
    list.innerHTML = emptyState("尚未建立樣品展架記錄");
    return;
  }
  list.innerHTML = [...samples]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((s) => sampleCard(s))
    .join("");
}

function sampleCard(item) {
  const store = getStore(item.storeId);
  const cloudLine = item.driveUrl
    ? `<br /><a class="inline-link" href="${escapeHtml(item.driveUrl)}" target="_blank" rel="noopener">查看 Google Drive 照片</a>`
    : (item.image ? `<br />雲端狀態：${escapeHtml(cloudStatusLabel(item.cloudStatus))}` : "");
  const imgHtml = item.image ? `<div class="card-image-wrapper"><img src="${item.image}" alt="現場照" /></div>` : "";
  return `
    <details class="info-card sample-card">
      <summary class="hold-summary">
        <span class="hold-summary-text">
          <strong>${escapeHtml(item.modelName)} (${escapeHtml(item.quantity)} ${item.itemType === "展示架" ? "組" : "本"})</strong>
          <span>${escapeHtml(store?.name || t("未指定店家"))} / ${escapeHtml(item.itemType)}</span>
        </span>
        <span class="badge status-${item.status}">${escapeHtml(item.status)}</span>
      </summary>
      <div class="meta hold-detail">
        ${imgHtml}
        巡查狀態：${escapeHtml(item.status)}<br />
        備註：${escapeHtml(item.note || "無備註")}${cloudLine}<br />
        建立時間：${formatDate(item.createdAt)}
      </div>
      <div class="card-actions">
        <button class="small-button" data-action="edit-sample" data-id="${item.id}">編輯</button>
        <button class="small-button" data-action="delete-sample" data-id="${item.id}">刪除</button>
      </div>
    </details>
  `;
}

function renderComplaints() {
  const list = document.querySelector("#complaintList");
  if (!list) return;
  const ids = new Set(getVisibleStores().map((store) => store.id));
  const complaints = (state.complaints || []).filter((c) => ids.has(c.storeId));
  if (!complaints.length) {
    list.innerHTML = emptyState("尚未建立售後客訴單");
    return;
  }
  list.innerHTML = [...complaints]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((c) => complaintCard(c))
    .join("");
}

function complaintCard(comp) {
  const store = getStore(comp.storeId);
  const cloudLine = comp.driveUrl
    ? `<br /><a class="inline-link" href="${escapeHtml(comp.driveUrl)}" target="_blank" rel="noopener">查看 Google Drive 照片</a>`
    : (comp.image ? `<br />雲端狀態：${escapeHtml(cloudStatusLabel(comp.cloudStatus))}` : "");
  const imgHtml = comp.image ? `<div class="card-image-wrapper"><img src="${comp.image}" alt="客訴照" /></div>` : "";
  return `
    <details class="info-card complaint-card">
      <summary class="hold-summary">
        <span class="hold-summary-text">
          <strong>${escapeHtml(comp.category)}</strong>
          <span>${escapeHtml(store?.name || t("未指定店家"))}</span>
          <span>問題描述：${escapeHtml(comp.issueDescription)}</span>
        </span>
        <span class="badge status-${comp.status}">${escapeHtml(comp.status)}</span>
      </summary>
      <div class="meta hold-detail">
        ${imgHtml}
        問題描述：<br />
        <pre class="pre-text">${escapeHtml(comp.issueDescription)}</pre>
        處理協調紀錄：<br />
        <pre class="pre-text">${escapeHtml(comp.coordinationLog || "無協調紀錄")}</pre>${cloudLine}<br />
        建立時間：${formatDate(comp.createdAt)}
      </div>
      <div class="card-actions">
        <button class="small-button" data-action="edit-complaint" data-id="${comp.id}">編輯</button>
        <button class="small-button" data-action="delete-complaint" data-id="${comp.id}">刪除</button>
      </div>
    </details>
  `;
}

function initCalculator() {
  const unitSelect = document.querySelector("#calcUnitSelect");
  const areaInputLabel = document.querySelector("#calcAreaInputLabel");
  const lengthLabel = document.querySelector("#calcLengthLabel");
  const dimFields = document.querySelector("#calcDimFields");
  const sizeSelect = document.querySelector("#calcSizeSelect");
  const customSizeFields = document.querySelector("#calcCustomSizeFields");
  const boxPcsInput = document.querySelector("#calcBoxPcsInput");

  if (!unitSelect) return;

  unitSelect.addEventListener("change", () => {
    const isPing = unitSelect.value === "ping";
    if (areaInputLabel) areaInputLabel.style.display = isPing ? "block" : "none";
    if (lengthLabel) lengthLabel.style.display = isPing ? "none" : "block";
    if (dimFields) dimFields.style.display = isPing ? "none" : "flex";
    calculateTile();
  });

  sizeSelect.addEventListener("change", () => {
    const isCustom = sizeSelect.value === "custom";
    if (customSizeFields) customSizeFields.style.display = isCustom ? "flex" : "none";
    const selectedOption = sizeSelect.options[sizeSelect.selectedIndex];
    if (selectedOption && !isCustom) {
      boxPcsInput.value = selectedOption.dataset.boxPcs || 1;
    }
    calculateTile();
  });

  const allInputs = [
    "#calcAreaInput", "#calcLengthInput", "#calcWidthInput", "#calcLossInput",
    "#calcBoxPcsInput", "#calcCustomL", "#calcCustomW", "#calcPriceUnit", "#calcUnitPrice"
  ];
  allInputs.forEach(selector => {
    document.querySelector(selector)?.addEventListener("input", calculateTile);
    document.querySelector(selector)?.addEventListener("change", calculateTile);
  });
}

function calculateTile() {
  const unit = document.querySelector("#calcUnitSelect").value;
  const lossPct = parseFloat(document.querySelector("#calcLossInput").value) || 0;
  const sizeValue = document.querySelector("#calcSizeSelect").value;
  const boxPcs = parseInt(document.querySelector("#calcBoxPcsInput").value) || 1;
  const priceUnit = document.querySelector("#calcPriceUnit").value;
  const unitPrice = parseFloat(document.querySelector("#calcUnitPrice").value) || 0;

  let netSqm = 0;
  if (unit === "ping") {
    const ping = parseFloat(document.querySelector("#calcAreaInput").value) || 0;
    netSqm = ping * 3.305785;
  } else {
    const length = parseFloat(document.querySelector("#calcLengthInput").value) || 0;
    const width = parseFloat(document.querySelector("#calcWidthInput").value) || 0;
    netSqm = length * width;
  }

  const netPing = netSqm / 3.305785;
  const grossSqm = netSqm * (1 + lossPct / 100);
  const grossPing = grossSqm / 3.305785;

  let tileW_m = 0;
  let tileH_m = 0;
  if (sizeValue === "custom") {
    tileW_m = (parseFloat(document.querySelector("#calcCustomW").value) || 0) / 100;
    tileH_m = (parseFloat(document.querySelector("#calcCustomL").value) || 0) / 100;
  } else {
    const parts = sizeValue.split("x");
    tileW_m = parseFloat(parts[0]) / 100;
    tileH_m = parseFloat(parts[1]) / 100;
  }

  const tileArea_sqm = tileW_m * tileH_m;

  let netSheets = 0;
  let grossSheets = 0;
  let lossSheets = 0;
  let totalBoxes = 0;
  let totalCost = 0;

  if (tileArea_sqm > 0) {
    netSheets = Math.ceil(netSqm / tileArea_sqm);
    grossSheets = Math.ceil(grossSqm / tileArea_sqm);
    lossSheets = Math.max(0, grossSheets - netSheets);
    totalBoxes = Math.ceil(grossSheets / boxPcs);
  }

  if (priceUnit === "ping") {
    totalCost = Math.round(grossPing * unitPrice);
  } else {
    totalCost = Math.round(grossSheets * unitPrice);
  }

  setText("#resNetArea", `${netPing.toFixed(2)} 坪 (${netSqm.toFixed(2)} ㎡)`);
  setText("#resGrossArea", `${grossPing.toFixed(2)} 坪 (${grossSqm.toFixed(2)} ㎡)`);
  setText("#resNetSheets", `${netSheets} 片`);
  setText("#resLossSheets", `${lossSheets} 片`);
  setText("#resTotalSheets", `${grossSheets} 片`);
  setText("#resTotalBoxes", `${totalBoxes} 箱`);
  setText("#resTotalCost", `$${totalCost.toLocaleString()}`);
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

  const nav = document.querySelector(".bottom-nav");
  if (nav) nav.style.gridTemplateColumns = "";
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




function loadCloudConfig() {
  try {
    return { apiUrl: "", ...JSON.parse(localStorage.getItem(CLOUD_CONFIG_KEY)) };
  } catch {
    return { apiUrl: "" };
  }
}

function saveCloudConfig() {
  localStorage.setItem(CLOUD_CONFIG_KEY, JSON.stringify(cloudConfig));
}

function getCloudApiUrl() {
  return String(cloudConfig.apiUrl || DEFAULT_CLOUD_API_URL).trim();
}

function renderCloudStatus() {
  const urlInput = document.querySelector("#cloudApiUrl");
  if (urlInput && document.activeElement !== urlInput) urlInput.value = String(cloudConfig.apiUrl || "");
  const status = document.querySelector("#cloudStatus");
  const summary = document.querySelector("#cloudSummary");
  if (!status || !summary) return;
  status.textContent = cloudConfig.apiUrl ? "自訂連線" : "內建連線";
  status.className = "status-pill connected";
  summary.textContent = cloudConfig.apiUrl
    ? `目前使用管理員自訂 Apps Script URL。店家 ${state.stores.length} 筆、保留 ${state.holds.length} 筆、照片 ${state.photos.length} 張，可同步到 Google Sheet / Drive。`
    : `目前使用程式內建 Apps Script 連線，業務只要帳號密碼即可登入。店家 ${state.stores.length} 筆、保留 ${state.holds.length} 筆、照片 ${state.photos.length} 張，可同步到 Google Sheet / Drive。`;
}

async function runCloudTask(workingMessage, task) {
  try {
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
    projects: state.projects || [],
    samples: (state.samples || []).map(({ image, ...sample }) => sample),
    complaints: (state.complaints || []).map(({ image, ...complaint }) => complaint),
    photos: state.photos.map(({ image, ...photo }) => photo),
    salesOwners: state.salesOwners,
  });
}

let autoSyncTimer = null;

function startAutoSync() {
  if (autoSyncTimer) clearInterval(autoSyncTimer);
  autoSyncTimer = setInterval(async () => {
    if (state.currentUser && getCloudApiUrl()) {
      try {
        await syncFromCloud(true);
      } catch (e) {
        console.warn("Background auto-sync failed:", e);
      }
    }
  }, 30000);
}

function stopAutoSync() {
  if (autoSyncTimer) {
    clearInterval(autoSyncTimer);
    autoSyncTimer = null;
  }
}

function showSystemNotification(title, body) {
  if ("Notification" in window) {
    if (Notification.permission === "granted") {
      try {
        new Notification(title, {
          body,
          icon: "icons/apple-touch-icon.png?v=20260628-default-api-v1"
        });
      } catch (e) {
        console.warn("Notification creation failed:", e);
      }
    }
  }
  toast(`🔔 ${title}: ${body}`);
}

function requestNotificationPermission() {
  if ("Notification" in window) {
    if (Notification.permission === "default") {
      Notification.requestPermission().then(permission => {
        if (permission === "granted") {
          console.log("Notification permission granted.");
        }
      }).catch(e => console.warn("Requesting notification permission failed:", e));
    }
  }
}

async function syncFromCloud(silent = false) {
  const result = await sendCloudAction("readAll", { driveFolderId: GOOGLE_DRIVE_FOLDER_ID });
  
  let newHoldsCount = 0;
  if (state.currentUser && Array.isArray(result.holds)) {
    const localHoldIds = new Set(state.holds.map(h => h.id));
    result.holds.forEach(cloudHold => {
      if (!localHoldIds.has(cloudHold.id)) {
        const store = (result.stores || []).find(s => s.id === cloudHold.storeId);
        const owner = store?.salesOwner || cloudHold.salesOwner;
        if (owner === state.currentUser.salesOwner) {
          newHoldsCount++;
        }
      }
    });
  }

  if (Array.isArray(result.stores) && result.stores.length) state.stores = mergeById(state.stores, result.stores);
  if (Array.isArray(result.holds)) state.holds = mergeById(state.holds, result.holds);
  if (Array.isArray(result.projects)) state.projects = mergeById(state.projects || [], result.projects);
  if (Array.isArray(result.samples)) state.samples = mergeById(state.samples || [], result.samples);
  if (Array.isArray(result.complaints)) state.complaints = mergeById(state.complaints || [], result.complaints);
  if (Array.isArray(result.photos)) state.photos = mergeById(state.photos, result.photos);
  if (Array.isArray(result.tasks)) state.tasks = mergeById(state.tasks || [], result.tasks);
  if (Array.isArray(result.settings)) {
    state.settings = result.settings;
    populateSettingsUI();
  }
  
  saveState();

  if (newHoldsCount > 0) {
    showSystemNotification(
      "您有新的保留提醒",
      `管理員或系統為您新增了 ${newHoldsCount} 筆新的保留物品提醒，請至「保留」頁面確認。`
    );
    render();
  }

  if (!silent) toast("已從 Google 後台同步資料");
  return { message: "已從 Google 後台同步資料" };
}

async function uploadPhotoToCloud(photo, imageDataUrl, targetTable = "photos") {
  try {
    const store = getStore(photo.storeId);
    const result = await sendCloudAction("uploadPhoto", {
      driveFolderId: GOOGLE_DRIVE_FOLDER_ID,
      targetTable,
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
  const userContext = state.currentUser ? {
    username: state.currentUser.username,
    displayName: state.currentUser.displayName,
    role: state.currentUser.role,
    salesOwner: state.currentUser.salesOwner
  } : null;
  const body = JSON.stringify({ action, userContext, ...payload });
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
  const cloudIds = new Set(cloudItems.map(item => item.id).filter(Boolean));
  
  // 1. Filter out local items that were deleted on the cloud.
  // A local item was deleted on the cloud if it's missing from cloudItems AND doesn't have unsynced local edits.
  const filteredLocal = localItems.filter(item => {
    const isLocalOnly = !cloudIds.has(item.id);
    const hasUnsyncedEdits = item.edited || item.ownerEdited;
    if (isLocalOnly && !hasUnsyncedEdits) {
      return false; // Deleted on cloud
    }
    return true;
  });

  const merged = new Map(filteredLocal.map((item) => [item.id, item]));
  cloudItems.forEach((item) => {
    if (!item.id) return;
    const localItem = merged.get(item.id);
    if (localItem) {
      if (localItem.edited) {
        merged.set(item.id, {
          ...localItem,
          ...item,
          edited: false
        });
      } else if (localItem.ownerEdited) {
        merged.set(item.id, {
          ...localItem,
          ...item,
          ownerEdited: false
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


function normalizeInitialView(view) {
  const allowed = new Set(["home", "stores", "holds", "projects", "samples", "complaints", "calculator", "salesReport", "inventory", "admin"]);
  const normalized = String(view || "").trim();
  return allowed.has(normalized) ? normalized : "";
}

function consumePendingInitialView() {
  const view = normalizeInitialView(localStorage.getItem("pendingInitialView"));
  if (view) localStorage.removeItem("pendingInitialView");
  return view;
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
    if (view === "projects") title = "案場登錄";
    if (view === "samples") title = "樣架與目錄本";
    if (view === "complaints") title = "售後服務追蹤";
  }
  setTextSafe("#viewTitle", title);
  
  closeComboPanels();
  loadExternalFrame(view);
  window.scrollTo({ top: 0, behavior: "smooth" });
  render();
}

function loadExternalFrame(view) {
  const frameByView = { salesReport: "salesReportFrame", inventory: "inventoryFrame" };
  const frameId = frameByView[view];
  if (!frameId) return;
  loadFrameById(frameId);
}

function setupExternalFrameLoaders() {
  ["salesReportFrame", "inventoryFrame"].forEach((frameId) => {
    const frame = document.querySelector(`#${frameId}`);
    if (!frame) return;
    frame.addEventListener("load", () => setFrameLoading(frameId, false));
  });
}

function buildFrameSrc(frameId) {
  const frame = document.querySelector(`#${frameId}`);
  if (!frame) return "";
  let src = frame.dataset.src;
  if (frameId === "salesReportFrame") {
    src = SALES_REPORT_URL;
    const permissions = state.currentPermissions || { canViewAllStores: true };
    if (!permissions.canViewAllStores && state.currentUser && state.currentUser.salesOwner) {
      const url = new URL(src);
      url.searchParams.set("salesperson", state.currentUser.salesOwner);
      src = url.toString();
    }
  }
  return src;
}

function loadFrameById(frameId, { force = false } = {}) {
  const frame = document.querySelector(`#${frameId}`);
  if (!frame) return;
  const src = buildFrameSrc(frameId);
  if (!src) return;
  if (!force && frame.dataset.loadedSrc === src && frame.src) return;
  setFrameLoading(frameId, true);
  frame.dataset.loadedSrc = src;
  frame.src = force ? addCacheBust(src) : src;
}

function warmSalesReportFrame() {
  const run = () => {
    if (!state.currentUser) return;
    loadFrameById("salesReportFrame");
  };
  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(run, { timeout: 1800 });
  } else {
    window.setTimeout(run, 600);
  }
}

function setFrameLoading(frameId, isLoading) {
  const panel = document.querySelector(`[data-frame-panel="${frameId}"]`);
  if (panel) panel.classList.toggle("is-loading", isLoading);
}

function addCacheBust(src) {
  const url = new URL(src);
  url.searchParams.set("_refresh", Date.now().toString());
  return url.toString();
}

function reloadFrame(frameId) {
  const frame = document.querySelector(`#${frameId}`);
  if (!frame) {
    toast("找不到要重新整理的表格");
    return;
  }
  loadFrameById(frameId, { force: true });
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
    projectStore: { input: "#projectStoreInput", hidden: "#projectStoreId" },
    sampleStore: { input: "#sampleStoreInput", hidden: "#sampleStoreId" },
    complaintStore: { input: "#complaintStoreInput", hidden: "#complaintStoreId" },
  }[combo];
}

function syncHoldStoreIdFromInput() {
  syncStoreIdFromInput("#holdStoreInput", "#holdStoreId");
}

function syncPhotoStoreIdFromInput() {
  syncStoreIdFromInput("#photoStoreInput", "#photoStoreId");
}

function syncProjectStoreIdFromInput() {
  syncStoreIdFromInput("#projectStoreInput", "#projectStoreId");
}

function syncSampleStoreIdFromInput() {
  syncStoreIdFromInput("#sampleStoreInput", "#sampleStoreId");
}

function syncComplaintStoreIdFromInput() {
  syncStoreIdFromInput("#complaintStoreInput", "#complaintStoreId");
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
      const preservedOwner = existing.ownerEdited
        ? existing.salesOwner
        : (incoming.ownerSource === "area-simulation-18x6"
          ? resolvedIncomingOwner
          : (existing.edited ? existing.salesOwner : resolvedIncomingOwner));
      
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
          ownerEdited: existing.ownerEdited || false
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

function loadAppSettings() {
  try {
    return { quickShortcutsEnabled: true, ...JSON.parse(localStorage.getItem(APP_SETTINGS_KEY)) };
  } catch {
    return { quickShortcutsEnabled: true };
  }
}

function saveAppSettings() {
  localStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(appSettings));
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
  if (!value) return new Date();
  const str = String(value).trim().replace(/\//g, "-");
  let [year, month, day] = str.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return new Date();
  if (year < 1000) {
    year += 1911;
  }
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
      case "案場報備": return "案場登錄";
      case "樣品與展示架": return "樣架與目錄本";
      case "售後客訴": return "售後服務追蹤";
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
  const storesMenuCard = document.querySelector(".domain-card[data-view='stores']");
  if (storesMenuCard) {
    const strong = storesMenuCard.querySelector("strong");
    const p = storesMenuCard.querySelector("p");
    if (strong) strong.textContent = isRetail ? "設計公司/業主" : "店家";
    if (p) p.textContent = isRetail ? "查看名下設計公司、設計師、業主案名與工地資料" : "查看業務名下店家、電話、地址與聯絡資料";
  }

  const projectsMenuCard = document.querySelector(".domain-card[data-view='projects']");
  if (projectsMenuCard) {
    const strong = projectsMenuCard.querySelector("strong");
    const p = projectsMenuCard.querySelector("p");
    if (strong) strong.textContent = isRetail ? "案場登錄" : "案場報備";
    if (p) p.textContent = isRetail ? "登錄目前跟進的設計案、樣品及估價明細" : "報備進行中的工程案場，保障業務開發權益";
  }

  const samplesMenuCard = document.querySelector(".domain-card[data-view='samples']");
  if (samplesMenuCard) {
    const strong = samplesMenuCard.querySelector("strong");
    const p = samplesMenuCard.querySelector("p");
    if (strong) strong.textContent = isRetail ? "樣架與目錄本" : "樣品與展示架";
    if (p) p.textContent = isRetail ? "登記擺放於設計公司的目錄本與展示瓷磚進度" : "追蹤放置於店家的目錄本、展示瓷磚與展架巡查";
  }

  const complaintsMenuCard = document.querySelector(".domain-card[data-view='complaints']");
  if (complaintsMenuCard) {
    const strong = complaintsMenuCard.querySelector("strong");
    const p = complaintsMenuCard.querySelector("p");
    if (strong) strong.textContent = isRetail ? "售後服務追蹤" : "售後客訴追蹤";
    if (p) p.textContent = isRetail ? "記錄色差、破損等售後問題與補退貨進度" : "處理瓷磚破損、色差等問題的跟進狀態與照片";
  }

  // 2. 底部導覽列按鈕
  const storesNavBtn = document.querySelector(".bottom-nav .nav-item[data-view='stores']");
  if (storesNavBtn) {
    storesNavBtn.textContent = isRetail ? "設計/業主" : "店家";
  }
  const projectsNavBtn = document.querySelector(".bottom-nav .nav-item[data-view='projects']");
  if (projectsNavBtn) {
    projectsNavBtn.textContent = isRetail ? "案場登錄" : "案場";
  }
  const samplesNavBtn = document.querySelector(".bottom-nav .nav-item[data-view='samples']");
  if (samplesNavBtn) {
    samplesNavBtn.textContent = isRetail ? "樣架" : "樣品";
  }
  const complaintsNavBtn = document.querySelector(".bottom-nav .nav-item[data-view='complaints']");
  if (complaintsNavBtn) {
    complaintsNavBtn.textContent = isRetail ? "售後" : "客訴";
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

  // 5. 案場報備表單
  const projectForm = document.querySelector("#projectForm");
  if (projectForm) {
    const header = document.querySelector("#projectsView .view-toolbar h1");
    if (header) header.textContent = isRetail ? "案場登錄" : "案場報備";

    const storeLabelText = document.querySelector(".projects-label-store");
    if (storeLabelText) storeLabelText.textContent = isRetail ? "設計公司/業主" : "店家";

    const storeInput = document.querySelector("#projectStoreInput");
    if (storeInput) storeInput.placeholder = isRetail ? "輸入設計案名或設計公司關鍵字" : "輸入店家編號或名稱關鍵字";

    const submitBtn = document.querySelector("#projectSubmitButton");
    if (submitBtn && editingProjectId === null) {
      submitBtn.textContent = isRetail ? "新增案場登錄" : "新增案場報備";
    }
  }

  // 6. 樣品表單
  const sampleForm = document.querySelector("#sampleForm");
  if (sampleForm) {
    const header = document.querySelector("#samplesView .view-toolbar h1");
    if (header) header.textContent = isRetail ? "樣架與目錄本" : "樣品與展示架";

    const storeLabelText = document.querySelector(".samples-label-store");
    if (storeLabelText) storeLabelText.textContent = isRetail ? "設計公司/業主" : "店家";

    const storeInput = document.querySelector("#sampleStoreInput");
    if (storeInput) storeInput.placeholder = isRetail ? "輸入設計案名或設計公司關鍵字" : "輸入店家編號或名稱關鍵字";

    const submitBtn = document.querySelector("#sampleSubmitButton");
    if (submitBtn && editingSampleId === null) {
      submitBtn.textContent = isRetail ? "新增樣架目錄記錄" : "新增樣品展架記錄";
    }
  }

  // 7. 客訴表單
  const complaintForm = document.querySelector("#complaintForm");
  if (complaintForm) {
    const header = document.querySelector("#complaintsView .view-toolbar h1");
    if (header) header.textContent = isRetail ? "售後服務追蹤" : "售後客訴";

    const storeLabelText = document.querySelector(".complaints-label-store");
    if (storeLabelText) storeLabelText.textContent = isRetail ? "設計公司/業主" : "店家";

    const storeInput = document.querySelector("#complaintStoreInput");
    if (storeInput) storeInput.placeholder = isRetail ? "輸入設計案名或設計公司關鍵字" : "輸入店家編號或名稱關鍵字";

    const submitBtn = document.querySelector("#complaintSubmitButton");
    if (submitBtn && editingComplaintId === null) {
      submitBtn.textContent = isRetail ? "新增售後服務單" : "新增售後客訴單";
    }
  }
}

// Check and capture LINE/query params
const urlParams = new URLSearchParams(window.location.search);
const lineUserId = urlParams.get("lineUserId");
const requestedView = normalizeInitialView(urlParams.get("view"));
if (requestedView) {
  localStorage.setItem("pendingInitialView", requestedView);
}
if (lineUserId && lineUserId.trim().startsWith("U")) {
  localStorage.setItem("lineUserId", lineUserId.trim());
  toast("已獲取 LINE 身分，請登入您的業務/管理員帳號以完成綁定 🔗");
}
if (lineUserId || requestedView) {
  window.history.replaceState({}, document.title, window.location.pathname);
}

render();
const initialView = consumePendingInitialView();
if (state.currentUser && initialView) {
  setView(initialView);
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js?v=20260628-default-api-v11").catch(() => {});
  });
  
  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!refreshing) {
      refreshing = true;
      window.location.reload();
    }
  });
}

if (state.currentUser) {
  requestNotificationPermission();
  startAutoSync();
  syncFromCloud(true).catch((e) => console.warn("Initial background sync failed:", e));
}

// Task Center MVP Helpers & Listeners
document.querySelector("#filterTaskStatus")?.addEventListener("change", () => renderTasks());
document.querySelector("#filterTaskRole")?.addEventListener("change", () => renderTasks());
document.querySelector("#filterTaskAssignee")?.addEventListener("change", () => renderTasks());

document.querySelector("#filterTaskDueDate")?.addEventListener("change", (e) => {
  filterTaskDueDate = e.target.value;
  renderTasks();
});

document.querySelector("#sortTaskOrder")?.addEventListener("change", (e) => {
  sortTaskOrder = e.target.value;
  renderTasks();
});

document.querySelector("#taskSearchKeyword")?.addEventListener("input", (e) => {
  taskSearchKeyword = e.target.value;
  renderTasks();
});

document.querySelector("#clearTaskFilters")?.addEventListener("click", () => {
  taskSearchKeyword = "";
  filterTaskDueDate = "all";
  sortTaskOrder = "default";
  const searchInput = document.querySelector("#taskSearchKeyword");
  if (searchInput) searchInput.value = "";

  const statusSelect = document.querySelector("#filterTaskStatus");
  if (statusSelect) {
    statusSelect.value = (state.currentUser?.role === "assistant") ? "assistantActive" : "all";
  }

  const roleSelect = document.querySelector("#filterTaskRole");
  if (roleSelect) roleSelect.value = "all";

  const assigneeSelect = document.querySelector("#filterTaskAssignee");
  if (assigneeSelect) assigneeSelect.value = "all";

  const dueDateSelect = document.querySelector("#filterTaskDueDate");
  if (dueDateSelect) dueDateSelect.value = "all";

  const sortSelect = document.querySelector("#sortTaskOrder");
  if (sortSelect) sortSelect.value = "default";

  renderTasks();
});

function renderTasks() {
  const container = document.querySelector("#tasksList");
  if (!container) return;

  populateTaskAssignees();

  const statusSelect = document.querySelector("#filterTaskStatus");
  if (statusSelect && !statusSelect.dataset.initialized) {
    if (state.currentUser?.role === "assistant") {
      statusSelect.value = "assistantActive";
    } else {
      statusSelect.value = "all";
    }
    statusSelect.dataset.initialized = "true";
  }

  const statusFilter = statusSelect?.value || "all";
  const roleFilter = document.querySelector("#filterTaskRole")?.value || "all";
  const assigneeFilter = document.querySelector("#filterTaskAssignee")?.value || "all";

  const userRole = state.currentUser ? state.currentUser.role : null;
  const username = state.currentUser ? state.currentUser.username : "";
  const displayName = state.currentUser ? state.currentUser.displayName : "";
  const salesOwner = state.currentUser ? state.currentUser.salesOwner : "";

  if (!userRole) {
    container.innerHTML = `<div class="empty-state">沒有權限查看工作任務</div>`;
    return;
  }

  let tasks = state.tasks || [];

  const visibleTasks = tasks.filter(task => {
    if (userRole === "retail" || userRole === "showroom" || userRole === "retailSales" || userRole === "showroomSales" || userRole === "sales") {
      const isAssignedToMe = (task.assignedTo && (task.assignedTo === username || task.assignedTo === displayName || task.assignedTo === salesOwner));
      const isCreatedByMe = (task.createdBy && (task.createdBy === username || task.createdBy === displayName));
      return isAssignedToMe || isCreatedByMe;
    } else if (userRole === "assistant") {
      const isAssignedToMe = (task.assignedTo && (task.assignedTo === username || task.assignedTo === displayName || task.assignedTo === salesOwner));
      return task.assignedRole === "assistant" || isAssignedToMe;
    } else if (userRole === "admin" || userRole === "boss") {
      return true;
    }
    return false;
  });

  const stats = getTaskSummaryStats_(visibleTasks);

  const filtered = visibleTasks.filter(task => {
    // 2. Status Filter
    if (statusFilter === "assistantActive") {
      if (task.assignedRole !== "assistant") return false;
      if (task.status === "Finished" || task.status === "done") return false;
    } else if (statusFilter === "dueToday") {
      const todayStr = getTodayDateString_();
      const parseToLocalYYYYMMDD = (val) => {
        if (!val) return "";
        if (val.includes("T")) {
          try {
            const d = new Date(val);
            if (!isNaN(d.getTime())) {
              const tzOffset = 8 * 60; // UTC+8
              const localTime = new Date(d.getTime() + tzOffset * 60000);
              const year = localTime.getUTCFullYear();
              const month = String(localTime.getUTCMonth() + 1).padStart(2, '0');
              const day = String(localTime.getUTCDate()).padStart(2, '0');
              return `${year}-${month}-${day}`;
            }
          } catch (e) {}
        }
        const match = val.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (match) {
          return match[0];
        }
        return val.split("T")[0];
      };
      if (parseToLocalYYYYMMDD(task.dueDate) !== todayStr) return false;
    } else if (statusFilter !== "all") {
      if (task.status !== statusFilter) return false;
    }

    // 3. Role Filter
    if (roleFilter !== "all") {
      if (task.assignedRole !== roleFilter) return false;
    }

    // 4. Assignee Filter
    if (assigneeFilter !== "all") {
      if (task.assignedTo !== assigneeFilter) return false;
    }

    // 5. Keyword Filter
    if (taskSearchKeyword && taskSearchKeyword.trim() !== "") {
      const q = taskSearchKeyword.trim().toLowerCase();
      const matchFields = [
        task.id,
        task.title,
        task.description,
        task.customerName,
        task.productName,
        task.assignedTo,
        task.assignedRole,
        task.createdBy,
        task.status,
        task.blockedReason
      ];
      const isMatched = matchFields.some(field => {
        if (!field) return false;
        return String(field).toLowerCase().includes(q);
      });
      if (!isMatched) return false;
    }

    // 6. Due Date Filter
    if (filterTaskDueDate !== "all") {
      const todayStr = getTodayDateString_();
      const taskLocalDate = parseToLocalYYYYMMDD(task.dueDate);

      if (filterTaskDueDate === "dueToday") {
        if (taskLocalDate !== todayStr) return false;
      } else if (filterTaskDueDate === "overdue") {
        if (!taskLocalDate || taskLocalDate >= todayStr) return false;
        const s = String(task.status || "").toLowerCase();
        if (s === "finished" || s === "done" || s === "cancelled") return false;
      } else if (filterTaskDueDate === "next7Days") {
        if (!taskLocalDate || taskLocalDate < todayStr) return false;
        const next7DaysDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        const next7Year = next7DaysDate.getFullYear();
        const next7Month = String(next7DaysDate.getMonth() + 1).padStart(2, '0');
        const next7Day = String(next7DaysDate.getDate()).padStart(2, '0');
        const next7Str = `${next7Year}-${next7Month}-${next7Day}`;
        if (taskLocalDate > next7Str) return false;
      } else if (filterTaskDueDate === "noDueDate") {
        if (taskLocalDate !== "") return false;
      }
    }

    return true;
  });

  const summaryHTML = `
    <div class="task-summary-grid" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 16px;">
      <div class="task-summary-card ${statusFilter === 'all' ? 'active' : ''}" data-task-summary-filter="all" style="background: rgba(255,255,255,0.05); padding: 10px; border-radius: 8px; text-align: center; cursor: pointer; border: 1px solid rgba(255,255,255,0.08); transition: all 0.2s;">
        <div style="font-size: 11px; color: rgba(255,255,255,0.55);">全部任務</div>
        <div style="font-size: 20px; font-weight: bold; margin-top: 4px; color: #fff;">${stats.total}</div>
      </div>
      <div class="task-summary-card ${statusFilter === 'assistantActive' ? 'active' : ''}" data-task-summary-filter="assistantActive" style="background: rgba(255,255,255,0.05); padding: 10px; border-radius: 8px; text-align: center; cursor: pointer; border: 1px solid rgba(255,255,255,0.08); transition: all 0.2s;">
        <div style="font-size: 11px; color: #ab68ff;">待處理</div>
        <div style="font-size: 20px; font-weight: bold; margin-top: 4px; color: #ab68ff;">${stats.assistantActive}</div>
      </div>
      <div class="task-summary-card ${statusFilter === 'Waiting' ? 'active' : ''}" data-task-summary-filter="Waiting" style="background: rgba(255,255,255,0.05); padding: 10px; border-radius: 8px; text-align: center; cursor: pointer; border: 1px solid rgba(255,255,255,0.08); transition: all 0.2s;">
        <div style="font-size: 11px; color: #f4bf58;">等資料</div>
        <div style="font-size: 20px; font-weight: bold; margin-top: 4px; color: #f4bf58;">${stats.waiting}</div>
      </div>
      <div class="task-summary-card ${statusFilter === 'Blocked' ? 'active' : ''}" data-task-summary-filter="Blocked" style="background: rgba(255,255,255,0.05); padding: 10px; border-radius: 8px; text-align: center; cursor: pointer; border: 1px solid rgba(255,255,255,0.08); transition: all 0.2s;">
        <div style="font-size: 11px; color: #ff756f;">異常</div>
        <div style="font-size: 20px; font-weight: bold; margin-top: 4px; color: #ff756f;">${stats.blocked}</div>
      </div>
      <div class="task-summary-card ${statusFilter === 'dueToday' ? 'active' : ''}" data-task-summary-filter="dueToday" style="background: rgba(255,255,255,0.05); padding: 10px; border-radius: 8px; text-align: center; cursor: pointer; border: 1px solid rgba(255,255,255,0.08); transition: all 0.2s;">
        <div style="font-size: 11px; color: #58a8ff;">今天到期</div>
        <div style="font-size: 20px; font-weight: bold; margin-top: 4px; color: #58a8ff;">${stats.dueToday}</div>
      </div>
      <div class="task-summary-card ${statusFilter === 'Finished' ? 'active' : ''}" data-task-summary-filter="Finished" style="background: rgba(255,255,255,0.05); padding: 10px; border-radius: 8px; text-align: center; cursor: pointer; border: 1px solid rgba(255,255,255,0.08); transition: all 0.2s;">
        <div style="font-size: 11px; color: #54e2b0;">已完成</div>
        <div style="font-size: 20px; font-weight: bold; margin-top: 4px; color: #54e2b0;">${stats.finished}</div>
      </div>
    </div>
  `;

  if (!filtered.length) {
    container.innerHTML = summaryHTML + `
      <div class="task-empty-state" style="text-align: center; padding: 40px 20px; background: rgba(255,255,255,0.03); border-radius: 12px; border: 1px dashed rgba(255,255,255,0.1); margin-top: 16px;">
        <div style="font-size: 32px; margin-bottom: 12px;">🔍</div>
        <h4 style="margin: 0 0 8px 0; color: #fff; font-size: 16px; font-weight: 600;">查無符合條件的任務</h4>
        <p style="margin: 0; color: rgba(255,255,255,0.5); font-size: 13px; line-height: 1.5;">可以調整篩選條件，或點擊「清除篩選」重設列表</p>
      </div>
    `;
    return;
  }

  const typeMap = {
    delivery: "🚚 送貨 (delivery)",
    reservation: "📦 保留 (reservation)",
    processing: "🏭 加工 (processing)",
    reminder: "☎ 回電 (reminder)",
    visit: "👤 拜訪 (visit)",
    quote: "📄 報價 (quote)",
    complaint: "⚠ 客訴 (complaint)",
    return: "🚛 收退貨 (return)",
    sample: "🧱 送樣 (sample)",
    orderInput: "📝 待打訂單 (orderInput)",
    reservationConfirm: "📦 待確認保留 (reservationConfirm)",
    processingArrange: "🏭 待安排加工 (processingArrange)",
    deliveryArrange: "🚚 待安排送貨 (deliveryArrange)",
    productReply: "💬 待回覆問貨 (productReply)",
    other: "📝 其他 (other)"
  };

  // statusMap removed for getTaskStatusMeta_ helper

  const priorityMap = {
    normal: "🔵 普通",
    high: "🟡 重要",
    urgent: "🔴 緊急"
  };

  const formatTaskDate_ = (value) => {
    if (!value) return "無";
    if (value.includes("T")) {
      try {
        const d = new Date(value);
        if (!isNaN(d.getTime())) {
          const tzOffset = 8 * 60; // UTC+8
          const localTime = new Date(d.getTime() + tzOffset * 60000);
          const year = localTime.getUTCFullYear();
          const month = String(localTime.getUTCMonth() + 1).padStart(2, '0');
          const day = String(localTime.getUTCDate()).padStart(2, '0');
          return `${year}/${month}/${day}`;
        }
      } catch (e) {}
    }
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) {
      return `${match[1]}/${match[2]}/${match[3]}`;
    }
    return value.replace(/-/g, "/").split("T")[0];
  };

  const formatTaskRole_ = (role) => {
    const roleMap = {
      assistant: "助理",
      sales: "業務",
      retailSales: "零售業務",
      showroomSales: "門市業務",
      admin: "管理員",
      boss: "主管"
    };
    return roleMap[role] || role || "無";
  };

  const sortedTasks = applyTaskSort_(filtered, sortTaskOrder);
  container.innerHTML = summaryHTML + sortedTasks.map(t => {
    const detailKey = encodeURIComponent(String(t.id || ""));
    const typeLabel = typeMap[t.type] || t.type || "無";
    const statusMeta = getTaskStatusMeta_(t.status);
    const statusLabel = statusMeta.label;
    const priorityLabel = priorityMap[t.priority] || t.priority || "無";

    let priorityClass = "";
    if (t.priority === "urgent") priorityClass = "danger";
    else if (t.priority === "high") priorityClass = "warning";

    let assigneeText = "";
    if (t.assignedTo) {
      assigneeText = t.assignedTo;
    } else if (t.assignedRole === "assistant") {
      assigneeText = "助理群組";
    } else if (t.assignedRole) {
      assigneeText = "未指定人員";
    } else {
      assigneeText = "未指派";
    }

    const todayStr = getTodayDateString_();
    const taskLocalDate = parseToLocalYYYYMMDD(t.dueDate);
    const isFinishedOrCancelled = (t.status === "Finished" || t.status === "done" || t.status === "Cancelled" || t.status === "cancelled");
    const isFinished = (t.status === "Finished" || t.status === "done");

    let dueAlertHTML = "";
    if (!isFinishedOrCancelled) {
      if (taskLocalDate === todayStr) {
        dueAlertHTML = `
          <span style="font-size: 11px; font-weight: bold; color: #ff9800; background: rgba(255,152,0,0.12); padding: 3px 8px; border-radius: 6px; border: 1px solid rgba(255,152,0,0.25); display: inline-flex; align-items: center; gap: 4px;">
            ⚠️ 今天到期
          </span>
        `;
      } else if (taskLocalDate && taskLocalDate < todayStr) {
        dueAlertHTML = `
          <span style="font-size: 11px; font-weight: bold; color: #ff5252; background: rgba(255,82,82,0.12); padding: 3px 8px; border-radius: 6px; border: 1px solid rgba(255,82,82,0.25); display: inline-flex; align-items: center; gap: 4px;">
            🚨 已逾期
          </span>
        `;
      }
    }

    return `
      <article class="info-card task-card ${statusMeta.className} ${isFinished ? 'task-card-finished' : ''}">
        <div class="card-header">
          <h2>${escapeHtml(t.title || "無標題")}</h2>
          <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
            ${dueAlertHTML}
            <span class="task-status-badge ${statusMeta.className}">${escapeHtml(statusLabel)}</span>
            <span class="badge ${priorityClass}">${escapeHtml(priorityLabel)}</span>
          </div>
        </div>
        <div class="meta" style="line-height: 1.6; color: rgba(255,255,255,0.75);">
          <div style="display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,0.06); padding-bottom: 8px;">
            <span style="font-size: 11px; padding: 3px 8px; border-radius: 6px; background: rgba(84,151,255,0.15); color: #7cb1ff; font-weight: 500; display: inline-flex; align-items: center; gap: 4px;">
              📅 到期：${escapeHtml(formatTaskDate_(t.dueDate))}
            </span>
            <span style="font-size: 11px; padding: 3px 8px; border-radius: 6px; background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.85); font-weight: 500; display: inline-flex; align-items: center; gap: 4px;">
              👤 指派：${escapeHtml(assigneeText)} ${t.assignedRole ? `(${escapeHtml(formatTaskRole_(t.assignedRole))})` : ""}
            </span>
            <span style="font-size: 11px; padding: 3px 8px; border-radius: 6px; background: rgba(139,92,246,0.15); color: #a78bfa; font-weight: 500;">
              📂 類別：${escapeHtml(typeLabel)}
            </span>
          </div>
          
          <div style="font-size: 13px; display: flex; flex-direction: column; gap: 4px;">
            ${t.customerName ? `<div><strong>客戶/店家：</strong><span style="color: #fff;">${escapeHtml(t.customerName)}</span></div>` : ""}
            ${t.productName ? `<div><strong>商品/數量：</strong><span style="color: #fff;">${escapeHtml(t.productName)} x ${escapeHtml(t.quantity || 1)}</span></div>` : ""}
            <div><strong>狀態：</strong>${escapeHtml(statusLabel)} (${escapeHtml(t.status || "無")})</div>
            ${t.sourceUser ? `<div><strong>交辦人：</strong>${escapeHtml(t.sourceUser)} ${t.sourceRole ? `(${escapeHtml(formatTaskRole_(t.sourceRole))})` : ""}</div>` : (t.createdBy ? `<div><strong>交辦人：</strong>${escapeHtml(t.createdBy)}</div>` : "")}
            ${t.parentWorkId ? `<div><strong>來源工作 ID：</strong>${escapeHtml(t.parentWorkId)}</div>` : ""}
            ${t.updatedAt ? `<div><strong>最後更新：</strong>${escapeHtml(formatTaskDate_(t.updatedAt))} ${t.updatedBy ? `by ${escapeHtml(t.updatedBy)}` : ""}</div>` : ""}
            ${t.description ? `<pre class="pre-text" style="margin-top: 6px; padding: 8px; background: rgba(0,0,0,0.15); border-radius: 6px; font-size: 12px; border: 1px solid rgba(255,255,255,0.03);">說明：${escapeHtml(t.description)}</pre>` : ""}
            ${t.note ? `<pre class="pre-text" style="border-left: 3px solid var(--gold); padding-left: 8px; font-size: 12px; margin-top: 6px;">備註：${escapeHtml(t.note)}</pre>` : ""}
            ${t.blockedReason ? `<div style="color: #ff5252; margin-top: 4px; font-weight: bold; font-size: 12px; padding: 6px 10px; background: rgba(255,82,82,0.1); border-radius: 6px; border: 1px solid rgba(255,82,82,0.15);">異常原因：${escapeHtml(t.blockedReason)}</div>` : ""}
          </div>
        </div>
        <div style="margin-top: 8px; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 8px; display: flex; justify-content: flex-end;">
          <button type="button" class="secondary-button" style="padding: 4px 10px; font-size: 13px;" data-task-detail-toggle="${escapeHtml(detailKey)}">查看詳情 ▾</button>
        </div>
        <div class="task-detail-panel" id="detail-panel-${escapeHtml(detailKey)}" style="display: none; margin-top: 12px; padding: 12px; background: var(--panel-2); border-radius: 8px; border-left: 3px solid var(--accent, #8b5cf6);">
          <h4 style="margin-top: 0; margin-bottom: 8px; color: #fff; font-size: 14px;">工作完整詳情</h4>
          <div class="task-detail-grid" style="font-size: 13px; color: rgba(255,255,255,0.75);">
            <div><strong>任務 ID：</strong>${escapeHtml(t.id || "無")}</div>
            <div><strong>工作類型：</strong>${escapeHtml(typeLabel)} (${escapeHtml(t.type || "無")})</div>
            <div><strong>標題：</strong>${escapeHtml(t.title || "無")}</div>
            <div><strong>狀態：</strong>${escapeHtml(statusLabel)} (${escapeHtml(t.status || "無")})</div>
            <div><strong>優先權：</strong>${escapeHtml(priorityLabel)}</div>
            <div><strong>到期日：</strong>${escapeHtml(formatTaskDate_(t.dueDate))}</div>
            <div><strong>指派角色：</strong>${escapeHtml(formatTaskRole_(t.assignedRole))}</div>
            <div><strong>指派對象：</strong>${escapeHtml(assigneeText)}</div>
            ${t.customerName ? `<div><strong>客戶/店家：</strong>${escapeHtml(t.customerName)}</div>` : ""}
            ${t.productName ? `<div><strong>商品/數量：</strong>${escapeHtml(t.productName)} x ${escapeHtml(t.quantity || 1)}</div>` : ""}
            <div><strong>交辦人：</strong>${escapeHtml(t.sourceUser || t.createdBy || "無")}</div>
            ${t.sourceRole ? `<div><strong>交辦角色：</strong>${escapeHtml(formatTaskRole_(t.sourceRole))}</div>` : ""}
            ${t.parentWorkId ? `<div><strong>來源工作 ID：</strong>${escapeHtml(t.parentWorkId)}</div>` : ""}
            ${t.startedAt ? `<div><strong>開始時間：</strong>${escapeHtml(formatTaskDate_(t.startedAt))}</div>` : ""}
            ${t.completedAt ? `<div><strong>完成時間：</strong>${escapeHtml(formatTaskDate_(t.completedAt))}</div>` : ""}
            ${t.updatedAt ? `<div><strong>最後更新：</strong>${escapeHtml(formatTaskDate_(t.updatedAt))} ${t.updatedBy ? `by ${escapeHtml(t.updatedBy)}` : ""}</div>` : ""}
            ${t.blockedReason ? `<div style="color: #ff5252; font-weight: bold; grid-column: 1 / -1; padding: 6px 10px; background: rgba(255,82,82,0.1); border-radius: 6px; border: 1px solid rgba(255,82,82,0.15); margin-top: 4px;"><strong>異常原因：</strong>${escapeHtml(t.blockedReason)}</div>` : ""}
          </div>
          ${t.description ? `<div style="margin-top: 8px; font-size: 13px; color: rgba(255,255,255,0.85);"><strong style="display:block;margin-bottom:2px;">詳細說明：</strong><pre class="pre-text" style="margin:0; white-space: pre-wrap;">${escapeHtml(t.description)}</pre></div>` : ""}
          ${t.note ? `<div style="margin-top: 8px; font-size: 13px; color: rgba(255,255,255,0.85);"><strong style="display:block;margin-bottom:2px;">備註：</strong><pre class="pre-text" style="margin:0; border-left: 3px solid var(--gold); padding-left: 8px; white-space: pre-wrap;">${escapeHtml(t.note)}</pre></div>` : ""}
          ${renderTaskAuditHistory_(t.id)}
          ${(canCurrentUserCompleteTask_(t) || canCurrentUserReportTaskIssue_(t) || canCurrentUserRequestTaskInfo_(t)) ? `
            <div class="task-action-group" style="margin-top: 12px; display: flex; flex-direction: column; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 12px; gap: 8px;">
              <div style="font-size: 12px; color: rgba(255,255,255,0.5); margin-bottom: 4px;">📋 任務操作：</div>
              <div style="display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 8px;">
                ${canCurrentUserRequestTaskInfo_(t) ? `
                  <button type="button" class="primary-button task-waiting-toggle-button" style="background: rgba(244,191,88,0.15) !important; color: #f4bf58 !important; border: 1px solid rgba(244,191,88,0.3) !important; box-shadow: none !important; font-size: 13px; padding: 6px 12px;" data-task-waiting-toggle-btn="${escapeHtml(detailKey)}">⏳ 等待資料</button>
                ` : ""}
                ${canCurrentUserReportTaskIssue_(t) ? `
                  <button type="button" class="primary-button task-issue-toggle-button" style="background: rgba(255,82,82,0.15) !important; color: #ff5252 !important; border: 1px solid rgba(255,82,82,0.3) !important; box-shadow: none !important; font-size: 13px; padding: 6px 12px;" data-task-issue-toggle-btn="${escapeHtml(detailKey)}">⚠️ 回報異常</button>
                ` : ""}
                ${canCurrentUserCompleteTask_(t) ? `
                  <button type="button" class="primary-button task-complete-button" style="background: rgba(84,226,176,0.15) !important; color: #54e2b0 !important; border: 1px solid rgba(84,226,176,0.3) !important; box-shadow: none !important; font-size: 13px; padding: 6px 12px;" data-task-complete-btn="${escapeHtml(detailKey)}">✅ 完成工作</button>
                ` : ""}
              </div>
              ${pwaTaskIssueReasonOpen.has(t.id) ? `
                <div class="task-issue-options-panel" style="margin-top: 4px; display: flex; flex-direction: column; gap: 6px; background: rgba(255,255,255,0.03); padding: 10px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.06);">
                  <div style="font-size: 12px; color: rgba(255,255,255,0.6); margin-bottom: 2px;">選擇發生的問題類型（固定選項）：</div>
                  <div style="display: flex; flex-wrap: wrap; gap: 6px;">
                    ${getPwaBlockedReasons_().map(reason => `
                      <button type="button" class="primary-button task-issue-option-btn" data-task-issue-submit-btn="${escapeHtml(detailKey)}" data-reason="${escapeHtml(reason)}">${escapeHtml(reason)}</button>
                    `).join("")}
                  </div>
                </div>
              ` : ""}
              ${pwaTaskWaitingReasonOpen.has(t.id) ? `
                <div class="task-waiting-options-panel" style="margin-top: 4px; display: flex; flex-direction: column; gap: 6px; background: rgba(255,255,255,0.03); padding: 10px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.06);">
                  <div style="font-size: 12px; color: rgba(255,255,255,0.6); margin-bottom: 2px;">選擇缺少的資料類型（固定選項）：</div>
                  <div style="display: flex; flex-wrap: wrap; gap: 6px;">
                    ${getPwaWaitingReasons_().map(reason => `
                      <button type="button" class="primary-button task-waiting-option-btn" data-task-waiting-submit-btn="${escapeHtml(detailKey)}" data-reason="${escapeHtml(reason)}">${escapeHtml(reason)}</button>
                    `).join("")}
                  </div>
                </div>
              ` : ""}
            </div>
          ` : `
            ${(String(t.status || "").toLowerCase() === "finished" || String(t.status || "").toLowerCase() === "done" || String(t.status || "").toLowerCase() === "cancelled") ? `
              <div style="margin-top: 12px; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 12px; text-align: center; font-size: 12px; color: rgba(255,255,255,0.4); display: flex; align-items: center; justify-content: center; gap: 4px;">
                🔒 此任務已封存，目前無可用操作
              </div>
            ` : ""}
          `}
        </div>
      </article>
    `;
  }).join("");
}

function populateTaskAssignees() {
  const filterAssignee = document.querySelector("#filterTaskAssignee");
  if (!filterAssignee) return;
  
  const owners = state.salesOwners || [];
  
  if (filterAssignee.children.length <= 1) {
    let filterHtml = `<option value="all">所有指派對象</option>`;
    owners.forEach(owner => {
      filterHtml += `<option value="${escapeHtml(owner)}">${escapeHtml(owner)}</option>`;
    });
    filterAssignee.innerHTML = filterHtml;
  }
}

function getTodayDateString_() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getTaskDateTimeSortValue_(value) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return isNaN(parsed) ? null : parsed;
}

function compareTaskDateTimeDesc_(aValue, bValue) {
  const tA = getTaskDateTimeSortValue_(aValue);
  const tB = getTaskDateTimeSortValue_(bValue);

  if (tA === null && tB !== null) return 1;
  if (tA !== null && tB === null) return -1;
  if (tA === null && tB === null) return 0;

  return tB - tA; // desc: newest first
}

function getTaskDueDateSortValue_(value) {
  if (!value) return null;
  const parsed = parseToLocalYYYYMMDD(value);
  return parsed === "" ? null : parsed;
}

function compareTaskDueDateAsc_(aValue, bValue) {
  const dA = getTaskDueDateSortValue_(aValue);
  const dB = getTaskDueDateSortValue_(bValue);

  if (dA === null && dB !== null) return 1;
  if (dA !== null && dB === null) return -1;
  if (dA === null && dB === null) return 0;

  return dA.localeCompare(dB); // asc: closest first
}

function applyTaskSort_(tasks, sortKey) {
  const decorated = [...tasks].map((task, index) => ({ task, index }));

  if (sortKey === "default") {
    return decorated.map(({ task }) => task);
  }

  decorated.sort((left, right) => {
    const a = left.task;
    const b = right.task;

    let result = 0;
    if (sortKey === "updatedAtDesc") {
      result = compareTaskDateTimeDesc_(a.updatedAt, b.updatedAt);
    } else if (sortKey === "createdAtDesc") {
      result = compareTaskDateTimeDesc_(a.createdAt, b.createdAt);
    } else if (sortKey === "dueDateAsc") {
      result = compareTaskDueDateAsc_(a.dueDate, b.dueDate);
    }

    return result || (left.index - right.index);
  });

  return decorated.map(({ task }) => task);
}

function renderTaskAuditHistory_(workId) {
  const auditLogs = state.auditLogs || [];
  const related = auditLogs.filter(log => log.workId === workId || log.taskId === workId);
  
  if (!related.length) {
    return `
      <div class="task-history" style="margin-top: 12px; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 8px;">
        <h5 style="margin: 0 0 6px 0; font-size: 13px; color: #fff;">操作歷程</h5>
        <div style="font-size: 12px; color: rgba(255,255,255,0.5);">目前沒有操作紀錄</div>
      </div>
    `;
  }

  const sorted = [...related].sort((a, b) => {
    const timeA = a.createdAt || a.timestamp || "";
    const timeB = b.createdAt || b.timestamp || "";
    return timeB.localeCompare(timeA);
  }).slice(0, 5);

  const formatLogDate = (val) => {
    if (!val) return "無";
    if (val.includes("T")) {
      try {
        const d = new Date(val);
        if (!isNaN(d.getTime())) {
          const tzOffset = 8 * 60;
          const localTime = new Date(d.getTime() + tzOffset * 60000);
          const month = String(localTime.getUTCMonth() + 1).padStart(2, '0');
          const day = String(localTime.getUTCDate()).padStart(2, '0');
          const hour = String(localTime.getUTCHours()).padStart(2, '0');
          const min = String(localTime.getUTCMinutes()).padStart(2, '0');
          return `${month}/${day} ${hour}:${min}`;
        }
      } catch (e) {}
    }
    return val.replace(/^\d{4}-/, "").replace("T", " ").slice(0, 16);
  };

  const actionMap = {
    "create": "建立任務",
    "status_change": "變更狀態",
    "add_note": "新增備註",
    "Blocked": "回報異常",
    "Waiting": "等待資料",
    "Finished": "完成任務",
    "reopen": "重啟處理",
    "resolved": "異常排除"
  };

  const statusMap = {
    "Created": "已建立",
    "Started": "執行中",
    "Waiting": "等待中",
    "Finished": "已完成",
    "Blocked": "已異常",
    "Cancelled": "已取消",
    "open": "待處理",
    "inProgress": "處理中",
    "done": "已完成",
    "delayed": "已延後",
    "blocked": "已異常",
    "cancelled": "已取消"
  };

  const formatTaskRoleGlobal_ = (role) => {
    const roleMap = {
      assistant: "助理",
      sales: "業務",
      retailSales: "零售業務",
      showroomSales: "門市業務",
      admin: "管理員",
      boss: "主管"
    };
    return roleMap[role] || role || "無";
  };

  const logItems = sorted.map(log => {
    const actionLabel = actionMap[log.action] || log.action || "操作";
    const fromLabel = statusMap[log.fromStatus] || log.fromStatus;
    const toLabel = statusMap[log.toStatus] || log.toStatus;
    const operatorLabel = log.operator || "系統";
    const roleLabel = log.operatorRole ? `(${formatTaskRoleGlobal_(log.operatorRole)})` : "";
    const detailText = log.details ? ` (${log.details})` : "";
    const timeText = formatLogDate(log.createdAt || log.timestamp);

    let colorStyle = "";
    if (log.action === "Finished" || log.action === "resolved" || log.toStatus === "Finished" || log.toStatus === "done") {
      colorStyle = "color: #54e2b0;";
    } else if (log.action === "Blocked" || log.toStatus === "Blocked" || log.toStatus === "blocked") {
      colorStyle = "color: #ff5252;";
    } else if (log.action === "Waiting" || log.toStatus === "Waiting" || log.toStatus === "delayed") {
      colorStyle = "color: #f4bf58;";
    }

    let statusTransition = "";
    if (fromLabel && toLabel) {
      statusTransition = ` <span style="color: rgba(255,255,255,0.3); margin-inline: 4px;">•</span> 狀態：<span style="color: #fff; font-weight: 500;">${escapeHtml(fromLabel)} ➔ ${escapeHtml(toLabel)}</span>`;
    }

    return `
      <li style="margin-bottom: 6px; padding-bottom: 6px; border-bottom: 1px dashed rgba(255,255,255,0.05);">
        <div style="display: flex; justify-content: space-between; color: rgba(255,255,255,0.4); font-size: 11px;">
          <span style="color: #7cb1ff; font-weight: 500;">👤 ${escapeHtml(operatorLabel)}${escapeHtml(roleLabel)}</span>
          <span>⏰ ${escapeHtml(timeText)}</span>
        </div>
        <div style="margin-top: 2px; color: rgba(255,255,255,0.85); font-size: 12px;">
          <span style="font-weight: bold; ${colorStyle}">${escapeHtml(actionLabel)}</span>${statusTransition}${log.details ? ` <span style="color: rgba(255,255,255,0.5);">(${escapeHtml(log.details)})</span>` : ""}
        </div>
      </li>
    `;
  }).join("");

  return `
    <div class="task-history" style="margin-top: 12px; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 8px;">
      <h5 style="margin: 0 0 6px 0; font-size: 13px; color: #fff;">操作歷程 (最近 5 筆)</h5>
      <ul style="margin: 0; padding: 0; list-style: none;">
        ${logItems}
      </ul>
    </div>
  `;
}

function getTaskSummaryStats_(tasks) {
  const stats = {
    total: 0,
    assistantActive: 0,
    waiting: 0,
    blocked: 0,
    dueToday: 0,
    finished: 0
  };

  const todayStr = getTodayDateString_();

  const parseToLocalYYYYMMDD = (val) => {
    if (!val) return "";
    if (val.includes("T")) {
      try {
        const d = new Date(val);
        if (!isNaN(d.getTime())) {
          const tzOffset = 8 * 60; // UTC+8
          const localTime = new Date(d.getTime() + tzOffset * 60000);
          const year = localTime.getUTCFullYear();
          const month = String(localTime.getUTCMonth() + 1).padStart(2, '0');
          const day = String(localTime.getUTCDate()).padStart(2, '0');
          return `${year}-${month}-${day}`;
        }
      } catch (e) {}
    }
    const match = val.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      return match[0];
    }
    return val.split("T")[0];
  };

  tasks.forEach(task => {
    stats.total++;

    // assistantActive
    if (task.assignedRole === "assistant" && task.status !== "Finished" && task.status !== "done") {
      stats.assistantActive++;
    }

    // waiting
    if (task.status === "Waiting") {
      stats.waiting++;
    }

    // blocked
    if (task.status === "Blocked" || task.status === "blocked") {
      stats.blocked++;
    }

    // dueToday
    if (task.dueDate) {
      const taskLocalDate = parseToLocalYYYYMMDD(task.dueDate);
      if (taskLocalDate === todayStr) {
        stats.dueToday++;
      }
    }

    // finished
    if (task.status === "Finished" || task.status === "done") {
      stats.finished++;
    }
  });

  return stats;
}

function getTaskStatusMeta_(status) {
  const norm = String(status || "").trim();
  if (norm === "Created" || norm === "open") {
    return {
      label: "📝 已建立",
      code: norm,
      className: "task-status-created",
      tone: "created"
    };
  }
  if (norm === "Started" || norm === "inProgress") {
    return {
      label: "⚡ 執行中",
      code: norm,
      className: "task-status-started",
      tone: "started"
    };
  }
  if (norm === "Waiting" || norm === "delayed") {
    return {
      label: "⏳ 等待補資料",
      code: norm,
      className: "task-status-waiting",
      tone: "waiting"
    };
  }
  if (norm === "Blocked" || norm === "blocked") {
    return {
      label: "⚠️ 異常需處理",
      code: norm,
      className: "task-status-blocked",
      tone: "blocked"
    };
  }
  if (norm === "Finished" || norm === "done") {
    return {
      label: "✅ 已完成",
      code: norm,
      className: "task-status-finished",
      tone: "finished"
    };
  }
  if (norm === "Cancelled" || norm === "cancelled") {
    return {
      label: "🚫 已取消",
      code: norm,
      className: "task-status-cancelled",
      tone: "cancelled"
    };
  }
  return {
    label: norm || "無",
    code: norm,
    className: "task-status-unknown",
    tone: "unknown"
  };
}

function canCurrentUserCompleteTask_(task) {
  if (!state.currentUser || !state.currentUser.role) return false;
  const role = state.currentUser.role;
  const username = state.currentUser.username || "";
  const displayName = state.currentUser.displayName || "";
  const salesOwner = state.currentUser.salesOwner || "";
  
  if (task.status === "Finished" || task.status === "done" || task.status === "Cancelled" || task.status === "cancelled") {
    return false;
  }
  
  if (role === "admin" || role === "boss") {
    return true;
  }
  
  if (role === "assistant") {
    return (
      task.assignedRole === "assistant" ||
      task.assignedTo === username ||
      task.assignedTo === displayName ||
      task.assignedTo === salesOwner
    );
  }
  
  if (role === "retailSales" || role === "showroomSales" || role === "sales") {
    const isAssignedToMe = (
      task.assignedTo && (
        task.assignedTo === username ||
        task.assignedTo === displayName ||
        task.assignedTo === salesOwner
      )
    );
    const isCreatedByMe = (
      task.createdBy && (
        task.createdBy === username ||
        task.createdBy === displayName ||
        task.createdBy === salesOwner
      )
    );
    return isAssignedToMe || isCreatedByMe;
  }
  
  return false;
}

function buildTaskUserContext_() {
  if (!state.currentUser) return null;
  return {
    role: state.currentUser.role || "",
    username: state.currentUser.username || "",
    displayName: state.currentUser.displayName || "",
    salesOwner: state.currentUser.salesOwner || "",
    lineUserId: state.currentUser.lineUserId || ""
  };
}

async function completeTaskFromPwa_(taskId) {
  if (pwaTaskStatusInFlight.has(taskId)) return;
  
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) {
    toast("找不到該任務");
    return;
  }
  
  if (!canCurrentUserCompleteTask_(task)) {
    toast("權限不足，無法完成此任務");
    return;
  }
  
  if (!confirm("確定要完成此工作任務嗎？")) {
    return;
  }
  
  pwaTaskStatusInFlight.add(taskId);
  
  // Disable button visually
  const btn = document.querySelector(`[data-task-complete-btn="${escapeHtml(encodeURIComponent(taskId))}"]`);
  if (btn) {
    btn.disabled = true;
    btn.textContent = "提交中...";
  }
  
  try {
    const userContext = buildTaskUserContext_();
    const result = await sendCloudAction("updateTaskStatus", {
      id: taskId,
      status: "Finished",
      note: "PWA 完成工作",
      userContext
    });
    
    if (result && result.ok) {
      const fromStatus = task.status;
      task.status = "Finished";
      task.completedAt = new Date().toISOString();
      task.updatedAt = new Date().toISOString();
      task.updatedBy = userContext.displayName || userContext.username || "unknown";
      
      // Also add local audit log for instant update in details panel
      state.auditLogs.unshift({
        id: "audit-pwa-" + Date.now(),
        workId: taskId,
        action: "pwa_update_status",
        operator: userContext.displayName || userContext.username || "unknown",
        operatorRole: userContext.role || "",
        fromStatus: fromStatus || "",
        toStatus: "Finished",
        details: "PWA 完成工作",
        createdAt: new Date().toISOString()
      });
      
      saveState();
      renderTasks();
      toast("任務已完成！");
    } else {
      throw new Error((result && result.message) || "提交失敗");
    }
  } catch (err) {
    console.error(err);
    toast(err.message || "完成任務時發生錯誤");
    if (btn) {
      btn.disabled = false;
      btn.textContent = "完成工作";
    }
  } finally {
    pwaTaskStatusInFlight.delete(taskId);
  }
}

function canCurrentUserReportTaskIssue_(task) {
  if (!state.currentUser || !state.currentUser.role) return false;
  const role = state.currentUser.role;
  const username = state.currentUser.username || "";
  const displayName = state.currentUser.displayName || "";
  const salesOwner = state.currentUser.salesOwner || "";
  
  if (task.status === "Finished" || task.status === "done" || task.status === "Cancelled" || task.status === "cancelled" || task.status === "Blocked") {
    return false;
  }
  
  if (role === "admin" || role === "boss") {
    return true;
  }
  
  if (role === "assistant") {
    const isAssignedToMe = (
      task.assignedTo && (
        task.assignedTo === username ||
        task.assignedTo === displayName ||
        task.assignedTo === salesOwner
      )
    );
    return task.assignedRole === "assistant" || isAssignedToMe;
  }
  
  if (role === "retailSales" || role === "showroomSales" || role === "sales") {
    const isAssignedToMe = (
      task.assignedTo && (
        task.assignedTo === username ||
        task.assignedTo === displayName ||
        task.assignedTo === salesOwner
      )
    );
    const isCreatedByMe = (
      task.createdBy && (
        task.createdBy === username ||
        task.createdBy === displayName ||
        task.createdBy === salesOwner
      )
    );
    return isAssignedToMe || isCreatedByMe;
  }
  
  return false;
}

function isValidPwaBlockedReason_(reason) {
  return getPwaBlockedReasons_().indexOf(reason) !== -1;
}

function getPwaBlockedReasons_() {
  return ["庫存不足", "保留衝突", "商品型號疑似錯誤", "交期無法確認", "客戶資料不完整"];
}

async function reportTaskIssueFromPwa_(taskId, reason) {
  if (pwaTaskStatusInFlight.has(taskId)) return;
  if (!isValidPwaBlockedReason_(reason)) {
    toast("異常原因不合法");
    return;
  }
  
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) {
    toast("找不到該任務");
    return;
  }
  
  if (!canCurrentUserReportTaskIssue_(task)) {
    toast("權限不足，無法更動此任務");
    return;
  }
  
  if (!confirm(`確定要將此任務回報為異常（原因：${reason}）嗎？`)) {
    return;
  }
  
  pwaTaskStatusInFlight.add(taskId);
  
  // Disable buttons visually
  const allBtns = document.querySelectorAll(`[data-task-issue-submit-btn="${escapeHtml(encodeURIComponent(taskId))}"], [data-task-issue-toggle-btn="${escapeHtml(encodeURIComponent(taskId))}"], [data-task-complete-btn="${escapeHtml(encodeURIComponent(taskId))}"]`);
  allBtns.forEach(btn => {
    btn.disabled = true;
    if (btn.classList.contains("task-issue-option-btn") && btn.dataset.reason === reason) {
      btn.textContent = "提交中...";
    }
  });
  
  try {
    const userContext = buildTaskUserContext_();
    const result = await sendCloudAction("updateTaskStatus", {
      id: taskId,
      status: "Blocked",
      reason: reason,
      note: reason,
      userContext
    });
    
    if (result && result.ok) {
      const fromStatus = task.status;
      if (result.task) {
        state.tasks = state.tasks.map(t => t.id === taskId ? result.task : t);
      } else {
        task.status = "Blocked";
        task.blockedReason = reason;
        task.updatedAt = new Date().toISOString();
        task.updatedBy = userContext.displayName || userContext.username || "unknown";
      }
      
      // Update local audit logs immediately
      if (!state.auditLogs) state.auditLogs = [];
      const operatorName = userContext.displayName || userContext.username || "unknown";
      state.auditLogs.unshift({
        id: "audit-pwa-" + Date.now(),
        workId: taskId,
        action: "pwa_update_status",
        operator: operatorName,
        operatorRole: userContext.role || "",
        fromStatus: fromStatus || "",
        toStatus: "Blocked",
        details: reason,
        createdAt: new Date().toISOString()
      });
      
      pwaTaskIssueReasonOpen.delete(taskId);
      saveState();
      toast("任務已成功回報為異常");
    } else {
      throw new Error((result && result.message) || "回報異常失敗");
    }
  } catch (err) {
    console.error(err);
    toast(err.message || "回報異常時發生錯誤");
  } finally {
    pwaTaskStatusInFlight.delete(taskId);
    renderTasks();
  }
}

function canCurrentUserRequestTaskInfo_(task) {
  if (!state.currentUser || !state.currentUser.role) return false;
  const role = state.currentUser.role;
  const username = state.currentUser.username || "";
  const displayName = state.currentUser.displayName || "";
  const salesOwner = state.currentUser.salesOwner || "";
  
  if (task.status === "Finished" || task.status === "done" || task.status === "Cancelled" || task.status === "cancelled" || task.status === "Waiting") {
    return false;
  }
  
  if (role === "admin" || role === "boss") {
    return true;
  }
  
  if (role === "assistant") {
    const isAssignedToMe = (
      task.assignedTo && (
        task.assignedTo === username ||
        task.assignedTo === displayName ||
        task.assignedTo === salesOwner
      )
    );
    return task.assignedRole === "assistant" || isAssignedToMe;
  }
  
  if (role === "retailSales" || role === "showroomSales" || role === "sales") {
    const isAssignedToMe = (
      task.assignedTo && (
        task.assignedTo === username ||
        task.assignedTo === displayName ||
        task.assignedTo === salesOwner
      )
    );
    const isCreatedByMe = (
      task.createdBy && (
        task.createdBy === username ||
        task.createdBy === displayName ||
        task.createdBy === salesOwner
      )
    );
    return isAssignedToMe || isCreatedByMe;
  }
  
  return false;
}

function isValidPwaWaitingReason_(reason) {
  return getPwaWaitingReasons_().indexOf(reason) !== -1;
}

function getPwaWaitingReasons_() {
  return ["缺客戶資料", "缺商品型號", "缺數量", "缺送貨資訊", "缺價格確認"];
}

async function requestTaskInfoFromPwa_(taskId, reason) {
  if (pwaTaskStatusInFlight.has(taskId)) return;
  if (!isValidPwaWaitingReason_(reason)) {
    toast("補資料原因不合法");
    return;
  }
  
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) {
    toast("找不到該任務");
    return;
  }
  
  if (!canCurrentUserRequestTaskInfo_(task)) {
    toast("權限不足，無法更動此任務");
    return;
  }
  
  if (!confirm(`確定要將此任務標記為等待資料（原因：${reason}）嗎？`)) {
    return;
  }
  
  pwaTaskStatusInFlight.add(taskId);
  
  // Disable buttons visually
  const allBtns = document.querySelectorAll(`[data-task-waiting-submit-btn="${escapeHtml(encodeURIComponent(taskId))}"], [data-task-waiting-toggle-btn="${escapeHtml(encodeURIComponent(taskId))}"], [data-task-complete-btn="${escapeHtml(encodeURIComponent(taskId))}"]`);
  allBtns.forEach(btn => {
    btn.disabled = true;
    if (btn.classList.contains("task-waiting-option-btn") && btn.dataset.reason === reason) {
      btn.textContent = "提交中...";
    }
  });
  
  try {
    const userContext = buildTaskUserContext_();
    const result = await sendCloudAction("updateTaskStatus", {
      id: taskId,
      status: "Waiting",
      reason: reason,
      note: reason,
      userContext
    });
    
    if (result && result.ok) {
      const fromStatus = task.status;
      if (result.task) {
        state.tasks = state.tasks.map(t => t.id === taskId ? result.task : t);
      } else {
        task.status = "Waiting";
        task.blockedReason = reason;
        task.updatedAt = new Date().toISOString();
        task.updatedBy = userContext.displayName || userContext.username || "unknown";
      }
      
      // Update local audit logs immediately
      if (!state.auditLogs) state.auditLogs = [];
      const operatorName = userContext.displayName || userContext.username || "unknown";
      state.auditLogs.unshift({
        id: "audit-pwa-" + Date.now(),
        workId: taskId,
        action: "pwa_update_status",
        operator: operatorName,
        operatorRole: userContext.role || "",
        fromStatus: fromStatus || "",
        toStatus: "Waiting",
        details: reason,
        createdAt: new Date().toISOString()
      });
      
      pwaTaskWaitingReasonOpen.delete(taskId);
      saveState();
      toast("任務已成功變更為等待資料");
    } else {
      throw new Error((result && result.message) || "變更失敗");
    }
  } catch (err) {
    console.error(err);
    toast(err.message || "變更狀態時發生錯誤");
  } finally {
    pwaTaskStatusInFlight.delete(taskId);
    renderTasks();
  }
}


