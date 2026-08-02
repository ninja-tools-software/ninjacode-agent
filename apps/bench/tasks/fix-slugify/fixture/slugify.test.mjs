import { slugify } from "./slugify.js";
import assert from "node:assert";

assert.equal(slugify("Hello World"), "hello-world");
assert.equal(slugify("Crème brûlée!"), "creme-brulee");
assert.equal(slugify("  --Already--Slugged--  "), "already-slugged");
assert.equal(slugify("100% TypeScript & Node.js"), "100-typescript-node-js");
assert.equal(slugify("___"), "");
console.log("ok");
