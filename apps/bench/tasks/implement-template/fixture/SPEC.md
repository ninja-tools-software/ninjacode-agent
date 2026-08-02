# Tiny template engine

`render(template, data)` returns a string.

Syntax:

1. `{{key}}` — replace with `String(data[key])`. Missing keys become empty string.
2. `{{#key}}...{{/key}}` — section: if `data[key]` is a non-empty array, render the inner template once per item with the item as the data context; if `data[key]` is a truthy non-array value, render the inner template once with the original data; if falsy/missing/empty array, render nothing.
3. `{{^key}}...{{/key}}` — inverted section: render inner template with original data only when `data[key]` is falsy or an empty array.
4. Nested sections are supported.
5. Literal `{{` can be escaped as `\{{` (emit `{{`).
6. Do not trim whitespace unless it is part of a replaced value.
