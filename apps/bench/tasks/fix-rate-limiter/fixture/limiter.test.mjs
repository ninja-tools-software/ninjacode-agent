import assert from "node:assert/strict";
import { createLimiter } from "./limiter.js";

function fakeClock(start = 0) {
  let t = start;
  return {
    now: () => t,
    advance: (ms) => {
      t += ms;
    },
  };
}

const clock = fakeClock();
const lim = createLimiter({ capacity: 2, refillPerSec: 1, clock: clock.now });

assert.equal(lim.allow(), true);
assert.equal(lim.allow(), true);
assert.equal(lim.allow(), false, "burst exhausted");

clock.advance(500);
assert.equal(lim.allow(), false, "only 0.5 tokens refilled");
clock.advance(500);
assert.equal(lim.allow(), true, "1.0 token refilled after 1s total");
assert.equal(lim.allow(), false);

clock.advance(5000);
assert.ok(lim.tokens() <= 2, "must not exceed capacity");
assert.equal(lim.allow(2), true, "full burst available after long wait");
assert.equal(lim.allow(), false);

const c2 = fakeClock();
const lim2 = createLimiter({ capacity: 1, refillPerSec: 2, clock: c2.now });
assert.equal(lim2.allow(), true);
assert.equal(lim2.allow(), false);
c2.advance(500); // 1 token
assert.equal(lim2.allow(), true);

console.log("ok");
