import assert from "node:assert/strict";
import { deepMerge } from "./merge.js";

const a = deepMerge({ a: 1, nested: { x: 1, y: 2 } }, { nested: { y: 9, z: 3 } });
assert.deepEqual(a, { a: 1, nested: { x: 1, y: 9, z: 3 } });

const b = deepMerge({ items: [1, 2], flag: true }, { items: [3] });
assert.deepEqual(b, { items: [3], flag: true }, "arrays must be replaced, not concatenated");

const c = deepMerge({ a: 1, b: 2 }, { b: undefined, c: null });
assert.deepEqual(c, { a: 1, b: 2, c: null }, "undefined must not overwrite; null must");

const d = deepMerge(
  { cfg: { db: { host: "localhost", port: 5432 }, cache: true } },
  { cfg: { db: { port: 5433 } } },
);
assert.deepEqual(d, { cfg: { db: { host: "localhost", port: 5433 }, cache: true } });

const polluted = deepMerge({ safe: true }, JSON.parse('{"__proto__":{"hacked":true},"constructor":{"x":1}}'));
assert.equal(polluted.safe, true);
assert.equal(Object.prototype.hacked, undefined, "must not pollute Object.prototype");
assert.equal(polluted.hacked, undefined);
assert.equal(Object.hasOwn(polluted, "constructor"), false);

const when = new Date("2024-01-01T00:00:00.000Z");
const e = deepMerge({ when, tag: /abc/i }, { when: new Date("2025-06-15T12:00:00.000Z"), tag: /xyz/ });
assert.equal(e.when instanceof Date, true);
assert.equal(e.when.toISOString(), "2025-06-15T12:00:00.000Z");
assert.equal(e.tag instanceof RegExp, true);
assert.equal(e.tag.source, "xyz");

console.log("ok");
