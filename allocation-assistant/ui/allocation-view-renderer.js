/**
 * AllocationViewRenderer & Approval Controls (Pack 3C)
 */

class AllocationViewRenderer {
  static escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  static renderDraftSummaryCard(uiState) {
    if (!uiState) return '<div class="card-empty">No UI State</div>';

    const statusBadgeClass = `badge-${(uiState.status || '').toLowerCase().replace(/_/g, '-')}`;
    const lockedAttr = uiState.isLocked ? ' disabled is-locked="true"' : '';

    let suggestionsHtml = '';
    if (Array.isArray(uiState.suggestions) && uiState.suggestions.length > 0) {
      suggestionsHtml = uiState.suggestions.map(s => `
        <div class="suggestion-item">
          <span class="product-code">${this.escapeHtml(s.productCode)}</span>
          <span class="warehouse-name">${this.escapeHtml(s.warehouseName)}</span>
          <span class="batch-number">${this.escapeHtml(s.batchNumber)}</span>
          <span class="allocated-qty">${s.allocatedQuantity}</span>
        </div>
      `).join('');
    } else {
      suggestionsHtml = '<div class="no-suggestions">No suggestions available</div>';
    }

    return `
      <div class="card-draft-summary${lockedAttr}">
        <div class="card-header">
          <span class="badge ${statusBadgeClass}">${this.escapeHtml(uiState.status)}</span>
          <span class="draft-id">${this.escapeHtml(uiState.draftId || 'N/A')}</span>
        </div>
        <div class="card-body">
          <p class="raw-order-text">${this.escapeHtml(uiState.rawOrderText)}</p>
          <div class="suggestions-list">
            ${suggestionsHtml}
          </div>
        </div>
      </div>
    `.trim();
  }

  static renderWarningsAndToggles(uiState) {
    if (!uiState) return '';

    const warningsHtml = (uiState.warnings || []).map(w => {
      const codeClass = `alert-${(w.warningCode || '').toLowerCase().replace(/_/g, '-')}`;
      return `<div class="alert ${codeClass} alert-${(w.severity || 'warning').toLowerCase()}">${this.escapeHtml(w.message || w.warningCode)}</div>`;
    }).join('');

    const toggleChecked = uiState.customerApprovedMixedBatch ? ' checked' : '';
    const toggleDisabled = uiState.isLocked ? ' disabled' : '';

    const toggleHtml = `
      <div class="toggle-container">
        <label class="toggle-label">
          <input type="checkbox" class="input-mixed-batch-toggle"${toggleChecked}${toggleDisabled} />
          <span>Customer Approved Mixed Batch</span>
        </label>
      </div>
    `.trim();

    return `
      <div class="warnings-and-toggles">
        ${warningsHtml}
        ${toggleHtml}
      </div>
    `.trim();
  }

  static validateApprovalReadiness(uiState) {
    if (!uiState) {
      return { ready: false, reason: 'No UI state available' };
    }

    if (uiState.status === 'OCR_REVIEW') {
      return { ready: false, reason: 'OCR confidence below threshold; manual review required.' };
    }

    if (uiState.status === 'ALLOCATION_CONFIRMED') {
      return { ready: false, reason: 'Draft is already confirmed and locked.' };
    }

    if (uiState.status === 'CANCELLED') {
      return { ready: false, reason: 'Draft is cancelled.' };
    }

    const hasInsufficientStock = (uiState.warnings || []).some(w => w.warningCode === 'INSUFFICIENT_STOCK');
    if (hasInsufficientStock) {
      return { ready: false, reason: 'INSUFFICIENT_STOCK warning present.' };
    }

    const hasLowOcr = (uiState.warnings || []).some(w => w.warningCode === 'LOW_OCR_CONFIDENCE');
    if (hasLowOcr) {
      return { ready: false, reason: 'LOW_OCR_CONFIDENCE warning present.' };
    }

    return { ready: true, reason: 'Ready for confirmation.' };
  }
}

module.exports = {
  AllocationViewRenderer
};
