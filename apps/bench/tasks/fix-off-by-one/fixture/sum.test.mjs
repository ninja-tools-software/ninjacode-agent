import { sum } from "./sum.js";
import assert from "node:assert";

assert.equal(sum(2, 3), 5);
assert.equal(sum(-1, 1), 0);
assert.equal(sum(0, 0), 0);
console.log("ok");
