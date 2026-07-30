/**
 * SandboxDemoCards & Interactive Scenario Loader (Pack 5C)
 */

const DEMO_PRESETS = [
  {
    id: 'DEMO_EQA_6522',
    title: '範例一：單倉足量',
    productCode: 'EQA-6522',
    rawText: 'EQA-6522 * 10',
    description: '林口倉單一批號 (7J25) 足量劃扣 10 PCS'
  },
  {
    id: 'DEMO_GUJIA_575',
    title: '範例二：混批授權',
    productCode: '顧佳 575',
    rawText: '顧佳 575 * 15',
    description: '單批不足 15 PCS，觸發 BATCH_MIXING_REQUIRED 警告'
  },
  {
    id: 'DEMO_LOW_CONFIDENCE',
    title: '範例三：低可信度審查',
    productCode: '艾美 336',
    rawText: '艾美 336 ?? 20',
    description: 'OCR 低可信度提醒，強制切換至 OCR_REVIEW 置灰審查'
  }
];

class SandboxDemoCards {
  constructor(options = {}) {
    this.gatewayClient = options.gatewayClient || null;
    this.uiState = options.uiState || (options.gatewayClient ? options.gatewayClient.uiState : null);
  }

  renderDemoCards() {
    const cardsHtml = DEMO_PRESETS.map(preset => `
      <div class="demo-card" data-demo-id="${preset.id}">
        <span class="demo-card-title">${preset.title}</span>
        <span class="demo-card-code">${preset.productCode}</span>
        <p class="demo-card-desc">${preset.description}</p>
        <button class="btn-load-demo" data-demo-id="${preset.id}">一鍵試算</button>
      </div>
    `).join('\n');

    return `
      <div class="sandbox-demo-cards-container">
        <h4 class="demo-cards-header">沙盒真實體驗情境 (點擊即刻一鍵代入)</h4>
        <div class="demo-cards-grid">
          ${cardsHtml}
        </div>
      </div>
    `.trim();
  }

  loadDemoScenario(demoId) {
    const preset = DEMO_PRESETS.find(p => p.id === demoId);
    if (!preset) {
      throw new Error(`DEMO_NOT_FOUND: Scenario ${demoId} does not exist`);
    }

    if (!this.gatewayClient || !this.uiState) {
      throw new Error('gatewayClient and uiState are required for loadDemoScenario');
    }

    if (demoId === 'DEMO_LOW_CONFIDENCE') {
      this.uiState.setRawOrderText(preset.rawText);
      this.uiState.status = 'OCR_REVIEW';
      this.uiState.suggestions = [];
      this.uiState.warnings = [
        {
          warningCode: 'LOW_OCR_CONFIDENCE',
          code: 'LOW_OCR_CONFIDENCE',
          message: 'OCR confidence score below threshold (0.65 < 0.85)',
          severity: 'WARNING'
        }
      ];
      this.uiState.rationale = 'OCR recognition confidence is low. Manual review required.';
      return {
        success: true,
        demoId,
        preset,
        status: 'OCR_REVIEW'
      };
    }

    const evalResult = this.gatewayClient.submitRawText(preset.rawText);
    return {
      success: evalResult.success,
      demoId,
      preset,
      status: this.uiState.status,
      evalResult
    };
  }
}

module.exports = {
  DEMO_PRESETS,
  SandboxDemoCards
};
