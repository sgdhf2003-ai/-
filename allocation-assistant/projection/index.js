/**
 * Stage 42-G6: Projection Subsystem Entry Point
 */

"use strict";

const {
  ProjectionEngine,
  createProjectionEngine
} = require("./projection-engine");

const {
  validateEmulatorHost,
  validateProjectEnvironment,
  validateSheetConfig,
  validateTopicConfig,
  validateProjectionEnvironment
} = require("./projection-environment-guard");

const {
  computePayloadHash64,
  serializeCanonicalJson,
  createFakeClock,
  getProductionClock,
  validateAllocationPayload,
  buildApplicationEnvelope,
  unpackTransportCloudEvent,
  sanitizeLogEntry,
  ALLOWED_EVENT_TYPES,
  ALLOWED_SOURCES
} = require("../contracts/projection-contract");

module.exports = {
  // Facade & Factory
  ProjectionEngine,
  createProjectionEngine,

  // Environment & Configuration Guards
  validateEmulatorHost,
  validateProjectEnvironment,
  validateSheetConfig,
  validateTopicConfig,
  validateProjectionEnvironment,

  // Contracts & Utilities
  computePayloadHash64,
  serializeCanonicalJson,
  createFakeClock,
  getProductionClock,
  validateAllocationPayload,
  buildApplicationEnvelope,
  unpackTransportCloudEvent,
  sanitizeLogEntry,
  ALLOWED_EVENT_TYPES,
  ALLOWED_SOURCES
};
