/** @deprecated use request({ url, method, body }) */
export function legacyRequest(url, opts = {}) {
  return request({ url, method: opts.method ?? "GET", body: opts.body });
}

export function request({ url, method = "GET", body }) {
  return { url, method, body: body ?? null, ok: true };
}
