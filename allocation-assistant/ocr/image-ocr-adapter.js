/**
 * Image OCR Adapter (Pack 7A)
 * Parses image order raw text, extracts product code & quantity, and attaches candidate options.
 */

const { OcrCandidateMatcher } = require('./ocr-candidate-matcher');

class ImageOcrAdapter {
  constructor(options = {}) {
    this.defaultMasterProducts = options.defaultMasterProducts || [
      'EQA-6522',
      '顧佳 575',
      '艾美 336',
      '白玉大理石 30x60',
      '皇家灰 60x60'
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

    // Basic regex extraction for Product * Qty
    const match = textToParse.match(/([^\*\s]+)\s*\*?\s*(\d+)?/);
    if (match) {
      productCode = match[1].trim();
      requestedQuantity = match[2] ? parseInt(match[2], 10) : 10;
    } else {
      productCode = textToParse || 'UNKNOWN_ITEM';
      requestedQuantity = 10;
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
