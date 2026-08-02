export function nextEvent(state) {
  if (state === "draft") return "submit";
  if (state === "submitted") return "pay";
  if (state === "paid") return "ship";
  if (state === "shipped") return "deliver";
  return null;
}
