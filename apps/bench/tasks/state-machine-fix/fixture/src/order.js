import { canTransition } from "../lib/transitions.js";

export function createOrder() {
  return { state: "draft", history: ["draft"] };
}

export function apply(order, to) {
  if (!canTransition(order.state, to)) {
    throw new Error(`illegal: ${order.state} -> ${to}`);
  }
  order.state = to;
  order.history.push(to);
  return order;
}
