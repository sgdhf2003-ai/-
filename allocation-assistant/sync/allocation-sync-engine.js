/**
 * AllocationSyncEngine & State Machine Coordinator with Recovery (Updated Pack 4C)
 */

const { DRAFT_STATUSES } = require('../contracts/draft-contract');
const { validateSyncRequest } = require('../contracts/sync-contract');
const { SyncIdempotencyGuard } = require('./sync-idempotency-guard');

class AllocationSyncEngine {
  constructor({ provider, reservationAdapter, idempotencyGuard }) {
    if (!provider || !reservationAdapter) {
      throw new Error('provider and reservationAdapter are required for AllocationSyncEngine');
    }
    this.provider = provider;
    this.reservationAdapter = reservationAdapter;
    this.idempotencyGuard = idempotencyGuard || new SyncIdempotencyGuard();
  }

  executeSync({ draftId, holdIdempotencyKey, correlationId = '', providerMode = 'SIMULATION' }) {
    if (!draftId || !holdIdempotencyKey) {
      throw new Error('draftId and holdIdempotencyKey are required for executeSync');
    }

    const statusRes = this.provider.getAllocationStatus(draftId, providerMode);
    if (!statusRes || !statusRes.success || !statusRes.draft) {
      throw new Error(`DRAFT_NOT_FOUND: Draft ${draftId} does not exist`);
    }

    const draft = statusRes.draft;

    // Check Idempotency Guard first
    const guardCheck = this.idempotencyGuard.checkKey(holdIdempotencyKey, { draftId, items: draft.items });
    if (guardCheck.cached && guardCheck.isReplay) {
      return guardCheck.response;
    }

    const allowedStatuses = [DRAFT_STATUSES.ALLOCATION_CONFIRMED, DRAFT_STATUSES.SYNC_FAILED];

    if (!allowedStatuses.includes(draft.status)) {
      throw new Error(`INVALID_SYNC_STATE: Draft ${draftId} in state ${draft.status} is not eligible for sync`);
    }

    // Lock state transition: ALLOCATION_CONFIRMED -> SYNC_PENDING -> SYNC_IN_PROGRESS
    draft.status = DRAFT_STATUSES.SYNC_IN_PROGRESS;
    draft.updatedAt = new Date().toISOString();
    this.provider.draftsStore.set(draftId, draft);

    if (this.provider.auditLogger) {
      this.provider.auditLogger.logEvent({
        operator: draft.salesOwner || 'sync_engine',
        action: 'SYNC_INITIATED',
        draftId,
        correlationId,
        tenantId: draft.tenantContext ? draft.tenantContext.tenantId : 'tenant-jy-001',
        companyId: draft.tenantContext ? draft.tenantContext.companyId : 'comp-jy',
        details: `Initiated reservation sync with key ${holdIdempotencyKey}`
      });
    }

    const syncRequest = validateSyncRequest({
      syncRequestId: `sync_req_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      draftId,
      holdIdempotencyKey,
      tenantContext: draft.tenantContext,
      items: draft.items
    });

    try {
      const syncResult = this.reservationAdapter.syncReservation(syncRequest);

      if (syncResult.success && syncResult.status === 'SYNCED') {
        draft.status = DRAFT_STATUSES.SYNCED;
        draft.updatedAt = new Date().toISOString();
        this.provider.draftsStore.set(draftId, draft);

        if (this.provider.auditLogger) {
          this.provider.auditLogger.logEvent({
            operator: draft.salesOwner || 'sync_engine',
            action: 'SYNC_COMPLETED',
            draftId,
            correlationId,
            tenantId: draft.tenantContext ? draft.tenantContext.tenantId : 'tenant-jy-001',
            companyId: draft.tenantContext ? draft.tenantContext.companyId : 'comp-jy',
            details: `Completed sync with reservationId ${syncResult.reservationId}`
          });
        }

        const finalResult = {
          success: true,
          status: DRAFT_STATUSES.SYNCED,
          reservationId: syncResult.reservationId,
          holdIdempotencyKey,
          correlationId,
          isReplay: Boolean(syncResult.isReplay)
        };

        this.idempotencyGuard.saveResult(holdIdempotencyKey, { draftId, items: draft.items }, finalResult);
        return finalResult;
      } else {
        draft.status = DRAFT_STATUSES.SYNC_FAILED;
        draft.updatedAt = new Date().toISOString();
        this.provider.draftsStore.set(draftId, draft);

        if (this.provider.auditLogger) {
          this.provider.auditLogger.logEvent({
            operator: draft.salesOwner || 'sync_engine',
            action: 'SYNC_FAILED',
            draftId,
            correlationId,
            tenantId: draft.tenantContext ? draft.tenantContext.tenantId : 'tenant-jy-001',
            companyId: draft.tenantContext ? draft.tenantContext.companyId : 'comp-jy',
            details: `Sync failed with errorCode ${syncResult.errorCode}`
          });
        }

        const failedResult = {
          success: false,
          status: DRAFT_STATUSES.SYNC_FAILED,
          errorCode: syncResult.errorCode || 'RESERVATION_REJECTED',
          holdIdempotencyKey,
          correlationId
        };

        return failedResult;
      }
    } catch (err) {
      // Handle UNKNOWN_OUTCOME recovery via secondary query
      if (err.message && err.message.includes('UNKNOWN_OUTCOME') && typeof this.reservationAdapter.queryReservationStatus === 'function') {
        const queryRes = this.reservationAdapter.queryReservationStatus(holdIdempotencyKey);
        if (queryRes && queryRes.found && queryRes.status === 'SYNCED') {
          draft.status = DRAFT_STATUSES.SYNCED;
          draft.updatedAt = new Date().toISOString();
          this.provider.draftsStore.set(draftId, draft);

          if (this.provider.auditLogger) {
            this.provider.auditLogger.logEvent({
              operator: draft.salesOwner || 'sync_engine',
              action: 'SYNC_RECOVERED',
              draftId,
              correlationId,
              tenantId: draft.tenantContext ? draft.tenantContext.tenantId : 'tenant-jy-001',
              companyId: draft.tenantContext ? draft.tenantContext.companyId : 'comp-jy',
              details: `Recovered unknown-outcome sync for hold ${holdIdempotencyKey}`
            });
          }

          const recoveredResult = {
            success: true,
            status: DRAFT_STATUSES.SYNCED,
            reservationId: (queryRes.record && queryRes.record.reservationId) || 'res_recovered',
            holdIdempotencyKey,
            correlationId,
            recovered: true
          };

          this.idempotencyGuard.saveResult(holdIdempotencyKey, { draftId, items: draft.items }, recoveredResult);
          return recoveredResult;
        } else {
          draft.status = DRAFT_STATUSES.SYNC_FAILED;
          draft.updatedAt = new Date().toISOString();
          this.provider.draftsStore.set(draftId, draft);

          if (this.provider.auditLogger) {
            this.provider.auditLogger.logEvent({
              operator: draft.salesOwner || 'sync_engine',
              action: 'SYNC_RECOVERED_FAILED',
              draftId,
              correlationId,
              tenantId: draft.tenantContext ? draft.tenantContext.tenantId : 'tenant-jy-001',
              companyId: draft.tenantContext ? draft.tenantContext.companyId : 'comp-jy',
              details: `Unknown outcome recovery confirmed no remote record`
            });
          }

          return {
            success: false,
            status: DRAFT_STATUSES.SYNC_FAILED,
            errorCode: 'UNKNOWN_OUTCOME_UNCONFIRMED',
            holdIdempotencyKey,
            correlationId,
            recovered: true
          };
        }
      }

      draft.status = DRAFT_STATUSES.SYNC_FAILED;
      draft.updatedAt = new Date().toISOString();
      this.provider.draftsStore.set(draftId, draft);

      if (this.provider.auditLogger) {
        this.provider.auditLogger.logEvent({
          operator: draft.salesOwner || 'sync_engine',
          action: 'SYNC_FAILED',
          draftId,
          correlationId,
          tenantId: draft.tenantContext ? draft.tenantContext.tenantId : 'tenant-jy-001',
          companyId: draft.tenantContext ? draft.tenantContext.companyId : 'comp-jy',
          details: `Sync caught error: ${err.message}`
        });
      }

      throw err;
    }
  }
}

module.exports = {
  AllocationSyncEngine
};
