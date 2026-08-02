export function run(items) {
  const total = items.reduce((sum, n) => sum + n, 0);
  return total;
}
