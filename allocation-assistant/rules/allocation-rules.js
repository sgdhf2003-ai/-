/**
 * Pure-Function Allocation Rules Evaluator (Pack 1C)
 */

const {
  validateAllocationSuggestion,
  validateAllocationWarning,
  SEVERITIES
} = require('../contracts/suggestion-contract');

const OCR_CONFIDENCE_THRESHOLD = 0.85;

function evaluateAllocationRules({ item, snapshot, customerApprovedMixedBatch = false }) {
  if (!item || !snapshot) {
    throw new Error('item and snapshot are required for rule evaluation');
  }

  const draftId = item.draftId || 'draft_eval_temp';
  const requestedQty = item.requestedQuantity;
  const confidence = item.parsedConfidence !== undefined ? item.parsedConfidence : 1.0;

  // Rule 1: OCR Low Confidence Threshold (< 0.85)
  if (confidence < OCR_CONFIDENCE_THRESHOLD) {
    const warning = validateAllocationWarning({
      warningCode: 'LOW_OCR_CONFIDENCE',
      severity: SEVERITIES.WARNING,
      message: `Parsed OCR confidence (${confidence}) is below threshold (${OCR_CONFIDENCE_THRESHOLD}). Manual review required.`
    });
    const suggestion = validateAllocationSuggestion({
      suggestionId: `sug_${Date.now()}`,
      draftId,
      suggestions: [],
      warnings: [warning],
      rationale: 'Halted allocation calculation due to low OCR confidence.'
    });
    return {
      status: 'OCR_REVIEW',
      suggestion
    };
  }

  // Collect all batches across all warehouses
  const warehouses = snapshot.warehouses || [];
  let totalAvailable = 0;
  const singleBatches = [];

  warehouses.forEach(wh => {
    (wh.batches || []).forEach(b => {
      totalAvailable += b.availableQuantity;
      if (b.availableQuantity >= requestedQty) {
        singleBatches.push({
          warehouseName: wh.warehouseName,
          batchNumber: b.batchNumber,
          availableQuantity: b.availableQuantity,
          remainingAfterAllocation: b.availableQuantity - requestedQty
        });
      }
    });
  });

  // Rule 2: Total Stock Deficit
  if (totalAvailable < requestedQty) {
    const warning = validateAllocationWarning({
      warningCode: 'INSUFFICIENT_STOCK',
      severity: SEVERITIES.CRITICAL,
      message: `Total available inventory (${totalAvailable}) is less than requested quantity (${requestedQty}).`
    });
    const suggestion = validateAllocationSuggestion({
      suggestionId: `sug_${Date.now()}`,
      draftId,
      suggestions: [],
      warnings: [warning],
      rationale: 'Insufficient overall stock to fulfill request.'
    });
    return {
      status: 'ALLOCATION_REVIEW',
      suggestion
    };
  }

  // Rule 3 & 4: Single Batch Selection (prefer smallest remaining stock after allocation)
  if (singleBatches.length > 0) {
    // Sort ascending by remainingAfterAllocation
    singleBatches.sort((a, b) => a.remainingAfterAllocation - b.remainingAfterAllocation);
    const chosen = singleBatches[0];

    const suggestion = validateAllocationSuggestion({
      suggestionId: `sug_${Date.now()}`,
      draftId,
      suggestions: [
        {
          productCode: item.productCode,
          warehouseName: chosen.warehouseName,
          batchNumber: chosen.batchNumber,
          allocatedQuantity: requestedQty
        }
      ],
      warnings: [],
      rationale: `Selected single batch ${chosen.batchNumber} in ${chosen.warehouseName} leaving smallest remaining stock (${chosen.remainingAfterAllocation}).`
    });

    return {
      status: 'ALLOCATION_REVIEW',
      suggestion
    };
  }

  // Rule 5: Batch Mixing Logic
  if (!customerApprovedMixedBatch) {
    const warning = validateAllocationWarning({
      warningCode: 'BATCH_MIXING_REQUIRED',
      severity: SEVERITIES.WARNING,
      message: 'No single batch has sufficient inventory. Customer consent is required for batch mixing.'
    });
    const suggestion = validateAllocationSuggestion({
      suggestionId: `sug_${Date.now()}`,
      draftId,
      suggestions: [],
      warnings: [warning],
      rationale: 'Halted allocation because batch mixing requires explicit consent.'
    });
    return {
      status: 'ALLOCATION_REVIEW',
      suggestion
    };
  }

  // Customer approved mixed batch -> allocate across multiple batches
  const allocatedItems = [];
  let remainingNeeded = requestedQty;

  // Flatten all available lots
  const allLots = [];
  warehouses.forEach(wh => {
    (wh.batches || []).forEach(b => {
      if (b.availableQuantity > 0) {
        allLots.push({
          warehouseName: wh.warehouseName,
          batchNumber: b.batchNumber,
          availableQuantity: b.availableQuantity
        });
      }
    });
  });

  // Sort batches to prioritize smaller batches first to clear deadstock
  allLots.sort((a, b) => a.availableQuantity - b.availableQuantity);

  for (const lot of allLots) {
    if (remainingNeeded <= 0) break;
    const qtyToTake = Math.min(lot.availableQuantity, remainingNeeded);
    allocatedItems.push({
      productCode: item.productCode,
      warehouseName: lot.warehouseName,
      batchNumber: lot.batchNumber,
      allocatedQuantity: qtyToTake
    });
    remainingNeeded -= qtyToTake;
  }

  const suggestion = validateAllocationSuggestion({
    suggestionId: `sug_${Date.now()}`,
    draftId,
    suggestions: allocatedItems,
    warnings: [],
    rationale: `Allocated across ${allocatedItems.length} batches with customer consent for batch mixing.`
  });

  return {
    status: 'ALLOCATION_REVIEW',
    suggestion
  };
}

module.exports = {
  OCR_CONFIDENCE_THRESHOLD,
  evaluateAllocationRules
};
