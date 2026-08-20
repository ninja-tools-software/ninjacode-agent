# Security policy

NinjaCode Agent runs on the developer's machine with access to the workspace, a controlled
shell (`run_shell`), and optionally network tools. Provider API keys are stored in the host
secret store (VS Code `SecretStorage`) or in environment variables for the CLI / ACP.

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security findings.

Email the maintainers at **security@ninja-tools.software** (or open a private security
advisory on this repository if that channel is enabled). Include:

- Affected package / app (`packages/core`, `apps/vscode`, …)
- A clear description of the issue and impact
- Steps to reproduce (without a weaponized exploit PoC if possible)

We aim to acknowledge within a few business days.

## Scope notes

- Out of scope: the separate, private NinjaCode gateway backend. Report gateway issues to
  the same contact and say so explicitly.
- Do not file issues that include live API keys, customer data, or ready-to-run exploit
  payloads against third-party systems.
- Permission and sandbox limits are documented in [docs/HARNESS.md](docs/HARNESS.md) and
  [docs/SANDBOX.md](docs/SANDBOX.md) — known limits are not treated as surprise bugs unless
  they diverge from that documentation.
