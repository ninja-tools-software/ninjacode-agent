import assert from "node:assert/strict";
import { orderLabel } from "./order.js";

assert.equal(orderLabel({ sku: "abc" }), "[ABC]");
console.log("ok");
