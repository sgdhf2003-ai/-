/**
 * Stage 42-H / Phase 1: Declarative Pilot Configuration & 10-Identity IAM Allowlist Validator
 *
 * Implements:
 * - TC-15: Pilot Deployment Configuration Validation (maxInstances=1, concurrency=1, timeoutSeconds=120)
 * - TC-16: Full 10-Identity Resource-Scoped IAM Allowlist Validation
 *   - Strictly 10 authorized identities (5 Runtime SAs, 4 Trigger SAs, 1 System Service Agent)
 *   - Strictly resource-scoped grants (no wildcards '*', no project-wide scope except datastore.user & eventarc.eventReceiver)
 *   - Zero Secret Manager roles (roles/secretmanager.* strictly forbidden)
 *   - Independent Google Sheets OAuth scope & Editor ACL application configs
 */

"use strict";

const ALLOWED_IAM_POLICIES = {
  // 5 Runtime Service Accounts
  transactionWriterRuntimeSa: [
    { role: "roles/datastore.user", resource: "projects/PROJECT_ID" }
  ],
  outboxPublisherRuntimeSa: [
    { role: "roles/datastore.user", resource: "projects/PROJECT_ID" },
    { role: "roles/pubsub.publisher", resource: "projects/PROJECT_ID/topics/jy-reservation-events" }
  ],
  projectionWorkerRuntimeSa: [
    { role: "roles/datastore.user", resource: "projects/PROJECT_ID" }
  ],
  dlqReconcilerRuntimeSa: [
    { role: "roles/datastore.user", resource: "projects/PROJECT_ID" }
  ],
  projectionReconcilerRuntimeSa: [
    { role: "roles/datastore.user", resource: "projects/PROJECT_ID" }
  ],

  // 4 Trigger Service Accounts
  firestoreEventarcTriggerSa: [
    { role: "roles/eventarc.eventReceiver", resource: "projects/PROJECT_ID" },
    { role: "roles/run.invoker", resource: "projects/PROJECT_ID/locations/asia-east1/services/jy-outbox-publisher" }
  ],
  pubsubEventarcTriggerSa: [
    { role: "roles/eventarc.eventReceiver", resource: "projects/PROJECT_ID" },
    { role: "roles/run.invoker", resource: "projects/PROJECT_ID/locations/asia-east1/services/jy-projection-worker" }
  ],
  dlqEventarcTriggerSa: [
    { role: "roles/eventarc.eventReceiver", resource: "projects/PROJECT_ID" },
    { role: "roles/run.invoker", resource: "projects/PROJECT_ID/locations/asia-east1/services/jy-dlq-reconciler" }
  ],
  cloudSchedulerInvokerSa: [
    { role: "roles/run.invoker", resource: "projects/PROJECT_ID/locations/asia-east1/services/jy-outbox-publisher" },
    { role: "roles/run.invoker", resource: "projects/PROJECT_ID/locations/asia-east1/services/jy-projection-reconciler" }
  ],

  // 1 System Service Agent
  pubsubServiceAgent: [
    { role: "roles/pubsub.publisher", resource: "projects/PROJECT_ID/topics/jy-reservation-events-dlq" },
    { role: "roles/pubsub.subscriber", resource: "projects/PROJECT_ID/subscriptions/jy-reservation-events-sub" }
  ]
};

const REQUIRED_APP_CONFIGS = {
  projectionWorkerSheetsAccess: {
    serviceAccount: "projectionWorkerRuntimeSa",
    oauthScopes: ["https://www.googleapis.com/auth/spreadsheets"],
    sheetRole: "editor"
  },
  projectionReconcilerSheetsAccess: {
    serviceAccount: "projectionReconcilerRuntimeSa",
    oauthScopes: ["https://www.googleapis.com/auth/spreadsheets"],
    sheetRole: "editor"
  }
};

/**
 * TC-15: Validate Pilot Deployment Configuration for Cloud Run services
 *
 * @param {object} config
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validatePilotDeploymentConfig(config) {
  const errors = [];
  if (!config || typeof config !== "object") {
    return { valid: false, errors: ["Configuration object is required"] };
  }
  if (config.maxInstances !== 1) {
    errors.push(`maxInstances must be exactly 1 for pilot phase (got: ${config.maxInstances})`);
  }
  if (config.concurrency !== 1) {
    errors.push(`concurrency must be exactly 1 for pilot phase (got: ${config.concurrency})`);
  }
  if (config.timeoutSeconds !== 120) {
    errors.push(`timeoutSeconds must be exactly 120 (got: ${config.timeoutSeconds})`);
  }
  return { valid: errors.length === 0, errors };
}

/**
 * TC-16: Validate 10-Identity Resource-Scoped IAM Allowlist & App Configs
 *
 * @param {object} bindings - Map of identityKey -> { bindings: [{ role, resource }] }
 * @param {object} appConfigs - Map of configKey -> { serviceAccount, oauthScopes, spreadsheetId, sheetRole }
 * @param {string} [projectId="PROJECT_ID"] - Project ID to replace template placeholders
 * @returns {{ valid: boolean, violations: string[] }}
 */
