/**
 * AllocationSandboxView (Pack 5A)
 */

class AllocationSandboxView {
  constructor(options = {}) {
    this.uiState = options.uiState || null;
    this.activeTabId = 'nav-allocation';
    this.activeViewId = 'view-allocation-sandbox';
  }

  renderWarningBanner(userRole) {
    const normRole = String(userRole || '').trim().toLowerCase();
    const isAuthorized = normRole === 'admin' || normRole === 'boss' || normRole === 'assistant';

    if (isAuthorized) {
      return `
        <div class="sandbox-banner sandbox-banner-green" data-role="${normRole}">
          <span class="sandbox-badge sandbox-badge-authorized">已授權操作</span>
          <span class="sandbox-title">配貨助手日常劃扣與出貨作業 (${normRole})</span>
          <p class="sandbox-disclaimer">具備執行保留劃扣、部分銷扣與取消釋放權限 [notificationBypassed: true]。</p>
        </div>
      `.trim();
    }

    return `
      <div class="sandbox-banner sandbox-banner-amber" data-role="${normRole || 'unauthenticated'}">
        <span class="sandbox-badge">唯讀控制</span>
        <span class="sandbox-title">配貨建議試算 (唯讀沙盒模式)</span>
        <p class="sandbox-disclaimer">目前角色 (${normRole || '未登入'}) 無執行劃扣與銷扣出貨權限，不寫入正式保留與 LINE 通知。</p>
      </div>
    `.trim();
  }


  renderSandboxControls(userRole) {
    const normRole = String(userRole || '').trim().toLowerCase();
    const isAuthorized = normRole === 'admin' || normRole === 'boss' || normRole === 'assistant';

    if (isAuthorized) {
      return `
        <div class="sandbox-controls-container" data-sandbox-mode="ROLE_AUTHORIZED" data-user-role="${normRole}">
          <button id="btn-confirm-sandbox" class="btn-confirm btn-enabled" data-action="upsertHold">
            確認劃扣扣除與配貨 (${normRole})
          </button>
          <span class="sandbox-lock-note">[系統提示] 劃扣操作將同步記錄於 holds/ledger 頁籤 (LINE通知已關閉)</span>
        </div>
      `.trim();
    }

    return `
      <div class="sandbox-controls-container" data-sandbox-mode="SANDBOX_MODE_ONLY" data-user-role="${normRole || 'unauthenticated'}">
        <button id="btn-confirm-sandbox" class="btn-confirm btn-disabled" disabled read-only>
          確認劃扣與配貨 (唯讀防護)
        </button>
        <span class="sandbox-lock-note">[唯讀防護] 權限不足 (${normRole || '未登入'})，禁止執行寫入操作與 LINE 發送</span>
      </div>
    `.trim();
  }

  renderSandboxContainer(userRole) {
    const bannerHtml = this.renderWarningBanner(userRole);
    const controlsHtml = this.renderSandboxControls(userRole);

    return `
      <div class="allocation-app-root">
        <nav class="app-nav-bar">
          <button id="nav-tasks" class="nav-item">任務管理</button>
          <button id="nav-allocation" class="nav-item active">配貨試算 (${userRole || '唯讀'})</button>
        </nav>
        <main class="app-view-container">
          <section id="view-allocation-sandbox" class="view-panel active sandbox-workspace">
            ${bannerHtml}
            <div class="sandbox-body">
              <div id="allocation-card-container"></div>
              ${controlsHtml}
            </div>
          </section>
        </main>
      </div>
    `.trim();
  }


  switchTab(tabId) {
    this.activeTabId = tabId;

    if (tabId === 'nav-allocation') {
      this.activeViewId = 'view-allocation-sandbox';
      return {
        activeTabId: 'nav-allocation',
        activeViewId: 'view-allocation-sandbox',
        hiddenViewIds: ['view-tasks', 'view-reservations']
      };
    } else {
      this.activeViewId = tabId.replace('nav-', 'view-');
      return {
        activeTabId: tabId,
        activeViewId: this.activeViewId,
        hiddenViewIds: ['view-allocation-sandbox']
      };
    }
  }
}

module.exports = {
  AllocationSandboxView
};
