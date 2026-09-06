"use strict";

/**
 * ServerFirestoreClientFactory: Controlled Security Boundary for Server-side Firestore Clients & Test Fakes.
 *
 * Security & Boundary Rules:
 * 1. Uses a module-private unique Symbol (not Symbol.for) that CANNOT be retrieved, constructed, or exported outside this file.
 * 2. Does NOT export any bootstrap token or supply any `getServerBootstrapToken()` helper method.
 * 3. Does NOT expose an open `wrapAdminSdkClient` wrapper accepting unverified caller objects.
 * 4. Only `createEmulatorFake` and `createEmulatorAdminClient` are exposed as controlled entry points for local testing.
 * 5. `createEmulatorAdminClient` strictly connects to local emulator (127.0.0.1 / localhost) using firebase-admin without live GCP/Firebase connection.
 * 6. Clients failing Server Factory validation return `hasNativeAcidTransaction: false`, causing Adapter preflight to fail closed with `PRODUCTION_TRANSACTION_CAPABILITY_MISSING`.
 */

// Module-private unique Symbol (NOT Symbol.for, not exported, unavailable externally)
const PRIVATE_FACTORY_CAPABILITY = Symbol("JYAI_SERVER_FIRESTORE_FACTORY_PRIVATE_CAPABILITY");

class FakeFirestoreTransaction {
  constructor(store) {
    this.store = store;
    this.stagedWrites = [];
  }

  async get(docRef) {
    const data = this.store.collections[docRef.collection]?.[docRef.id];
    return {
      exists: data !== undefined && data !== null,
      id: docRef.id,
      data: () => (data ? JSON.parse(JSON.stringify(data)) : null)
    };
  }

  update(docRef, data) {
    this.stagedWrites.push({ type: "UPDATE", collection: docRef.collection, id: docRef.id, data });
  }

  set(docRef, data) {
    this.stagedWrites.push({ type: "SET", collection: docRef.collection, id: docRef.id, data });
  }

  delete(docRef) {
    this.stagedWrites.push({ type: "DELETE", collection: docRef.collection, id: docRef.id });
  }
}

class FakeFirestoreClient {
  constructor(initialState = {}, capabilityToken = null) {
    if (capabilityToken !== PRIVATE_FACTORY_CAPABILITY) {
      throw new Error("UNAUTHORIZED_CLIENT_INSTANTIATION: FakeFirestoreClient can only be instantiated internally via ServerFirestoreClientFactory");
    }

    // Controlled trust flags attached exclusively by internal factory
    Object.defineProperty(this, "isTrustedServerBackend", {
      value: true,
      writable: false,
      configurable: false
    });
    Object.defineProperty(this, "hasNativeTransactionAbortGuarantee", {
      value: true,
      writable: false,
      configurable: false
    });
    Object.defineProperty(this, "isEmulatorTestFake", {
      value: true,
      writable: false,
      configurable: false
    });

    this.type = "firestore-emulator-fake";
    this.collections = {
      holds: initialState.holds ? JSON.parse(JSON.stringify(initialState.holds)) : {},
      inventory: initialState.inventory ? JSON.parse(JSON.stringify(initialState.inventory)) : {},
      ledger: initialState.ledger ? JSON.parse(JSON.stringify(initialState.ledger)) : {},
      auditLogs: initialState.auditLogs ? JSON.parse(JSON.stringify(initialState.auditLogs)) : {},
      operations: initialState.operations ? JSON.parse(JSON.stringify(initialState.operations)) : {}
    };

    this.FieldValue = {
      serverTimestamp: () => ({ _type: "FieldValue.serverTimestamp", iso: new Date().toISOString() })
    };
  }

  doc(path) {
    const parts = path.split("/");
    if (parts.length === 2) {
      return { collection: parts[0], id: parts[1] };
    }
    throw new Error(`Invalid Firestore doc path: ${path}`);
  }

  collection(name) {
    return {
      name,
      doc: (id) => ({ collection: name, id })
    };
  }

  async runTransaction(updateFunction) {
    const transaction = new FakeFirestoreTransaction(this);
    try {
      const result = await updateFunction(transaction);
      for (const write of transaction.stagedWrites) {
        if (!this.collections[write.collection]) {
          this.collections[write.collection] = {};
        }
        if (write.type === "SET") {
          this.collections[write.collection][write.id] = JSON.parse(JSON.stringify(write.data));
        } else if (write.type === "UPDATE") {
          const existing = this.collections[write.collection][write.id] || {};
          this.collections[write.collection][write.id] = {
            ...existing,
            ...JSON.parse(JSON.stringify(write.data))
          };
        } else if (write.type === "DELETE") {
          delete this.collections[write.collection][write.id];
        }
      }
      return result;
    } catch (err) {
      transaction.stagedWrites = [];
      throw err;
    }
  }
}

class ServerFirestoreClientFactory {
  /**
   * Create a certified trusted Server-side Firestore Client Fake for local testing.
   */
  static createEmulatorFake(initialState = {}) {
    return new FakeFirestoreClient(initialState, PRIVATE_FACTORY_CAPABILITY);
  }

  /**
   * Create a certified trusted Server-side Firestore Client connected strictly to the local Firestore Emulator via firebase-admin.
   */
  static createEmulatorAdminClient(options = {}) {
    const projectId = options.projectId || "demo-jingyang-sales";
    const emulatorHost = options.emulatorHost || "127.0.0.1:8080";

    // Enforce local emulator host boundary
    if (!emulatorHost.startsWith("127.0.0.1:") && !emulatorHost.startsWith("localhost:")) {
      throw new Error(`INVALID_EMULATOR_HOST: Host must be local (127.0.0.1 or localhost). Got: ${emulatorHost}`);
    }

    process.env.FIRESTORE_EMULATOR_HOST = emulatorHost;

    const { initializeApp, getApps } = require("firebase-admin/app");
    const { getFirestore, FieldValue } = require("firebase-admin/firestore");

    const appName = `emulator-${projectId}`;
    const appsList = getApps();
    const existingApp = appsList.find((a) => a && a.name === appName);
    let app;
    if (existingApp) {
      app = existingApp;
    } else {
      app = initializeApp({ projectId }, appName);
    }

    const firestoreDb = getFirestore(app);

    // Attach controlled trust flags and FieldValue binding
    Object.defineProperty(firestoreDb, "isTrustedServerBackend", {
      value: true,
      writable: false,
      configurable: false
    });
    Object.defineProperty(firestoreDb, "hasNativeTransactionAbortGuarantee", {
      value: true,
      writable: false,
      configurable: false
    });
    Object.defineProperty(firestoreDb, "isEmulatorAdminClient", {
      value: true,
      writable: false,
      configurable: false
    });
    Object.defineProperty(firestoreDb, "FieldValue", {
      value: FieldValue,
      writable: false,
      configurable: false
    });

    return firestoreDb;
  }
}

module.exports = {
  ServerFirestoreClientFactory,
  FakeFirestoreClient
};
