function CacheHelper_getScriptCache_() {
  return CacheService.getScriptCache();
}

function CacheHelper_addToCommaList(key, value, expirationSeconds) {
  if (!value || value === "N/A") return;
  var cache = CacheHelper_getScriptCache_();
  var listStr = cache.get(key) || "";
  var list = listStr ? listStr.split(",") : [];
  if (list.indexOf(value) === -1) {
    list.push(value);
    cache.put(key, list.join(","), expirationSeconds);
  }
}

function CacheHelper_removeFromCommaList(key, value, expirationSeconds) {
  if (!value || value === "N/A") return;
  var cache = CacheHelper_getScriptCache_();
  var listStr = cache.get(key) || "";
  if (!listStr) return;

  var list = listStr.split(",");
  var nextList = [];
  for (var i = 0; i < list.length; i++) {
    if (list[i] && list[i] !== value) {
      nextList.push(list[i]);
    }
  }

  if (nextList.length > 0) {
    cache.put(key, nextList.join(","), expirationSeconds);
  } else {
    cache.remove(key);
  }
}

function CacheHelper_put(key, value, expirationSeconds) {
  CacheHelper_getScriptCache_().put(key, value, expirationSeconds);
}

function CacheHelper_remove(key) {
  CacheHelper_getScriptCache_().remove(key);
}

function CacheHelper_get(key) {
  return CacheHelper_getScriptCache_().get(key);
}

function CacheHelper_getJsonProperty(key, fallbackValue) {
  try {
    var raw = PropertiesService.getScriptProperties().getProperty(key) || JSON.stringify(fallbackValue);
    var parsed = JSON.parse(raw);
    return Array.isArray(fallbackValue) && !Array.isArray(parsed) ? fallbackValue : parsed;
  } catch (err) {
    Logger.log("CacheHelper_getJsonProperty failed: " + err.toString());
    return fallbackValue;
  }
}

function CacheHelper_setJsonProperty(key, value) {
  try {
    PropertiesService.getScriptProperties().setProperty(key, JSON.stringify(value));
  } catch (err) {
    Logger.log("CacheHelper_setJsonProperty failed: " + err.toString());
  }
}
