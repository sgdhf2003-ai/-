"use strict";

/**
 * FakePubSubClientAdapter: In-memory Pub/Sub client test adapter for Stage 42-G2
 *
 * Security & Boundary Rules:
 * 1. Pure in-memory storage, 0 network I/O, 0 GCP Pub/Sub resource connections.
 * 2. Requires strict message attributes (schemaVersion, eventType, operationId, eventId).
 * 3. Enforces valid Base64 payload data.
 * 4. Supports fault injection (simulated network failure, simulated worker crash before completion mark).
 */

const crypto = require("crypto");

class FakePubSubClientAdapter {
  constructor() {
    this.messages = [];
    this.shouldFailNextPublish = false;
    this.failureError = null;
    this.crashBeforeCompletionHook = null;
  }

  /**
   * Set failure injection for next publish call.
   */
  injectFailure(error = new Error("PUBSUB_SERVICE_UNAVAILABLE")) {
    this.shouldFailNextPublish = true;
    this.failureError = error;
  }

  /**
   * Set hook to simulate crash right after publish message is accepted by Pub/Sub
   */
  setCrashBeforeCompletionHook(hookFn) {
    this.crashBeforeCompletionHook = hookFn;
  }

  /**
   * Publish a message to a topic.
   * @param {string} topic - topic name (e.g. "jy-reservation-events")
   * @param {object} message - { attributes: object, data: string (base64) }
   * @returns {Promise<string>} messageId
   */
  async publish(topic, message) {
    if (!topic || typeof topic !== "string") {
      throw new Error("INVALID_TOPIC: Topic must be a non-empty string");
    }
    if (!message || typeof message !== "object") {
      throw new Error("INVALID_MESSAGE: Message must be an object");
    }

    if (this.shouldFailNextPublish) {
      this.shouldFailNextPublish = false;
      const err = this.failureError || new Error("PUBSUB_PUBLISH_FAILED: simulated failure");
      this.failureError = null;
      throw err;
    }

    const { attributes, data } = message;
    if (!attributes || typeof attributes !== "object") {
      throw new Error("INVALID_ATTRIBUTES: attributes object is required");
    }

    const requiredAttrs = ["schemaVersion", "eventType", "operationId", "eventId"];
    for (const attr of requiredAttrs) {
      if (!attributes[attr] || typeof attributes[attr] !== "string") {
        throw new Error(`MISSING_ATTRIBUTE: attributes.${attr} is required and must be a string`);
      }
    }

    if (!data || typeof data !== "string") {
      throw new Error("INVALID_DATA: message.data must be a non-empty base64 string");
    }

    // Validate data is valid Base64
    const buffer = Buffer.from(data, "base64");
    if (buffer.toString("base64") !== data.replace(/\s+/g, "")) {
      throw new Error("INVALID_BASE64: message.data is not valid base64");
    }

    const messageId = `pubsub_msg_${crypto.randomUUID()}`;
    const recordedMessage = {
      messageId,
      topic,
      attributes: { ...attributes },
      data,
      publishedAtMillis: Date.now()
    };

    this.messages.push(recordedMessage);

    if (typeof this.crashBeforeCompletionHook === "function") {
      const hook = this.crashBeforeCompletionHook;
      this.crashBeforeCompletionHook = null;
      await hook(messageId, recordedMessage);
    }

    return messageId;
  }

  /**
   * Clear all published messages.
   */
  clear() {
    this.messages = [];
    this.shouldFailNextPublish = false;
    this.failureError = null;
    this.crashBeforeCompletionHook = null;
  }
}

module.exports = {
  FakePubSubClientAdapter
};
