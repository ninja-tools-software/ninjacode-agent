import assert from "node:assert/strict";
import { upsertUser, getUser, deleteUser } from "./service.js";
import { _reset } from "./store.js";

_reset();
upsertUser(1, "alice");
assert.equal(getUser(1).name, "alice");
assert.equal(getUser(1).version, 1);

upsertUser(1, "bob");
const after = getUser(1);
assert.equal(after.name, "bob", "getUser must return the updated name, not a stale cache entry");
assert.equal(after.version, 2, "version must bump on each upsert");

upsertUser(1, "carol");
assert.equal(getUser(1).name, "carol");
assert.equal(getUser(1).version, 3);

deleteUser(1);
assert.equal(getUser(1), undefined, "deleted users must not be served from cache");

upsertUser(1, "dave");
assert.equal(getUser(1).name, "dave");
assert.equal(getUser(1).version, 1, "version restarts after delete");

console.log("ok");
