function DateHelper_startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function DateHelper_parseDate(value) {
  if (!value) return null;
  if (Object.prototype.toString.call(value) === "[object Date]" && !isNaN(value.getTime())) {
    return DateHelper_startOfDay(value);
  }
  var date = new Date(String(value));
  if (isNaN(date.getTime())) return null;
  return DateHelper_startOfDay(date);
}

function DateHelper_formatDate(value, timezone, format, emptyText) {
  var date = DateHelper_parseDate(value);
  if (!date) return emptyText;
  return Utilities.formatDate(date, timezone, format);
}

function DateHelper_addDays(date, days) {
  var next = new Date(date.getTime());
  next.setDate(next.getDate() + days);
  return DateHelper_startOfDay(next);
}

function DateHelper_addMonths(date, months) {
  var next = new Date(date.getTime());
  next.setMonth(next.getMonth() + months);
  return DateHelper_startOfDay(next);
}
