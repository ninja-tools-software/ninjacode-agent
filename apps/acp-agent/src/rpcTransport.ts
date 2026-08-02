function write(msg: unknown): void {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

export function respond(id: number | string | undefined, result: unknown): void {
  if (id === undefined) return;
  write({ jsonrpc: "2.0", id, result });
}

export function respondError(id: number | string | undefined, code: number, message: string): void {
  if (id === undefined) return;
  write({ jsonrpc: "2.0", id, error: { code, message } });
}

export function notify(method: string, params: unknown): void {
  write({ jsonrpc: "2.0", method, params });
}
