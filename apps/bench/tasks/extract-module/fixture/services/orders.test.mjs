import assert from "node:assert/strict";
import { summarizeOrder } from "./orders.js";

const s = summarizeOrder({ id: "o1", totalCents: 1250, createdAt: "2024-06-15T12:00:00Z" });
assert.deepEqual(s, { id: "o1", total: "$12.50", placedOn: "2024-06-15" });
console.log("ok");
