import assert from "node:assert/strict";
import { summarizeInvoice } from "./invoices.js";

const s = summarizeInvoice({ number: "INV-9", amountCents: 99, dueAt: "2024-07-01T00:00:00Z" });
assert.deepEqual(s, { number: "INV-9", amount: "$0.99", due: "2024-07-01" });
console.log("ok");