function validateFullIamRoleAllowlist(bindings, appConfigs = {}, projectId = "PROJECT_ID") {
  const violations = [];
  if (!bindings || typeof bindings !== "object") {
    return { valid: false, violations: ["IAM bindings object is required"] };
  }

  const knownIdentities = Object.keys(ALLOWED_IAM_POLICIES);
  const inputIdentities = Object.keys(bindings);

  // 1. Strictly forbid 11th identity or unknown identities
  for (const id of inputIdentities) {
    if (!knownIdentities.includes(id)) {
      violations.push(`Unknown identity '${id}' detected; strictly only 10 authorized identities allowed`);
    }
  }

  // 2. Validate all 10 known identities
  for (const saKey of knownIdentities) {
    const saConfig = bindings[saKey];
    if (!saConfig || !Array.isArray(saConfig.bindings)) {
      violations.push(`Missing or invalid SA configuration/bindings for ${saKey}`);
      continue;
    }

    const expectedBindings = ALLOWED_IAM_POLICIES[saKey].map((b) => ({
      role: b.role,
      resource: b.resource.replace(/PROJECT_ID/g, projectId)
    }));

    for (const b of saConfig.bindings) {
      if (!b || typeof b !== "object" || !b.role || !b.resource) {
        violations.push(`Malformed binding on ${saKey}: role and resource are required`);
        continue;
      }

      // Zero Secret Manager roles
      if (b.role.includes("secretmanager")) {
        violations.push(`Illegal Secret Manager role '${b.role}' detected on ${saKey}; Secret Manager is strictly forbidden`);
      }

      // Projection Worker runtime SA must NOT possess roles/run.invoker
      if (saKey === "projectionWorkerRuntimeSa" && b.role === "roles/run.invoker") {
        violations.push(`Projection Worker runtime SA must NOT possess roles/run.invoker`);
      }

      // Pub/Sub Service Agent must NOT possess serviceAccountTokenCreator without Change Request
      if (saKey === "pubsubServiceAgent" && b.role.includes("serviceAccountTokenCreator")) {
        violations.push(`Pub/Sub Service Agent must NOT possess roles/iam.serviceAccountTokenCreator without explicit Owner Change Request`);
      }

      // Wildcards strictly forbidden
      if (b.resource === "*") {
        violations.push(`Wildcard resource '*' strictly forbidden for role '${b.role}' on ${saKey}`);
      }

      // Project-wide scope check
      const projectScopeResource = `projects/${projectId}`;
      const allowedProjectRoles = ["roles/datastore.user", "roles/eventarc.eventReceiver"];
      if (b.resource === projectScopeResource && !allowedProjectRoles.includes(b.role)) {
        violations.push(`Project-wide resource '${b.resource}' strictly forbidden for role '${b.role}' on ${saKey}`);
      }

      // Check whether role & resource match expected allowlist
      const match = expectedBindings.find((exp) => exp.role === b.role && exp.resource === b.resource);
      if (!match) {
        violations.push(`Unauthorized role-resource pairing '${b.role}' on '${b.resource}' detected for ${saKey}`);
      }
    }

    // Check that every mandatory expected binding is present
    for (const exp of expectedBindings) {
      const match = saConfig.bindings.find((b) => b.role === exp.role && b.resource === exp.resource);
      if (!match) {
        violations.push(`Missing mandatory binding '${exp.role}' on '${exp.resource}' for ${saKey}`);
      }
    }
  }

  // 3. Validate independent Google Sheets OAuth & Editor ACL application configurations
  for (const [cfgKey, expectedCfg] of Object.entries(REQUIRED_APP_CONFIGS)) {
    const actualCfg = appConfigs[cfgKey];
    if (!actualCfg) {
      violations.push(`Missing independent configuration '${cfgKey}'`);
      continue;
    }
    if (actualCfg.serviceAccount !== expectedCfg.serviceAccount) {
      violations.push(`Mismatch serviceAccount on ${cfgKey}: expected '${expectedCfg.serviceAccount}', got '${actualCfg.serviceAccount}'`);
    }
    if (!Array.isArray(actualCfg.oauthScopes) || !actualCfg.oauthScopes.includes("https://www.googleapis.com/auth/spreadsheets")) {
      violations.push(`Missing mandatory spreadsheets OAuth scope on ${cfgKey}`);
    }
    if (actualCfg.sheetRole !== "editor" || !actualCfg.spreadsheetId || typeof actualCfg.spreadsheetId !== "string" || actualCfg.spreadsheetId.trim() === "") {
      violations.push(`Invalid Sheet ACL or spreadsheetId on ${cfgKey}; must be editor on independent audit sheet`);
    }
  }

  return { valid: violations.length === 0, violations };
}

/**
 * Helper to generate authoritative, fully compliant IAM bindings and App Configs
 *
 * @param {string} projectId
 * @param {string} spreadsheetId
 * @returns {{ bindings: object, appConfigs: object }}
 */
function generateAuthoritativePilotIamConfig(projectId, spreadsheetId) {
  const bindings = {};
  for (const [saKey, list] of Object.entries(ALLOWED_IAM_POLICIES)) {
    bindings[saKey] = {
      bindings: list.map((item) => ({
        role: item.role,
        resource: item.resource.replace(/PROJECT_ID/g, projectId)
      }))
    };
  }

  const appConfigs = {
    projectionWorkerSheetsAccess: {
      serviceAccount: "projectionWorkerRuntimeSa",
      oauthScopes: ["https://www.googleapis.com/auth/spreadsheets"],
      spreadsheetId: spreadsheetId,
      sheetRole: "editor"
    },
    projectionReconcilerSheetsAccess: {
      serviceAccount: "projectionReconcilerRuntimeSa",
      oauthScopes: ["https://www.googleapis.com/auth/spreadsheets"],
      spreadsheetId: spreadsheetId,
      sheetRole: "editor"
    }
  };

  return { bindings, appConfigs };
}

module.exports = {
  ALLOWED_IAM_POLICIES,
  REQUIRED_APP_CONFIGS,
  validatePilotDeploymentConfig,
  validateFullIamRoleAllowlist,
  generateAuthoritativePilotIamConfig
};
