function InventoryRepository_readInventoryRows(ss) {
  if (!ss) return null;
  var sheet = ss.getSheetByName("庫存查詢表");
  if (!sheet) return null;
  return sheet.getDataRange().getValues();
}
