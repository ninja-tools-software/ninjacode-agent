function formatMoney(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatDate(iso) {
  return iso.slice(0, 10);
}

export function dailyLine(row) {
  return `${formatDate(row.day)}: ${formatMoney(row.cents)}`;
}
