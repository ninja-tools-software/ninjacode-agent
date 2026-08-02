import assert from "node:assert/strict";
import { greet } from "./greet.js";
assert.equal(greet("Ada"), "Hello, Ada!");
