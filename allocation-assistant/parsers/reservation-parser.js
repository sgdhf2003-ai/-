/**
 * ReservationParser - Pure Parser and Validation Module for LINE Reservation Text
 * 
 * Safety Rules:
 * - Pure parsing & validation ONLY.
 * - No Google Sheet writes, no hold creation, no LINE push notifications.
 * - Ignore forged lineUserId, salesOwner ID, or role/permission fields in input text.
 */

class ReservationParser {
  constructor(options = {}) {
    this.inventoryCatalog = options.inventoryCatalog || null;
  }

  parseReservationText(text) {
    if (!text || typeof text !== "string") {
      return {
        ok: false,
        errorCode: "EMPTY_INPUT",
        errorMessage: "輸入文字不可為空",
        warnings: []
      };
    }

    const trimmed = text.trim();
    let customerName = "";
    let productCode = "";
    let quantity = null;
    let salesOwnerName = "";

    // 1. Try Key-Value Format: 店家：美麗空間 品項：STU-6101 數量：1 負責業務：豪
    const kvStoreMatch = trimmed.match(/(?:店家|客戶|門市)[：:\s]*([^\s：:\n]+)/);
    const kvItemMatch = trimmed.match(/(?:品項|型號|商品)[：:\s]*([^\s：:\n]+)/);
    const kvQtyMatch = trimmed.match(/(?:數量|個數|張數)[：:\s]*(\d+)/);
    const kvOwnerMatch = trimmed.match(/(?:負責業務|業務|負責人|填單人)[：:\s]*([^\s：:\n]+)/);

    if (kvStoreMatch || kvItemMatch || kvQtyMatch || kvOwnerMatch) {
      if (kvStoreMatch) customerName = kvStoreMatch[1].trim();
      if (kvItemMatch) productCode = kvItemMatch[1].trim();
      if (kvQtyMatch) quantity = parseInt(kvQtyMatch[1], 10);
      if (kvOwnerMatch) salesOwnerName = kvOwnerMatch[1].trim();
    } else {
      // 2. Try Free-Text Tokenized Format: 美麗空間 STU-6101 1個 豪
      // Clean security forgery keywords first
      const tokens = trimmed
        .split(/[\s\u3000]+/)
        .filter(t => !/^(lineUserId|role|salesOwnerId|sessionToken|password):/i.test(t));

      // Strategy: Token matching
      // Product code token pattern: e.g. STU-6101, ABC-1001 (contains uppercase letters and hyphen or numbers)
      // Quantity token pattern: e.g. 1個, 10, 5PCS
      tokens.forEach((token) => {
        const qtyTokenMatch = token.match(/^(\d+)(?:個|pcs|張|箱|包)?$/i);
        const codeTokenMatch = token.match(/^[A-Z0-9]{2,10}-[A-Z0-9]{2,10}$/i);

        if (qtyTokenMatch && quantity === null) {
          quantity = parseInt(qtyTokenMatch[1], 10);
        } else if (codeTokenMatch && !productCode) {
          productCode = codeTokenMatch[0].toUpperCase();
        } else if (!customerName) {
          customerName = token;
        } else if (!salesOwnerName) {
          salesOwnerName = token;
        }
      });
    }

    // 3. Validation Rules
    if (!customerName) {
      return {
        ok: false,
        errorCode: "MISSING_CUSTOMER_NAME",
        errorMessage: "未擷取到客戶/店家名稱",
        warnings: []
      };
    }

    if (!productCode) {
      return {
        ok: false,
        errorCode: "MISSING_PRODUCT_CODE",
        errorMessage: "未擷取到商品型號",
        warnings: []
      };
    }

    if (quantity === null || isNaN(quantity) || quantity <= 0) {
      return {
        ok: false,
        errorCode: "INVALID_QUANTITY",
        errorMessage: "數量必須為正整數",
        warnings: []
      };
    }

    // 4. Server-Side Catalog & Available Stock Validation
    if (this.inventoryCatalog === null || typeof this.inventoryCatalog === "undefined") {
      return {
        ok: false,
        errorCode: "INVENTORY_CATALOG_UNAVAILABLE",
        errorMessage: "目前無法取得正式庫存資料，暫停建立保留草稿",
        warnings: []
      };
    }

    if (Array.isArray(this.inventoryCatalog)) {
      const matchedProduct = this.inventoryCatalog.find(
        p => p.item === productCode || p.productCode === productCode
      );

      if (!matchedProduct) {
        return {
          ok: false,
          errorCode: "PRODUCT_NOT_FOUND",
          errorMessage: `庫存目錄中查無此商品型號 (${productCode})`,
          warnings: []
        };
      }

      if (typeof matchedProduct.availableQuantity === "number" && quantity > matchedProduct.availableQuantity) {
        return {
          ok: false,
          errorCode: "INSUFFICIENT_STOCK",
          errorMessage: `可用庫存不足 (需求: ${quantity}, 可用庫存: ${matchedProduct.availableQuantity})`,
          warnings: []
        };
      }
    } else if (this.inventoryCatalog && typeof this.inventoryCatalog === "object") {
      const itemKey = productCode.toUpperCase();
      const catVal = this.inventoryCatalog[itemKey] !== undefined ? this.inventoryCatalog[itemKey] : this.inventoryCatalog[productCode];
      if (catVal === undefined) {
        return {
          ok: false,
          errorCode: "PRODUCT_NOT_FOUND",
          errorMessage: `庫存目錄中查無此商品型號 (${productCode})`,
          warnings: []
        };
      }
      const availQty = typeof catVal === "number" ? catVal : (typeof catVal === "object" && typeof catVal.availableQuantity === "number" ? catVal.availableQuantity : null);
      if (availQty !== null && quantity > availQty) {
        return {
          ok: false,
          errorCode: "INSUFFICIENT_STOCK",
          errorMessage: `可用庫存不足 (需求: ${quantity}, 可用庫存: ${availQty})`,
          warnings: []
        };
      }
    }

    // 5. Fixed Output Draft Contract (Strict Isolation from Forged Fields)
    return {
      ok: true,
      customerName: customerName,
      productCode: productCode,
      quantity: quantity,
      salesOwnerName: salesOwnerName || "無",
      confidence: 1,
      warnings: []
    };
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { ReservationParser };
}
