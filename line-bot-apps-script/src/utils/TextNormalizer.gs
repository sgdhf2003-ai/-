function TextNormalizer_normalizeSearchKey(str) {
  if (!str) return "";
  return str.toString().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, "");
}

function TextNormalizer_cleanLine(val) {
  if (val == null) return "";
  return val.toString().replace(/[\r\n]+/g, " ").trim();
}
