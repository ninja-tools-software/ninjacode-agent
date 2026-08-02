import assert from "node:assert/strict";
import { parseIni } from "./ini.js";

const src = `
; global comment
host = localhost
port = 8080

[database]
host = db.local
port = 5432 ; inline comment
# user comment
user = app

[database]
user = app2

[empty]

[flags]
debug = true
retries = 3
note = "hello ; not a comment"
path = "C:\\\\temp\\\\file"
title = "say \\"hi\\""
`;

const result = parseIni(src);
assert.deepEqual(result.default, { host: "localhost", port: "8080" });
assert.deepEqual(result.database, { host: "db.local", port: "5432", user: "app2" });
assert.deepEqual(result.empty, {});
assert.deepEqual(result.flags, {
  debug: "true",
  retries: "3",
  note: "hello ; not a comment",
  path: "C:\\temp\\file",
  title: 'say "hi"',
});

assert.deepEqual(parseIni(""), {});
assert.deepEqual(parseIni("only=value\n"), { default: { only: "value" } });

console.log("ok");
