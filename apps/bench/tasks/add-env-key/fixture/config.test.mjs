import assert from "node:assert/strict";
import { config } from "./config.js";
assert.equal(config.host, "127.0.0.1");
assert.equal(config.port, 3000);
