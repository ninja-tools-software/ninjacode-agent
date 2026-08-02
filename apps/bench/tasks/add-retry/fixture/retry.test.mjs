import assert from "node:assert/strict";
import { withRetry } from "./retry.js";

let calls = 0;
const okOnThird = async () => {
  calls += 1;
  if (calls < 3) throw new Error(`transient fail ${calls}`);
  return "ok";
};

const result = await withRetry(okOnThird, { retries: 2, delayMs: 1 });
assert.equal(result, "ok");
assert.equal(calls, 3);

let fails = 0;
await assert.rejects(
  () =>
    withRetry(async () => {
      fails += 1;
      throw new Error("transient always");
    }, { retries: 2, delayMs: 1 }),
  /transient always/,
);
assert.equal(fails, 3);

let once = 0;
const immediate = await withRetry(async () => {
  once += 1;
  return 42;
}, { retries: 5, delayMs: 1 });
assert.equal(immediate, 42);
assert.equal(once, 1);

let fatalCalls = 0;
await assert.rejects(
  () =>
    withRetry(async () => {
      fatalCalls += 1;
      throw new Error("fatal boom");
    }, { retries: 5, delayMs: 1 }),
  /fatal boom/,
);
assert.equal(fatalCalls, 1, "non-transient errors must not be retried");

console.log("ok");
