import assert from "node:assert/strict";
import { dailyLine } from "./report.js";

assert.equal(dailyLine({ day: "2024-01-02T08:00:00Z", cents: 500 }), "2024-01-02: $5.00");
console.log("ok");
