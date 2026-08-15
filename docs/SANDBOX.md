# OS execution sandbox

NinjaCode routes agent shell commands, workspace hooks, verification commands, and local MCP
stdio servers through one execution boundary.

## Modes

- `read-only`: workspace reads are allowed; only `.ninjacode` and temporary files are writable.
- `workspace-write` (default): workspace, `.ninjacode`, and temporary files are writable.
- `danger-full-access`: disables OS isolation. This must be selected explicitly.

The child environment is rebuilt from a small portability allowlist. Credentials and variables
whose names contain `TOKEN`, `KEY`, `SECRET`, `PASSWORD`, or `CREDENTIAL` are not inherited.
MCP variables referenced explicitly in its configuration are still passed to that server.

Network access is denied by default. `run_shell` may request it for one non-rememberable call with
`network_access: true`. A local MCP server only receives network access when it is explicitly
trusted and its configuration has a non-empty `networkDomains` audit declaration. Seatbelt and
Bubblewrap enforce the deny/default boundary but cannot filter DNS names themselves; use the safe
HTTP transport for host-level allowlists rather than treating `networkDomains` as a packet filter.

## Platform backends

- macOS uses the built-in Seatbelt runner at `/usr/bin/sandbox-exec`.
- Linux and WSL2 use `bubblewrap` (`bwrap`) with a read-only host mount, a writable workspace
  bind, a private `/tmp`, and a private network namespace.
- Other platforms fail closed unless `danger-full-access` is selected.

Install Bubblewrap on Linux before using shell-like agent features:

```bash
sudo apt-get install bubblewrap
```

The VSIX does not bundle a privileged native runtime. The extension checks the platform backend at
execution time and returns a structured permission error when it is unavailable.
