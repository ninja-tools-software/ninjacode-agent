import assert from "node:assert/strict";
import { pad } from "./format.js";
assert.equal(pad(7), "07");
assert.equal(pad(12), "12");
