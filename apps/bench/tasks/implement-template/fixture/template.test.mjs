import assert from "node:assert/strict";
import { render } from "./template.js";

assert.equal(render("Hi {{name}}!", { name: "Ada" }), "Hi Ada!");
assert.equal(render("Hi {{name}}!", {}), "Hi !");
assert.equal(render("a \\{{b}} c", { b: "x" }), "a {{b}} c");

assert.equal(
  render("{{#items}}<{{name}}>{{/items}}", {
    items: [{ name: "a" }, { name: "b" }],
  }),
  "<a><b>",
);

assert.equal(render("{{#show}}YES{{/show}}", { show: true }), "YES");
assert.equal(render("{{#show}}YES{{/show}}", { show: false }), "");
assert.equal(render("{{#items}}X{{/items}}", { items: [] }), "");

assert.equal(render("{{^show}}NO{{/show}}", { show: false }), "NO");
assert.equal(render("{{^items}}empty{{/items}}", { items: [] }), "empty");
assert.equal(render("{{^items}}empty{{/items}}", { items: [1] }), "");

assert.equal(
  render("{{#users}}{{#active}}{{name}};{{/active}}{{/users}}", {
    users: [
      { name: "a", active: true },
      { name: "b", active: false },
      { name: "c", active: true },
    ],
  }),
  "a;c;",
);

console.log("ok");
