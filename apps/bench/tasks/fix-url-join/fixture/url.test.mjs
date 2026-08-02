import assert from "node:assert/strict";
import { joinUrl } from "./url.js";

assert.equal(joinUrl("https://api.example.com", "v1", "users"), "https://api.example.com/v1/users");
assert.equal(joinUrl("https://api.example.com/", "/v1/", "/users"), "https://api.example.com/v1/users");
assert.equal(joinUrl("https://api.example.com/v1", "users/"), "https://api.example.com/v1/users/");
assert.equal(
  joinUrl("https://api.example.com/v1?token=x", "users"),
  "https://api.example.com/v1/users?token=x",
);
assert.equal(joinUrl("https://api.example.com", ""), "https://api.example.com");
assert.equal(joinUrl("https://api.example.com#top", "docs"), "https://api.example.com/docs#top");
assert.equal(
  joinUrl("https://api.example.com/v1", "https://other.example.com", "x"),
  "https://other.example.com/x",
);
assert.equal(
  joinUrl("https://api.example.com/v1?token=x#frag", "users", "1"),
  "https://api.example.com/v1/users/1?token=x#frag",
);

console.log("ok");
