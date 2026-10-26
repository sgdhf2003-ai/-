/**
 * Stage 42-G6: Projection Environment Guard
 *
 * Enforces Fail-Closed verification across runtime configuration:
 * - Local Firestore emulator host boundary validation
 * - Independent GCLOUD_PROJECT and GOOGLE_CLOUD_PROJECT validation (no shadowing)
 * - Authoritative Google Sheets spreadsheet configuration
 * - PubSub and Alerting endpoint validation
 */

"use strict";

function validateEmulatorHost(rawHost) {
  if (rawHost === undefined || rawHost === null || typeof rawHost !== "string" || rawHost.trim() === "") {
    throw new Error(`FAIL_CLOSED_EMULATOR_GUARD: FIRESTORE_EMULATOR_HOST is missing, empty, or whitespace-only (got: ${rawHost})`);
  }
  const trimmed = rawHost.trim();
  if (/^[a-zA-Z]+:\/\//.test(trimmed)) {
    throw new Error(`FAIL_CLOSED_EMULATOR_GUARD: FIRESTORE_EMULATOR_HOST must not contain a URL scheme: ${trimmed}`);
  }
  const match = trimmed.match(/^([^:]+):(\d+)$/);
  if (!match) {
    throw new Error(`FAIL_CLOSED_EMULATOR_GUARD: FIRESTORE_EMULATOR_HOST must match <host>:<port>: ${trimmed}`);
  }
  const host = match[1];
  const port = Number(match[2]);
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error(`FAIL_CLOSED_EMULATOR_GUARD: Host must be local (127.0.0.1 or localhost), got: ${host}`);
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`FAIL_CLOSED_EMULATOR_GUARD: Port must be an integer between 1 and 65535: ${port}`);
  }
  return trimmed;
}

function validateProjectEnvironment(env = process.env, expectedProject = null) {
  const gcloud = env.GCLOUD_PROJECT;
  const googleCloud = env.GOOGLE_CLOUD_PROJECT;

  if (gcloud === undefined || gcloud === null || typeof gcloud !== "string" || gcloud.trim() === "") {
    throw new Error(`FAIL_CLOSED_PROJECT_GUARD: GCLOUD_PROJECT is missing or empty (got: ${gcloud})`);
  }
  if (googleCloud === undefined || googleCloud === null || typeof googleCloud !== "string" || googleCloud.trim() === "") {
    throw new Error(`FAIL_CLOSED_PROJECT_GUARD: GOOGLE_CLOUD_PROJECT is missing or empty (got: ${googleCloud})`);
  }

  const cleanGcloud = gcloud.trim();
  const cleanGoogleCloud = googleCloud.trim();

  if (cleanGcloud !== cleanGoogleCloud) {
    throw new Error(
      `FAIL_CLOSED_PROJECT_GUARD: Environment project mismatch: GCLOUD_PROJECT='${cleanGcloud}' vs GOOGLE_CLOUD_PROJECT='${cleanGoogleCloud}'`
    );
  }

  if (expectedProject !== null && cleanGcloud !== expectedProject) {
    throw new Error(
      `FAIL_CLOSED_PROJECT_GUARD: Expected project '${expectedProject}', but got '${cleanGcloud}'`
    );
  }

  return cleanGcloud;
}

function validateSheetConfig(config) {
  if (!config || typeof config !== "object") {
    throw new Error("FAIL_CLOSED_SHEET_GUARD: Sheet configuration object is required");
  }
  if (!config.spreadsheetId || typeof config.spreadsheetId !== "string" || config.spreadsheetId.trim() === "") {
    throw new Error("FAIL_CLOSED_SHEET_GUARD: spreadsheetId is missing or empty");
  }
  return {
    spreadsheetId: config.spreadsheetId.trim(),
    sheetName: (config.sheetName && typeof config.sheetName === "string" ? config.sheetName.trim() : "PROJECTION_LOG")
  };
}

function validateTopicConfig(topic) {
  if (!topic || typeof topic !== "string" || topic.trim() === "") {
    throw new Error("FAIL_CLOSED_TOPIC_GUARD: Topic identifier is missing or empty");
  }
  return topic.trim();
}

function validateProjectionEnvironment(options = {}) {
  const env = options.env || process.env;
  const isEmulator = options.isEmulator !== undefined ? options.isEmulator : Boolean(env.FIRESTORE_EMULATOR_HOST);

  let emulatorHost = null;
  if (isEmulator) {
    emulatorHost = validateEmulatorHost(env.FIRESTORE_EMULATOR_HOST);
  }

  const projectId = validateProjectEnvironment(env, options.expectedProject || null);

  let sheetConfig = null;
  if (options.sheetConfig) {
    sheetConfig = validateSheetConfig(options.sheetConfig);
  }

  let topic = null;
  if (options.topic) {
    topic = validateTopicConfig(options.topic);
  }

  return {
    isEmulator,
    emulatorHost,
    projectId,
    sheetConfig,
    topic
  };
}

module.exports = {
  validateEmulatorHost,
  validateProjectEnvironment,
  validateSheetConfig,
  validateTopicConfig,
  validateProjectionEnvironment
};
