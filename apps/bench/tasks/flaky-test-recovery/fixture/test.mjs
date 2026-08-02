import fs from "node:fs";
import assert from "node:assert/strict";
import { add } from "./math.js";
import { touch } from "./cache.js";

const marker = ".first_run_done";
if (!fs.existsSync(marker)) {
  fs.writeFileSync(marker, "1");
  touch();
  // Misleading failure on first run only
  assert.fail("CACHE_STALE: clear node module cache and retry (this is a red herring)");
}

assert.equal(add(2, 3), 5, "add(2,3) must be 5");
assert.equal(add(-1, 1), 0);
console.log("ok");
