/**
 * SandboxDemoCards & Interactive Scenario Loader (Pack 5C)
 */

const DEMO_PRESETS = [
  {
    id: 'DEMO_APT_5201',
    title: '範例一：單倉足量',
    customerName: '漢樺企業',
    productCode: 'APT-5201',
    productName: '上山人下山神 (SNOW) 5X20',
    rawText: '漢樺企業 APT-5201 * 10',
    description: '林口倉單一批號 (04) 足量劃扣 10 PCS'
  },
  {
    id: 'DEMO_STU_6101',
    title: '範例二：混批授權',
    customerName: '美麗空間',
    productCode: 'STU-6101',
    productName: 'STU 60X120 (PEARL)',
    rawText: '美麗空間 STU-6101 * 3',
    description: '單倉庫存不足 3 PCS，需林口倉 (2 PCS) 與忠義倉 (1 PCS) 跨倉混批'
  },
  {
    id: 'DEMO_SHN_6101F',
    title: '範例三：低可信度審查',
    customerName: '艾美磁磚',
    productCode: 'SHN-6101F',
    productName: 'SANCHIS 艾斯卡諾 (DESHA CREAM) 60X120',
    rawText: '艾美磁磚 SHN-6101F ?? 20',
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

    if (demoId === 'DEMO_SHN_6101F' || demoId === 'DEMO_LOW_CONFIDENCE') {
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
