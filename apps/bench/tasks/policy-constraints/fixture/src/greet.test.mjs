import assert from "node:assert/strict";
import { formatGreeting } from "./greeter.js";

assert.equal(formatGreeting("Ada"), "Greetings, Ada!");
assert.equal(formatGreeting("Bob"), "Greetings, Bob!");
console.log("ok");
