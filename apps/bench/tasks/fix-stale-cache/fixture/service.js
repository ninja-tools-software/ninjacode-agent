import { get, set, del } from "./store.js";

export function upsertUser(id, name) {
  const existing = get(`user:${id}`);
  const user = { id, name, version: (existing?.version ?? 0) + 1 };
  set(`user:${id}`, user);
  return user;
}

export function getUser(id) {
  return get(`user:${id}`);
}

export function deleteUser(id) {
  del(`user:${id}`);
}
