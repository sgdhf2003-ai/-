/**
 * AuditLogger & Audit Event Collector (Pack 1D)
 */

const { validateAuditEvent } = require('../contracts/audit-contract');

class AuditLogger {
  constructor() {
    this.events = [];
  }

  _computeDigest(data) {
    return `sha256_${JSON.stringify(data || {}).length}_${Date.now()}`;
  }

  logEvent(data) {
    if (!data || typeof data !== 'object') {
      throw new Error('AuditEvent data must be a non-null object');
    }

    const validated = validateAuditEvent(data);
    const event = {
      ...validated,
      correlationId: (data.correlationId || '').toString(),
      tenantId: (data.tenantId || 'tenant-jy-001').toString(),
      companyId: (data.companyId || 'comp-jingyang-taiwan').toString(),
      occurredAt: data.occurredAt || new Date().toISOString(),
      payloadDigest: this._computeDigest(data)
    };

    // Freeze object to ensure immutability
    const immutableEvent = Object.freeze(event);
    this.events.push(immutableEvent);
    return immutableEvent;
  }

  getEventsByDraftId(draftId) {
    return this.events.filter(e => e.draftId === draftId);
  }

  getEventsByCorrelationId(correlationId) {
    return this.events.filter(e => e.correlationId === correlationId);
  }

  getAllEvents() {
    return [...this.events];
  }
}

module.exports = {
  AuditLogger
};
