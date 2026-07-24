/**
 * Simulation Test: Image OCR, Candidate Options & Micro Edit Popup (Pack 7A)
 */

const assert = require('assert');
const {
  OcrCandidateMatcher,
  ImageOcrAdapter,
  LiffMicroEditPopup
} = require('../../allocation-assistant/index');

let totalTests = 0;
let passedTests = 0;

function runTest(description, testFn) {
  totalTests++;
  try {
    testFn();
    passedTests++;
    console.log(`PASS allocation-assistant-ocr-liff: ${description}`);
  } catch (err) {
    console.error(`FAIL allocation-assistant-ocr-liff: ${description}`);
    console.error(`  Error: ${err.message}`);
    process.exitCode = 1;
  }
}

// 1. OCR Candidate Options Matcher
runTest('OcrCandidateMatcher outputs Top 3 candidate product options for fuzzy product text', () => {
  const masterProducts = ['EQA-6522', '顧佳 575', '艾美 336', '白玉大理石 30x60', '皇家灰 60x60'];
  const candidates = OcrCandidateMatcher.findTopCandidates('EQA 652', masterProducts, 3);

  assert.strictEqual(candidates.length, 3);
  assert.strictEqual(candidates[0].productCode, 'EQA-6522');
});

// 2. Image OCR Adapter with Candidate Options Assignment
runTest('ImageOcrAdapter parses order image text and attaches candidate options when confidence is ambiguous', () => {
  const adapter = new ImageOcrAdapter();
  const res = adapter.parseImageOrderPayload({
    rawText: '顧家 570 * 15 (辨識不清)',
    masterProducts: ['EQA-6522', '顧佳 575', '艾美 336', '皇家灰 60x60']
  });

  assert.strictEqual(res.success, true);
  assert.strictEqual(res.candidateOptions.length, 3);
  assert.strictEqual(res.candidateOptions[0].productCode, '顧佳 575');
});

// 3. LIFF Micro Edit Popup Features
runTest('LiffMicroEditPopup renders quick tags, parses voice override, checks anomalies, and inspects photo', () => {
  const popup = new LiffMicroEditPopup({
    productCode: '顧佳 575',
    requestedQuantity: 15,
    photoUrl: 'https://drive.google.com/file/d/test_photo_123/view'
  });

  // Render quick tags
  const tagsHtml = popup.renderQuickTags();
  assert.ok(tagsHtml.includes('10'));
  assert.ok(tagsHtml.includes('50'));
  assert.ok(tagsHtml.includes('500'));
  assert.ok(tagsHtml.includes('1000'));

  // Voice/Chat text override
  const qtyOverride = LiffMicroEditPopup.parseQuantityOverride('改 2000');
  assert.strictEqual(qtyOverride, 2000);

  // Quantity anomaly detection
  const anomaly = popup.validateQuantityAnomaly(6000, 100);
  assert.strictEqual(anomaly.hasAnomaly, true);
  assert.ok(anomaly.warningMessage.includes('5000') || anomaly.warningMessage.includes('100'));

  // Original photo inspection
  const photoHtml = popup.renderOriginalPhotoInspection();
  assert.ok(photoHtml.includes('查看原始單據照片核對'));
  assert.ok(photoHtml.includes('test_photo_123'));
});

console.log(`\nAllocation Assistant OCR & LIFF Simulation Summary: ${passedTests} / ${totalTests} PASS`);
if (passedTests !== totalTests) {
  process.exit(1);
}
