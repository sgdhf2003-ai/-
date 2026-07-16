function InventoryRepository_readInventoryRows(ss) {
  if (!ss) return null;
  var sheet = ss.getSheetByName("庫存查詢表");
  if (!sheet) return null;
  return sheet.getDataRange().getValues();
}

/**
 * Parses the series key for a given product model.
 * Rule: Letter prefix + first 3 digits of 4-digit number, first 4 digits of 5-digit number, etc.
 * Ignoring suffixes like F1, F2, M, P, etc.
 */
function InventoryRepository_parseSeriesKey_(model) {
  if (!model) return null;
  var str = model.toString().trim();
  if (str === "") return null;

  // Get everything before first space (ignore colors/names)
  var code = str.split(" ")[0].toUpperCase();

  // Extract alphabet prefix and numeric part
  var match = code.match(/^([A-Z]+)-?([0-9]+)(.*)$/);
  if (!match) return null;

  var prefix = match[1];
  var digits = match[2];

  if (digits.length === 4) {
    return prefix + "-" + digits.substring(0, 3);
  } else if (digits.length >= 5) {
    return prefix + "-" + digits.substring(0, 4);
  } else if (digits.length === 3) {
    return prefix + "-" + digits.substring(0, 2);
  } else {
    return prefix + "-" + digits;
  }
}

/**
 * Extracts the suffix of a model code (e.g. F1, F2, M, P).
 */
function InventoryRepository_getModelSuffix_(model) {
  if (!model) return "";
  var str = model.toString().trim();
  var code = str.split(" ")[0].toUpperCase();
  var match = code.match(/^([A-Z]+)-?([0-9]+)(.*)$/);
  if (match && match[3]) {
    return match[3].trim();
  }
  return "";
}

/**
 * Extracts the variant number of a model code (e.g. the digit(s) after the series key prefix).
 */
function InventoryRepository_getModelVariantNumber_(model, seriesKey) {
  if (!model) return null;
  var str = model.toString().trim();
  var code = str.split(" ")[0].toUpperCase();

  var match = code.match(/^([A-Z]+)-?([0-9]+)/);
  if (!match) return null;

  var fullDigits = match[2];
  if (!seriesKey) {
    seriesKey = InventoryRepository_parseSeriesKey_(model);
  }
  if (!seriesKey) return null;

  var keyMatch = seriesKey.match(/-([0-9]+)$/);
  if (!keyMatch) return null;

  var keyDigits = keyMatch[1];
  if (fullDigits.indexOf(keyDigits) === 0) {
    var remaining = fullDigits.substring(keyDigits.length);
    var val = parseInt(remaining, 10);
    return isNaN(val) ? null : val;
  }

  return null;
}

/**
 * Parses product dimension string (e.g. 17.5X20, 60x60) into cm values.
 */
function InventoryRepository_parseDimension_(value) {
  if (!value) return null;
  var str = value.toString().toLowerCase().replace(/\s+/g, "").replace(/\*/g, "x").replace(/×/g, "x");

  var match = str.match(/([0-9.]+)\s*x\s*([0-9.]+)/);
  var val1 = 0;
  var val2 = 0;

  if (match) {
    val1 = parseFloat(match[1]);
    val2 = parseFloat(match[2]);
  } else {
    var nums = str.match(/[0-9.]+/g);
    if (nums && nums.length === 1) {
      val1 = parseFloat(nums[0]);
      val2 = val1;
    }
  }

  if (isNaN(val1) || isNaN(val2) || val1 <= 0 || val2 <= 0) return null;

  // Standardize mm to cm if the values are large (e.g. 600x600 -> 60x60)
  if (Math.max(val1, val2) >= 150) {
    val1 /= 10;
    val2 /= 10;
  }

  var shortSide = Math.min(val1, val2);
  var longSide = Math.max(val1, val2);

  return {
    shortSide: shortSide,
    longSide: longSide,
    area: shortSide * longSide,
    ratio: shortSide > 0 ? (longSide / shortSide) : 1
  };
}

/**
 * Compares two size dimensions and categorizes their match.
 */
