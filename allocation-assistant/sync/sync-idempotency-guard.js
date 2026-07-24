/**
 * SyncIdempotencyGuard (Pack 4C)
 */

class SyncIdempotencyGuard {
  constructor() {
    this.cacheStore = new Map(); // key -> { payloadHash, response }
  }

  _hashPayload(payload) {
    return JSON.stringify(payload || {});
  }

  checkKey(key, payload) {
    if (!key) return { cached: false };

    const cached = this.cacheStore.get(key);
    if (!cached) return { cached: false };

    const currentHash = this._hashPayload(payload);
    if (cached.payloadHash === currentHash) {
      return {
        cached: true,
        isReplay: true,
        response: { ...cached.response }
      };
    } else {
      throw new Error('IDEMPOTENCY_CONFLICT: Key reused with conflicting payload');
    }
  }

  saveResult(key, payload, response) {
    if (!key) return;
    this.cacheStore.set(key, {
      payloadHash: this._hashPayload(payload),
      response: { ...response }
    });
  }
}

module.exports = {
  SyncIdempotencyGuard
};
