/**
 * LIFF Micro Edit Popup Component (Pack 7A)
 * Provides quick quantity tags, voice override parser, anomaly warnings, and photo inspection.
 */

class LiffMicroEditPopup {
  constructor({ productCode = '', requestedQuantity = 0, photoUrl = '', availableStock = Infinity } = {}) {
    this.productCode = productCode;
    this.requestedQuantity = requestedQuantity;
    this.photoUrl = photoUrl;
    this.availableStock = availableStock;
  }

  renderQuickTags() {
    const tags = [10, 50, 500, 1000];
    return tags.map(tag => `<button class="quick-qty-tag" data-qty="${tag}">${tag}</button>`).join(' ');
  }

  static parseQuantityOverride(text = '') {
    const trimmed = String(text || '').trim();
    const match = trimmed.match(/(?:改|數量|成|設為)?\s*(\d+)/);
    if (match) {
      return parseInt(match[1], 10);
    }
    return 0;
  }

  validateQuantityAnomaly(quantity, availableStock = Infinity) {
    const qty = Number(quantity) || 0;
    const stock = Number(availableStock);

    if (qty > 5000) {
      return {
        hasAnomaly: true,
        warningMessage: `⚠️ 數量 (${qty}) 超過單次限制 (5000 PCS)，請確認單據大額劃扣。`
      };
    }

    if (qty > stock) {
      return {
        hasAnomaly: true,
        warningMessage: `⚠️ 劃扣數量 (${qty}) 大於現有庫存剩餘量 (${stock} PCS)，將引發缺貨警示。`
      };
    }

    return {
      hasAnomaly: false,
      warningMessage: ''
    };
  }

  renderOriginalPhotoInspection() {
    if (!this.photoUrl) {
      return '<span class="no-photo-label">尚無原始單據照片</span>';
    }
    return `<a href="${this.photoUrl}" target="_blank" rel="noopener" class="inspect-photo-btn">🔍 查看原始單據照片核對</a>`;
  }
}

module.exports = {
  LiffMicroEditPopup
};
