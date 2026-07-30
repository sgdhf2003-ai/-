/**
 * AllocationSandboxView (Pack 5A)
 */

class AllocationSandboxView {
  constructor(options = {}) {
    this.uiState = options.uiState || null;
    this.activeTabId = 'nav-allocation';
    this.activeViewId = 'view-allocation-sandbox';
  }

  renderWarningBanner() {
    return `
      <div class="sandbox-banner sandbox-banner-amber">
        <span class="sandbox-badge">唯讀沙盒</span>
        <span class="sandbox-title">配貨建議試算 (唯讀沙盒模式)</span>
        <p class="sandbox-disclaimer">本頁面僅供模擬試算，不寫入正式保留與 LINE 通知。</p>
      </div>
    `.trim();
  }

  renderSandboxControls() {
    return `
      <div class="sandbox-controls-container" data-sandbox-mode="SANDBOX_MODE_ONLY">
        <button id="btn-confirm-sandbox" class="btn-confirm btn-disabled" disabled read-only>
          確認配貨試算 (沙盒唯讀)
        </button>
        <span class="sandbox-lock-note">[唯讀防護] 沙盒環境禁止寫入正式庫存表與 LINE 發送</span>
      </div>
    `.trim();
  }

  renderSandboxContainer() {
    const bannerHtml = this.renderWarningBanner();
    const controlsHtml = this.renderSandboxControls();

    return `
      <div class="allocation-app-root">
        <nav class="app-nav-bar">
          <button id="nav-tasks" class="nav-item">任務管理</button>
          <button id="nav-allocation" class="nav-item active">配貨試算 (沙盒)</button>
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
