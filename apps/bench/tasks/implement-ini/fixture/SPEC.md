# Minimal INI parser

`parseIni(text)` returns an object of sections.

Rules:

1. Lines starting with `;` or `#` (after trim) are comments (ignored).
2. Blank lines are ignored.
3. A line `[name]` starts a section. Section names are trimmed.
4. A line `key = value` (or `key=value`) sets a key in the current section. Keys are trimmed.
5. Keys before any section go into a section named `"default"`.
6. Duplicate keys in the same section: last value wins.
7. Values are always strings. Do not coerce numbers/booleans.
8. Inline comments: a ` ;` or ` #` (space then comment char) ends the value; trim the value.
9. Quoted values: if the value (after the `=`) is wrapped in double quotes, strip the quotes and do **not** treat `;` / `#` inside the quotes as comments. Unescape `\"` and `\\` inside quoted values.
10. Lines that are neither section headers nor `key=value` are ignored.
