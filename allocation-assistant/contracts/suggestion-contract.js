/**
 * AllocationSuggestion & AllocationWarning Contract Validators
 */

const SEVERITIES = Object.freeze({
  INFO: 'INFO',
  WARNING: 'WARNING',
  CRITICAL: 'CRITICAL'
});

function validateAllocationWarning(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('AllocationWarning must be a non-null object');
  }

  const warningCode = (data.warningCode || '').toString().trim();
  if (!warningCode) {
    throw new Error('warningCode is required');
  }

  const severity = (data.severity || SEVERITIES.WARNING).toString().trim();
  if (!Object.values(SEVERITIES).includes(severity)) {
    throw new Error(`Invalid severity: ${severity}`);
  }

  return {
    warningCode,
    severity,
    message: (data.message || '').toString()
  };
}

function validateAllocationSuggestionItem(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('AllocationSuggestionItem must be a non-null object');
  }

  const productCode = (data.productCode || '').toString().trim();
  const warehouseName = (data.warehouseName || '').toString().trim();
  const batchNumber = (data.batchNumber || '').toString().trim();
  const allocatedQuantity = Number(data.allocatedQuantity);

  if (!productCode || !warehouseName || !batchNumber) {
    throw new Error('productCode, warehouseName, and batchNumber are required');
  }

  if (isNaN(allocatedQuantity) || allocatedQuantity <= 0) {
    throw new Error('allocatedQuantity must be greater than 0');
  }

  return {
    productCode,
    warehouseName,
    batchNumber,
    allocatedQuantity
  };
}

function validateAllocationSuggestion(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('AllocationSuggestion must be a non-null object');
  }

  const suggestionId = (data.suggestionId || '').toString().trim();
  const draftId = (data.draftId || '').toString().trim();

  if (!suggestionId || !draftId) {
    throw new Error('suggestionId and draftId are required');
  }

  const suggestions = Array.isArray(data.suggestions)
    ? data.suggestions.map(validateAllocationSuggestionItem)
    : [];

  const warnings = Array.isArray(data.warnings)
    ? data.warnings.map(validateAllocationWarning)
    : [];

  return {
    suggestionId,
    draftId,
    suggestions,
    warnings,
    rationale: (data.rationale || '').toString()
  };
}

module.exports = {
  SEVERITIES,
  validateAllocationWarning,
  validateAllocationSuggestionItem,
  validateAllocationSuggestion
};
