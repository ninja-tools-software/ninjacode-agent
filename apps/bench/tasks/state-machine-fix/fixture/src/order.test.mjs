import assert from "node:assert/strict";
import { createOrder, apply } from "./order.js";

const o = createOrder();
apply(o, "submitted");
apply(o, "paid");
apply(o, "shipped");
apply(o, "delivered");
assert.deepEqual(o.history, ["draft", "submitted", "paid", "shipped", "delivered"]);

const bad = createOrder();
assert.throws(() => apply(bad, "paid"), /illegal/);
assert.throws(() => apply(bad, "delivered"), /illegal/);

const c = createOrder();
apply(c, "submitted");
apply(c, "cancelled");
assert.throws(() => apply(c, "paid"), /illegal/);

console.log("ok");
