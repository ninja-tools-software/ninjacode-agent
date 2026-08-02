import assert from "node:assert/strict";
import { run, sum } from "./app.js";
assert.equal(sum([1,2,3]), 6);
assert.equal(run([1,2,3]), 6);
