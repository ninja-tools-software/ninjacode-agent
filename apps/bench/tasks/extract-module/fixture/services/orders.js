function formatMoney(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatDate(iso) {
  return iso.slice(0, 10);
}

export function summarizeOrder(order) {
  return {
    id: order.id,
    total: formatMoney(order.totalCents),
    placedOn: formatDate(order.createdAt),
  };
}
