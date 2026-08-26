/**
 * ReservationParser - Pure Parser and Validation Module for LINE Reservation Text (Apps Script Production Version)
 * 
 * Safety Rules:
 * - Pure parsing & validation ONLY.
 * - No Google Sheet writes, no hold creation, no LINE push notifications.
 * - Ignore forged lineUserId, salesOwner ID, or role/permission fields in input text.
 */

function parseReservationText(text, inventoryCatalog) {
  if (!text || typeof text !== "string") {
    return {
      ok: false,
      errorCode: "EMPTY_INPUT",
      errorMessage: "輸入文字不可為空",
      warnings: []
    };
  }

  var trimmed = text.trim();
  var customerName = "";
  var productCode = "";
  var quantity = null;
  var salesOwnerName = "";

  // 1. Try Key-Value Format: 店家：美麗空間 品項：STU-6101 數量：1 負責業務：豪
  var kvStoreMatch = trimmed.match(/(?:店家|客戶|門市)[：:\s]*([^\s：:\n]+)/);
  var kvItemMatch = trimmed.match(/(?:品項|型號|商品)[：:\s]*([^\s：:\n]+)/);
  var kvQtyMatch = trimmed.match(/(?:數量|個數|張數)[：:\s]*(\d+)/);
  var kvOwnerMatch = trimmed.match(/(?:負責業務|業務|負責人|填單人)[：:\s]*([^\s：:\n]+)/);

  if (kvStoreMatch || kvItemMatch || kvQtyMatch || kvOwnerMatch) {
    if (kvStoreMatch) customerName = kvStoreMatch[1].trim();
    if (kvItemMatch) productCode = kvItemMatch[1].trim();
    if (kvQtyMatch) quantity = parseInt(kvQtyMatch[1], 10);
    if (kvOwnerMatch) salesOwnerName = kvOwnerMatch[1].trim();
  } else {
    // 2. Try Free-Text Tokenized Format: 美麗空間 STU-6101 1個 豪
    var tokens = trimmed
      .split(/[\s\u3000]+/)
      .filter(function(t) { return !/^(lineUserId|role|salesOwnerId|sessionToken|password):/i.test(t); });

    tokens.forEach(function(token) {
      var qtyTokenMatch = token.match(/^(\d+)(?:個|pcs|張|箱|包)?$/i);
      var codeTokenMatch = token.match(/^[A-Z0-9]{2,10}-[A-Z0-9]{2,10}$/i);

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
  if (inventoryCatalog === null || typeof inventoryCatalog === "undefined") {
    return {
      ok: false,
      errorCode: "INVENTORY_CATALOG_UNAVAILABLE",
      errorMessage: "目前無法取得正式庫存資料，暫停建立保留草稿",
      warnings: []
    };
  }

  if (Array.isArray(inventoryCatalog)) {
    var matchedProduct = inventoryCatalog.find(function(p) {
      return p.item === productCode || p.productCode === productCode;
    });

    if (!matchedProduct) {
      return {
        ok: false,
        errorCode: "PRODUCT_NOT_FOUND",
        errorMessage: "庫存目錄中查無此商品型號 (" + productCode + ")",
        warnings: []
      };
    }

    if (typeof matchedProduct.availableQuantity === "number" && quantity > matchedProduct.availableQuantity) {
      return {
        ok: false,
        errorCode: "INSUFFICIENT_STOCK",
        errorMessage: "可用庫存不足 (需求: " + quantity + ", 可用庫存: " + matchedProduct.availableQuantity + ")",
        warnings: []
      };
    }
  } else if (inventoryCatalog && typeof inventoryCatalog === "object") {
    var itemKey = productCode.toUpperCase();
    var catVal = inventoryCatalog[itemKey] !== undefined ? inventoryCatalog[itemKey] : inventoryCatalog[productCode];
    if (catVal === undefined) {
      return {
        ok: false,
        errorCode: "PRODUCT_NOT_FOUND",
        errorMessage: "庫存目錄中查無此商品型號 (" + productCode + ")",
        warnings: []
      };
    }
    var availQty = typeof catVal === "number" ? catVal : (typeof catVal === "object" && typeof catVal.availableQuantity === "number" ? catVal.availableQuantity : null);
    if (availQty !== null && quantity > availQty) {
      return {
        ok: false,
        errorCode: "INSUFFICIENT_STOCK",
        errorMessage: "可用庫存不足 (需求: " + quantity + ", 可用庫存: " + availQty + ")",
        warnings: []
      };
    }
  }

  // 5. Fixed Output Draft Contract
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