function InventoryRepository_compareDimensions_(querySize, candidateSize) {
  var qDim = InventoryRepository_parseDimension_(querySize);
  var cDim = InventoryRepository_parseDimension_(candidateSize);

  if (!qDim || !cDim) return "unknown";

  // Exact match
  if (qDim.shortSide === cDim.shortSide && qDim.longSide === cDim.longSide) {
    return "exact";
  }

  var wDiff = Math.abs(qDim.longSide - cDim.longSide) / qDim.longSide;
  var hDiff = Math.abs(qDim.shortSide - cDim.shortSide) / qDim.shortSide;
  var areaDiff = Math.abs(qDim.area - cDim.area) / qDim.area;

  // Near match: <= 10% diff per side, <= 20% diff in area
  if (wDiff <= 0.10 && hDiff <= 0.10 && areaDiff <= 0.20) {
    return "near";
  }

  // Acceptable match: <= 20% diff per side
  if (wDiff <= 0.20 && hDiff <= 0.20) {
    return "acceptable";
  }

  return "incompatible";
}

/**
 * Verifies if a product should be excluded from recommendations.
 */
function InventoryRepository_isSubstituteExcluded_(model, info, queryModel, exclusions) {
  if (!model || !queryModel || !info) return true;

  var normModel = model.toString().trim();
  var normQuery = queryModel.toString().trim();

  if (normModel === normQuery) return true;
  if (info.stock <= 0) return true;

  var seriesKey = InventoryRepository_parseSeriesKey_(model);
  if (!seriesKey) return true;

  var name = (info.model || "").toString();
  var seriesName = (info.series_name || "").toString();
  var note = (info.note || "").toString();

  // 1. Exclude swimming pool products
  if (model.indexOf("KK-") !== -1 || seriesName.indexOf("泳池") !== -1 || note.indexOf("泳池") !== -1 || name.indexOf("泳池") !== -1) {
    return true;
  }

  // 2. Exclude chemical grouts / auxiliaries
  var auxKeywords = ["填縫", "防水", "黏著", "藥劑", "填縫劑", "防霉"];
  for (var i = 0; i < auxKeywords.length; i++) {
    var kw = auxKeywords[i];
    if (name.indexOf(kw) !== -1 || seriesName.indexOf(kw) !== -1 || note.indexOf(kw) !== -1) {
      return true;
    }
  }

  // 3. Exclude special accessories
  var accKeywords = ["樓梯", "一體樓梯", "收邊", "踢腳", "轉角", "配件"];
  for (var i = 0; i < accKeywords.length; i++) {
    var kw = accKeywords[i];
    if (name.indexOf(kw) !== -1 || seriesName.indexOf(kw) !== -1 || note.indexOf(kw) !== -1) {
      return true;
    }
  }

  // 4. Manual exclusions check
  if (exclusions && exclusions[normModel]) {
    var exc = exclusions[normModel];
    if (exc.recommendable === false || exc.exclude_reason) {
      return true;
    }
  }

  return false;
}

/**
 * Searches and returns up to 3 same-series substitute candidates.
 */
