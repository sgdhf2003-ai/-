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

/**
 * Evaluates user permission role against write actions and status transitions.
 * @param {string} role User role code (admin, boss, assistant, sales, retail, etc.)
 * @param {string} action Action type ('upsertHold', 'fulfillHold', 'cancelRelease', 'readAll', etc.)
 * @param {string} [targetStatus] Optional target status for hold updates
 * @return {{ allowed: boolean, errorCode?: string, message?: string }} Permission evaluation result
 */
function evaluateUserPermission(role, action, targetStatus) {
  if (!role || role === 'null' || role === 'undefined' || role === 'unknown') {
    return {
      allowed: false,
      errorCode: 'INVALID_SESSION_USER',
      message: '登入狀態失效或缺少使用者權限脈絡'
    };
  }

  const normRole = String(role || '').trim().toLowerCase();

  // 1. Check admin-only cleanup/correction statuses
  if (targetStatus === 'TEST_CLEANUP_DELETED' || targetStatus === 'CORRECTED') {
    if (normRole !== 'admin' && normRole !== 'boss') {
      return {
        allowed: false,
        errorCode: 'ADMIN_ROLE_REQUIRED',
        message: '僅限系統管理員 (admin) 執行紀錄清理與人工修正'
      };
    }
  }

  // 2. Write actions (upsertHold, fulfillHold, cancelRelease)
  const isWriteAction = action === 'upsertHold' || action === 'fulfillHold' || action === 'cancelRelease';
  if (isWriteAction) {
    if (normRole === 'sales' || normRole === 'retailsales' || normRole === 'showroomsales' || normRole === 'retail' || normRole === '無') {
      return {
        allowed: false,
        errorCode: 'UNAUTHORIZED_ROLE',
        message: '您目前的權限角色無法執行劃扣與出貨操作'
      };
    }
  }

  return { allowed: true, notificationBypassed: true };
}

/**
 * Sanitizes and redacts readback audit record fields according to user role contract.
 * Pure function: does not mutate the input record object.
 *
 * @param {Object} record Input audit/readback record object
 * @param {string} userRole User role code (admin, boss, assistant, sales, retail, etc.)
 * @return {{ ok: boolean, record?: Object, errorCode?: string, message?: string }} Redaction result
 */
function sanitizeReadbackAuditRecord(record, userRole) {
  if (!userRole || userRole === 'null' || userRole === 'undefined' || userRole === 'unknown') {
    return {
      ok: false,
      errorCode: 'INVALID_SESSION_USER',
      message: '登入狀態失效或缺少使用者權限脈絡'
    };
  }

  const normRole = String(userRole || '').trim().toLowerCase();

  // 1. Sales / Retail roles query deny contract
  if (normRole === 'sales' || normRole === 'retailsales' || normRole === 'showroomsales' || normRole === 'retail' || normRole === '無') {
    return {
      ok: false,
      errorCode: 'READBACK_QUERY_DENIED',
      message: '無存取讀回紀錄權限'
    };
  }

  if (!record || typeof record !== 'object') {
    return { ok: true, record: null };
  }

  // 2. Admin & Boss receive full unredacted audit details
  if (normRole === 'admin' || normRole === 'boss') {
    return { ok: true, record: { ...record } };
  }

  // 3. Assistant receives operational fields, omitting sensitive internal logs/properties
  if (normRole === 'assistant') {
    const sanitized = { ...record };

    // Sensitive fields to redact/delete for non-admin
    const sensitiveFields = [
      'internalLogs',
      'rawAdapterPayload',
      'systemProperties',
      'supplierInternals',
      'debugPayloads',
      'tokenNames',
      'tokenValues',
      'adapterConfiguration',
      'cleanupCorrectionNotes'
    ];

    sensitiveFields.forEach(field => {
      delete sanitized[field];
    });

    sanitized.readbackRedacted = true;
    return { ok: true, record: sanitized };
  }

  return {
    ok: false,
    errorCode: 'UNAUTHORIZED_ROLE',
    message: '未授權的角色讀回請求'
  };
}

/**
 * Evaluates controlled LINE notification policy contracts.
 *
 * @param {Object} request Notification policy evaluation request
 * @return {{ success: boolean, failureCode?: string, bypassed?: boolean, lineRequestId?: string, auditRecord?: Object }} Policy result
 */
function evaluateLineNotificationPolicy(request = {}) {
  const {
    notificationBypassed = true,
    operatorRole,
    recipientLineUserId,
    userOptInStatus,
    tokenConfigured = true,
    adapterInjected = true,
    simulatedApiError = false,
    pilotWhitelist = [],
    reservationNumber = '',
    intent = ''
  } = request;

  // 1. Safety Bypass Check (default: true)
  if (notificationBypassed !== false) {
    return {
      success: true,
      bypassed: true,
      failureCode: 'NOTIFICATION_BYPASSED'
    };
  }

  // 2. Role Authorization Check
  const normRole = String(operatorRole || '').trim().toLowerCase();
  const allowedRoles = ['admin', 'boss', 'assistant'];
  if (!normRole || !allowedRoles.includes(normRole)) {
    return {
      success: false,
      failureCode: 'UNAUTHORIZED_ROLE'
    };
  }

  // 3. lineUserId Format & Opt-In Check
  const lineUserIdPattern = /^U[0-9a-fA-F]{32}$/;
  if (!recipientLineUserId || !lineUserIdPattern.test(recipientLineUserId) || userOptInStatus !== 'OPTED_IN') {
    return {
      success: false,
      failureCode: 'LINE_USER_NOT_BOUND'
    };
  }

  // 4. Pilot Whitelist Check
  const isWhitelisted = Array.isArray(pilotWhitelist) && pilotWhitelist.some(
    r => (typeof r === 'string' ? r === recipientLineUserId : r && r.lineUserId === recipientLineUserId && r.optInStatus === 'OPTED_IN')
  );
  if (!isWhitelisted) {
    return {
      success: false,
      failureCode: 'NOT_IN_PILOT_WHITELIST'
    };
  }

  // 5. Adapter Injection Check
  if (!adapterInjected) {
    return {
      success: false,
      failureCode: 'LINE_ADAPTER_MISSING'
    };
  }

  // 6. Token Configured Check
  if (!tokenConfigured) {
    return {
      success: false,
      failureCode: 'LINE_TOKEN_MISSING'
    };
  }

  // 7. API Execution Error Check
  if (simulatedApiError) {
    const errorRecord = {
      reservationNumber,
      lineUserId: recipientLineUserId,
      intent,
      status: 'FAILED',
      failureCode: 'LINE_API_EXECUTION_ERROR',
      sentAt: new Date().toISOString()
    };
    return {
      success: false,
      failureCode: 'LINE_API_EXECUTION_ERROR',
      auditRecord: errorRecord
    };
  }

  const lineRequestId = `line-req-${Date.now()}`;
  const successRecord = {
    reservationNumber,
    lineUserId: recipientLineUserId,
    intent,
    status: 'DELIVERED',
    lineRequestId,
    sentAt: new Date().toISOString()
  };

  return {
    success: true,
    delivered: true,
    lineRequestId,
    auditRecord: successRecord
  };
}

module.exports = {
  OCR_CONFIDENCE_THRESHOLD,
  evaluateAllocationRules,
  evaluateUserPermission,
  sanitizeReadbackAuditRecord,
  evaluateLineNotificationPolicy
};
