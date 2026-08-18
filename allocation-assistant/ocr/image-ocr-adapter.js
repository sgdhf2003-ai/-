/**
 * Image OCR Adapter (Pack 7A)
 * Parses image order raw text, extracts product code & quantity, and attaches candidate options.
 */

const { OcrCandidateMatcher } = require('./ocr-candidate-matcher');

class ImageOcrAdapter {
  constructor(options = {}) {
    this.defaultMasterProducts = options.defaultMasterProducts || [
      'APT-5201',
      'STU-6101',
      'SHN-6101F',
      'WOS-1253',
      'STF-6103'
    ];
  }

  parseImageOrderPayload({ imageBlob = null, rawText = '', masterProducts = null }) {
    const textToParse = String(rawText || '').trim();
    const productsList = masterProducts || this.defaultMasterProducts;

    let productCode = '';
    let requestedQuantity = 0;
    let confidenceScore = 1.0;

    if (textToParse.includes('辨識不清') || textToParse.includes('模糊')) {
      confidenceScore = 0.6;
    }

    // Enhanced regex extraction for [CustomerName] [ProductCode] * Qty or ProductCode * Qty
    const match = textToParse.match(/^(?:([^\s]+)\s+)?([A-Za-z0-9-]+)\s*\*?\s*(\d+)?/);
    if (match && match[2]) {
      productCode = match[2].trim();
      requestedQuantity = match[3] ? parseInt(match[3], 10) : 10;
    } else {
      const simpleMatch = textToParse.match(/([^\*\s]+)\s*\*?\s*(\d+)?/);
      if (simpleMatch) {
        productCode = simpleMatch[1].trim();
        requestedQuantity = simpleMatch[2] ? parseInt(simpleMatch[2], 10) : 10;
      } else {
        productCode = textToParse || 'UNKNOWN_ITEM';
        requestedQuantity = 10;
      }
    }

    const candidateOptions = OcrCandidateMatcher.findTopCandidates(productCode, productsList, 3);

    return {
      success: true,
      productCode,
      requestedQuantity,
      confidenceScore,
      candidateOptions,
      rawText: textToParse
    };
  }
}

module.exports = {
  ImageOcrAdapter
};
