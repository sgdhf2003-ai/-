function QuantityParser_toHalfWidthNumberString_(val) {
  return val.toString().trim()
    .replace(/[\uff01-\uff5e]/g, function(c) {
      return String.fromCharCode(c.charCodeAt(0) - 65248);
    })
    .replace(/,/g, "");
}

function QuantityParser_parseNumberOrZero(val) {
  if (val == null || val === "") return 0;
  var str = QuantityParser_toHalfWidthNumberString_(val);
  var match = str.match(/-?\d+(?:\.\d+)?/);
  return match ? parseFloat(match[0]) : 0;
}

function QuantityParser_parseNumberOrNaN(val) {
  if (val == null || val === "") return NaN;
  var str = QuantityParser_toHalfWidthNumberString_(val);
  var match = str.match(/-?\d+(?:\.\d+)?/);
  return match ? parseFloat(match[0]) : NaN;
}
