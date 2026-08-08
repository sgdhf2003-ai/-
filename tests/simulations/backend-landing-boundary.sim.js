/**
 * Backend Service Landing Page & Boundary Hardening Simulation Suite
 *
 * Verifies that direct browser entrance (/exec) serves a self-contained, un-broken
 * Backend Service Landing Page pointing to https://brown-phi.vercel.app/, while preserving
 * all API action routes, doPost routing, and fail-closed security guards.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { assert, runSuite } = require("./helpers");

const repoRoot = path.join(__dirname, "../..");
const codeGsPath = path.join(repoRoot, "google-apps-script/Code.gs");
const landingHtmlPath = path.join(repoRoot, "google-apps-script/BackendLandingView.html");

runSuite("backend-landing-boundary", [
  {
    name: "BackendLandingView.html exists and is self-contained without relative CSS/JS assets",
    run() {
      assert(fs.existsSync(landingHtmlPath), "BackendLandingView.html must exist");
      const htmlContent = fs.readFileSync(landingHtmlPath, "utf8");

      assert(htmlContent.includes("勁揚業務管家 Backend Service"), "Contains correct landing page title");
      assert(htmlContent.includes("https://brown-phi.vercel.app/"), "Contains link to main Vercel App");
      assert(htmlContent.includes("開啟勁揚業務管家 App"), "Contains button text");
      assert(!htmlContent.includes('href="styles.css"'), "Does not depend on relative styles.css");
      assert(!htmlContent.includes('src="app.js"'), "Does not depend on relative app.js");
    }
  },
  {
    name: "google-apps-script/Code.gs doGet serves BackendLandingView for direct browser access",
    run() {
      const codeGsContent = fs.readFileSync(codeGsPath, "utf8");

      assert(codeGsContent.includes('function doGet('), "Code.gs contains doGet entrypoint");
      assert(
        codeGsContent.includes('HtmlService.createTemplateFromFile("BackendLandingView")'),
        "doGet loads BackendLandingView on direct browser access"
      );
      assert(
        codeGsContent.includes('HtmlService.createTemplateFromFile("AllocationAssistantView")'),
        "doGet preserves sandbox view route for ?page=allocation-view"
      );
    }
  },
  {
    name: "Code.gs preserves doPost API route handlers and fail-closed guards",
    run() {
      const codeGsContent = fs.readFileSync(codeGsPath, "utf8");

      assert(codeGsContent.includes('function doPost('), "Code.gs contains doPost handler");
      assert(codeGsContent.includes('if (action === "fulfillHold")'), "doPost handles fulfillHold action");
      assert(codeGsContent.includes('if (action === "cancelReleaseHold")'), "doPost handles cancelReleaseHold action");
      assert(codeGsContent.includes('if (action === "readbackAudit")'), "doPost handles readbackAudit action");
      assert(codeGsContent.includes('UNAUTHORIZED_ROLE'), "Preserves fail-closed role authorization guard");
    }
  }
]);
