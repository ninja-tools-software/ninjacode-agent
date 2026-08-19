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

## Known limits

The boundary is real but it is not a jail. What it does **not** currently guarantee:

- **Reads are not confined to the workspace.** Seatbelt allows `file-read*` with targeted denies,
  and Bubblewrap mounts the host read-only. Sensitive paths are masked, but a shell command can
  still read most of the filesystem. Only writes and network are confined.
- **`run_shell` is not path-confined.** Only `cwd` is validated against the workspace; the command
  itself is not restricted to paths inside it. The filesystem tools are confined
  (`resolveInWorkspace` resolves symlinks and rejects escapes), the shell is not.
- **Shell danger classification is syntactic.** `shellDanger.ts` recognises families of dangerous
  commands by parsing argv, unwrapping wrappers and descending into `-c` payloads. A payload it
  cannot parse is not thereby safe — that is why an unclassifiable call is treated as
  `destructive` rather than as the tool's static risk.
- **No defence against prompt injection.** File contents, fetched pages and MCP responses are not
  marked as untrusted. The guarantee comes from permissions and this sandbox, never from prompt
  wording.

`danger-full-access` removes all of the above. The benchmark harness uses it deliberately, which
is one more reason a benchmark score is not a statement about the product's safety posture.
