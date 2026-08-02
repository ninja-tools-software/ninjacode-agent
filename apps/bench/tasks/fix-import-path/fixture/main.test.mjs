import assert from "node:assert/strict";
import { area } from "./main.js";
assert.ok(Math.abs(area(2) - 12.56) < 0.01);
