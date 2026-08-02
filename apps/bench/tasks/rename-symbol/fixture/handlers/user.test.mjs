import assert from "node:assert/strict";
import { userLabel } from "./user.js";

assert.equal(userLabel({ name: "alice" }), "[ALICE]");
console.log("ok");
