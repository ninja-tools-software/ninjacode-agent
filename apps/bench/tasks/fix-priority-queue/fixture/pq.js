/** Min-heap priority queue. Lower priority number = higher urgency. */
export class PriorityQueue {
  constructor(entries = []) {
    this.heap = [];
    for (const [value, priority] of entries) this.push(value, priority);
  }

  size() {
    return this.heap.length;
  }

  peek() {
    return this.heap[0];
  }

  push(value, priority) {
    this.heap.push({ value, priority });
    this.#bubbleUp(this.heap.length - 1);
  }

  pop() {
    if (this.heap.length === 0) return undefined;
    const min = this.heap[0];
    const last = this.heap.pop();
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.#sinkDown(0);
    }
    return min?.value;
  }

  /** Lower the priority of the first entry with this value. No-op if missing. */
  decreasePriority(value, newPriority) {
    const i = this.heap.findIndex((e) => e.value === value);
    if (i < 0) return;
    // BUG: updates priority but forgets to bubble up when priority decreases
    this.heap[i].priority = newPriority;
  }

  #bubbleUp(i) {
    while (i > 0) {
      const parent = Math.floor((i - 1) / 2);
      if (this.heap[i].priority >= this.heap[parent].priority) break;
      [this.heap[i], this.heap[parent]] = [this.heap[parent], this.heap[i]];
      i = parent;
    }
  }

  #sinkDown(i) {
    const n = this.heap.length;
    while (true) {
      let smallest = i;
      const l = 2 * i + 1;
      const r = 2 * i + 2;
      // BUG: off-by-one — uses <= n instead of < n, can read past end
      if (l <= n && this.heap[l] && this.heap[l].priority < this.heap[smallest].priority) {
        smallest = l;
      }
      if (r <= n && this.heap[r] && this.heap[r].priority < this.heap[smallest].priority) {
        smallest = r;
      }
      if (smallest === i) break;
      [this.heap[i], this.heap[smallest]] = [this.heap[smallest], this.heap[i]];
      i = smallest;
    }
  }
}
