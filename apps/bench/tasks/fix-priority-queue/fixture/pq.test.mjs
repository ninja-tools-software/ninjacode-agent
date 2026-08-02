import assert from "node:assert/strict";
import { PriorityQueue } from "./pq.js";

const q = new PriorityQueue();
assert.equal(q.size(), 0);
assert.equal(q.peek(), undefined);

q.push("low", 10);
q.push("high", 1);
q.push("mid", 5);
assert.equal(q.size(), 3);
assert.equal(q.peek().value, "high");
assert.equal(q.pop(), "high");
assert.equal(q.pop(), "mid");
assert.equal(q.pop(), "low");
assert.equal(q.pop(), undefined);

const q2 = new PriorityQueue([
  ["a", 3],
  ["b", 1],
  ["c", 2],
  ["d", 1],
]);
const out = [q2.pop(), q2.pop(), q2.pop(), q2.pop()];
assert.deepEqual(out.slice(0, 2).sort(), ["b", "d"]);
assert.equal(out[2], "c");
assert.equal(out[3], "a");

const q3 = new PriorityQueue();
q3.push("x", 5);
q3.push("y", 4);
q3.push("z", 3);
q3.decreasePriority("x", 1);
assert.equal(q3.pop(), "x");
assert.equal(q3.pop(), "z");
assert.equal(q3.pop(), "y");

console.log("ok");
