function formatMoney(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatDate(iso) {
  return iso.slice(0, 10);
}

export function summarizeInvoice(invoice) {
  return {
    number: invoice.number,
    amount: formatMoney(invoice.amountCents),
    due: formatDate(invoice.dueAt),
  };
}