function InventoryRepository_findSameSeriesSubstitutes(queryProduct, inventoryRows, options) {
  options = options || {};
  var maxResults = options.maxResults || 3;
  var exclusions = options.exclusions || {}; // model -> { recommendable: bool, exclude_reason: str, human_color: str, human_texture: str }

  var queryModel = typeof queryProduct === "string" ? queryProduct : queryProduct.model;
  if (!queryModel) return { candidates: [], seriesKey: null, seriesTotal: 0, seriesInStock: 0, seriesOutOfStock: 0, safeCandidateCount: 0 };

  queryModel = queryModel.toString().trim();
  var qSeriesKey = InventoryRepository_parseSeriesKey_(queryModel);
  if (!qSeriesKey) return { candidates: [], seriesKey: null, seriesTotal: 0, seriesInStock: 0, seriesOutOfStock: 0, safeCandidateCount: 0 };

  var headers = inventoryRows[0];
  var colMap = {};
  for (var i = 0; i < headers.length; i++) {
    colMap[headers[i]] = i;
  }

  // Aggregate inventory rows by '編號' (model)
  var grouped = {};
  for (var r = 1; r < inventoryRows.length; r++) {
    var model = inventoryRows[r][colMap['編號']];
    if (!model) continue;
    model = model.toString().trim();

    var series = inventoryRows[r][colMap['系列']] || "";
    var size = inventoryRows[r][colMap['尺寸']] || "";
    var note = inventoryRows[r][colMap['備註']] || "";
    var stock = parseInt(inventoryRows[r][colMap['可用庫存']], 10) || 0;

    if (!grouped[model]) {
      grouped[model] = {
        model: model,
        series_name: series,
        size: size,
        note: note,
        stock: 0
      };
    }
    grouped[model].stock += stock;
  }

  var qInfo = grouped[queryModel];
  if (!qInfo) {
    // If query product not found in inventory, try to look up options/metadata or create a mock
    qInfo = {
      model: queryModel,
      series_name: typeof queryProduct === "object" ? (queryProduct.series || "") : "",
      size: typeof queryProduct === "object" ? (queryProduct.size || "") : "",
      note: "",
      stock: 0
    };
  }

  var qDim = InventoryRepository_parseDimension_(qInfo.size);
  var qVariant = InventoryRepository_getModelVariantNumber_(queryModel, qSeriesKey);
  var qSuffix = InventoryRepository_getModelSuffix_(queryModel);

  var candidates = [];
  var seriesTotal = 0;
  var seriesInStock = 0;
  var seriesOutOfStock = 0;

  for (var model in grouped) {
    var info = grouped[model];
    var cSeriesKey = InventoryRepository_parseSeriesKey_(model);

    if (cSeriesKey === qSeriesKey) {
      seriesTotal++;
      if (model !== queryModel) {
        if (info.stock > 0) {
          seriesInStock++;
        } else {
          seriesOutOfStock++;
        }
      } else {
        if (info.stock <= 0) {
          seriesOutOfStock++;
        } else {
          seriesInStock++;
        }
      }

      // Exclude check
      if (InventoryRepository_isSubstituteExcluded_(model, info, queryModel, exclusions)) {
        continue;
      }

      // Dimension match check
      var dimMatch = InventoryRepository_compareDimensions_(qInfo.size, info.size);
      if (dimMatch !== "exact" && dimMatch !== "near") {
        continue;
      }

      // Scoring candidates
      var score = 0;
      var reason = "";

      if (dimMatch === "exact") {
        score += 50;
        reason = "同系列、同尺寸";
      } else {
        score += 35;
        reason = "同系列、近尺寸";
      }

      // Model number distance scoring
      var cVariant = InventoryRepository_getModelVariantNumber_(model, qSeriesKey);
      var modelDist = 999;
      if (qVariant !== null && cVariant !== null) {
        modelDist = Math.abs(qVariant - cVariant);
        if (modelDist <= 1) {
          score += 15;
        } else if (modelDist <= 3) {
          score += 10;
        } else if (modelDist <= 5) {
          score += 5;
        }
      }

      // Suffix match bonus
      var cSuffix = InventoryRepository_getModelSuffix_(model);
      var suffixMatch = false;
      if (qSuffix !== "" && cSuffix !== "" && qSuffix === cSuffix) {
        score += 5;
        suffixMatch = true;
      }

      // Manual tag metadata bonus
      var qExc = exclusions[queryModel];
      var cExc = exclusions[model];
      if (qExc && cExc) {
        if (qExc.human_color && cExc.human_color && qExc.human_color === cExc.human_color) {
          score += 10;
        }
        if (qExc.human_texture && cExc.human_texture && qExc.human_texture === cExc.human_texture) {
          score += 8;
        }
      }

      candidates.push({
        model: model,
        productName: model.split(" ").slice(1).join(" ") || "",
        stock: info.stock,
        size: info.size,
        seriesKey: qSeriesKey,
        dimensionMatch: dimMatch,
        modelDistance: modelDist,
        score: score,
        reason: reason
      });
    }
  }

  var safeCandidateCount = candidates.length;

  // Sort candidates:
  // 1. score descending
  // 2. stock quantity descending
  // 3. model alphabetical order (deterministic tie-breaker)
  candidates.sort(function(a, b) {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    if (b.stock !== a.stock) {
      return b.stock - a.stock;
    }
    return a.model.localeCompare(b.model);
  });

  return {
    candidates: candidates.slice(0, maxResults),
    seriesKey: qSeriesKey,
    seriesTotal: seriesTotal,
    seriesInStock: seriesInStock,
    seriesOutOfStock: seriesOutOfStock,
    safeCandidateCount: safeCandidateCount
  };
}
