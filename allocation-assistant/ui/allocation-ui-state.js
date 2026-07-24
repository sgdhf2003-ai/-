/**
 * AllocationUIState & ViewModel Manager (Pack 3A)
 */

class AllocationUIState {
  constructor() {
    this.status = 'DRAFT';
    this.rawOrderText = '';
    this.customerApprovedMixedBatch = false;
    this.isLocked = false;

    this.draftId = null;
    this.suggestions = [];
    this.warnings = [];
    this.rationale = '';
  }

  _checkLock() {
    if (this.isLocked) {
      throw new Error('LOCKED_STATE_MUTATION: Cannot mutate AllocationUIState when locked');
    }
  }

  setRawOrderText(text) {
    this._checkLock();
    this.rawOrderText = (text || '').toString();
  }

  setCustomerApprovedMixedBatch(approved) {
    this._checkLock();
    this.customerApprovedMixedBatch = Boolean(approved);
  }

  updateFromAnalysis(analysisResult) {
    this._checkLock();
    if (!analysisResult || typeof analysisResult !== 'object') return;

    if (analysisResult.status) {
      this.status = analysisResult.status;
    }

    const suggestion = analysisResult.suggestion;
    if (suggestion) {
      this.draftId = suggestion.draftId || this.draftId;
      this.suggestions = Array.isArray(suggestion.suggestions) ? suggestion.suggestions : [];
      this.warnings = Array.isArray(suggestion.warnings) ? suggestion.warnings : [];
      this.rationale = suggestion.rationale || '';
    }
  }

  confirm() {
    if (this.status === 'CANCELLED' || this.isLocked) {
      throw new Error(`INVALID_STATE_TRANSITION: Cannot confirm from state ${this.status}`);
    }
    this.status = 'ALLOCATION_CONFIRMED';
    this.isLocked = true;
  }

  cancel() {
    if (this.status === 'CANCELLED' || (this.isLocked && this.status === 'ALLOCATION_CONFIRMED')) {
      throw new Error(`INVALID_STATE_TRANSITION: Cannot cancel from state ${this.status}`);
    }
    this.status = 'CANCELLED';
    this.isLocked = true;
  }
}

module.exports = {
  AllocationUIState
};
