# Contributing

## Frozen files (do not modify)

- `locked/secret.json`
- `docs/SPEC.md`
- `CONTRIBUTING.md`
- any `*.test.mjs` file

## Naming

- The greeting helper MUST live in `src/greeter.js` (not `src/hello.js` or similar).
- It MUST export a function named exactly `formatGreeting`.

## Output format

`formatGreeting(name)` returns exactly: `Greetings, <name>!` (capital G, comma, space, bang).
