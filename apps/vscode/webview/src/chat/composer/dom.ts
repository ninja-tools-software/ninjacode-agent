/**
 * The only bridge between the composer's logical document and the DOM.
 *
 * React never renders the contenteditable's children: it would fight the browser
 * for the caret and break IME composition. Instead the document is painted here
 * imperatively, and only when the structure actually differs from what the DOM
 * already shows — plain typing leaves the DOM untouched and is simply read back.
 */
import type { ComposerDoc } from "./model.js";
import { normalize } from "./model.js";
import type { ComposerNode, ContextRef } from "../types.js";
import { refBadgeClass, refBadgeLabel, refBadgeTitle, refIconPaths } from "./refBadgeView.js";

const SVG_NS = "http://www.w3.org/2000/svg";

export const BADGE_ATTR = "data-ref-id";

function isBadge(node: Node): node is HTMLElement {
  return node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).hasAttribute(BADGE_ATTR);
}

function isBreak(node: Node): boolean {
  return node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === "BR";
}

/** Build the atomic badge element inserted inside the contenteditable. */
export function createBadgeElement(ref: ContextRef): HTMLElement {
  const el = document.createElement("span");
  el.className = refBadgeClass(ref, "ref-badge-inline");
  el.setAttribute(BADGE_ATTR, ref.id);
  el.setAttribute("contenteditable", "false");
  el.setAttribute("draggable", "true");
  el.setAttribute("role", "button");
  el.setAttribute("tabindex", "-1");
  el.setAttribute("aria-label", `${ref.kind} ${ref.label}`);
  el.dataset.tooltip = refBadgeTitle(ref);

  const icon = document.createElementNS(SVG_NS, "svg");
  icon.setAttribute("class", "ref-badge-icon");
  icon.setAttribute("width", "11");
  icon.setAttribute("height", "11");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("fill", "none");
  icon.setAttribute("stroke", "currentColor");
  icon.setAttribute("stroke-width", "2");
  icon.setAttribute("stroke-linecap", "round");
  icon.setAttribute("stroke-linejoin", "round");
  icon.setAttribute("aria-hidden", "true");
  for (const d of refIconPaths(ref.kind)) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    icon.appendChild(path);
  }
  el.appendChild(icon);

  const label = document.createElement("span");
  label.className = "ref-badge-label";
  label.textContent = refBadgeLabel(ref);
  el.appendChild(label);

  if (ref.status === "pending") {
    const spinner = document.createElement("span");
    spinner.className = "ref-badge-spinner";
    spinner.setAttribute("aria-hidden", "true");
    el.appendChild(spinner);
  }
  return el;
}

/** Repaint the contenteditable from the document. Caller restores the caret. */
export function renderDoc(root: HTMLElement, doc: ComposerDoc): void {
  root.replaceChildren();
  for (const node of doc.nodes) {
    if (node.kind === "ref") {
      root.appendChild(createBadgeElement(node.ref));
      continue;
    }
    // Split on newlines: the browser needs real <br> elements to show them.
    const lines = node.text.split("\n");
    lines.forEach((line, i) => {
      if (i > 0) root.appendChild(document.createElement("br"));
      if (line) root.appendChild(document.createTextNode(line));
    });
  }
}

/**
 * Read the document back from the DOM after the user typed. Badges are matched
 * by id against the refs we know about; an unknown badge (e.g. pasted HTML) is
 * dropped rather than trusted.
 */
export function readDoc(root: HTMLElement, refsById: ReadonlyMap<string, ContextRef>): ComposerDoc {
  const nodes: ComposerNode[] = [];
  const visit = (parent: Node) => {
    for (const child of Array.from(parent.childNodes)) {
      if (isBadge(child)) {
        const ref = refsById.get(child.getAttribute(BADGE_ATTR) ?? "");
        if (ref) nodes.push({ kind: "ref", ref });
        continue;
      }
      if (isBreak(child)) {
        nodes.push({ kind: "text", text: "\n" });
        continue;
      }
      if (child.nodeType === Node.TEXT_NODE) {
        nodes.push({ kind: "text", text: child.textContent ?? "" });
        continue;
      }
      // Browsers wrap lines in divs after some paste/enter sequences.
      if (child.nodeType === Node.ELEMENT_NODE) {
        if (nodes.length > 0 && (child as HTMLElement).tagName === "DIV") {
          nodes.push({ kind: "text", text: "\n" });
        }
        visit(child);
      }
    }
  };
  visit(root);
  return normalize({ nodes });
}

/** Logical length of a DOM subtree, in composer offsets. */
function subtreeLength(node: Node): number {
  if (isBadge(node)) return 1;
  if (isBreak(node)) return 1;
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? "").length;
  let total = 0;
  for (const child of Array.from(node.childNodes)) total += subtreeLength(child);
  return total;
}

/** Convert a DOM position into a logical offset. */
export function domToOffset(root: HTMLElement, container: Node, offsetInContainer: number): number {
  let offset = 0;
  if (container.nodeType === Node.TEXT_NODE) {
    offset = offsetInContainer;
  } else {
    const children = Array.from(container.childNodes);
    for (let i = 0; i < offsetInContainer && i < children.length; i++) {
      offset += subtreeLength(children[i]!);
    }
  }
  let node: Node | null = container;
  while (node && node !== root) {
    let sibling = node.previousSibling;
    while (sibling) {
      offset += subtreeLength(sibling);
      sibling = sibling.previousSibling;
    }
    node = node.parentNode;
  }
  return offset;
}

/** Current caret (or selection focus) as a logical offset, or `null` if unfocused. */
export function getCaret(root: HTMLElement): { anchor: number; focus: number } | null {
  const sel = document.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.anchorNode || !sel.focusNode) return null;
  if (!root.contains(sel.anchorNode) || !root.contains(sel.focusNode)) return null;
  return {
    anchor: domToOffset(root, sel.anchorNode, sel.anchorOffset),
    focus: domToOffset(root, sel.focusNode, sel.focusOffset),
  };
}

/** Locate the DOM position for a logical offset. */
function offsetToDom(root: HTMLElement, offset: number): { node: Node; offset: number } {
  let remaining = Math.max(0, offset);
  const walk = (parent: Node): { node: Node; offset: number } | null => {
    for (const child of Array.from(parent.childNodes)) {
      if (isBadge(child) || isBreak(child)) {
        if (remaining === 0) {
          const index = Array.from(child.parentNode!.childNodes).indexOf(child as ChildNode);
          return { node: child.parentNode!, offset: index };
        }
        remaining -= 1;
        continue;
      }
      if (child.nodeType === Node.TEXT_NODE) {
        const len = (child.textContent ?? "").length;
        if (remaining <= len) return { node: child, offset: remaining };
        remaining -= len;
        continue;
      }
      if (child.nodeType === Node.ELEMENT_NODE) {
        const found = walk(child);
        if (found) return found;
      }
    }
    return null;
  };
  return walk(root) ?? { node: root, offset: root.childNodes.length };
}

export function setCaret(root: HTMLElement, offset: number, focusOffset?: number): void {
  const sel = document.getSelection();
  if (!sel) return;
  const start = offsetToDom(root, offset);
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  if (focusOffset != null && focusOffset !== offset) {
    const end = offsetToDom(root, focusOffset);
    range.setEnd(end.node, end.offset);
  } else {
    range.collapse(true);
  }
  sel.removeAllRanges();
  sel.addRange(range);
}

/** Logical offset under a pointer, used to drop context exactly where aimed. */
export function offsetFromPoint(root: HTMLElement, x: number, y: number): number {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const position = doc.caretPositionFromPoint?.(x, y);
  if (position && root.contains(position.offsetNode)) {
    return domToOffset(root, position.offsetNode, position.offset);
  }
  const range = doc.caretRangeFromPoint?.(x, y);
  if (range && root.contains(range.startContainer)) {
    return domToOffset(root, range.startContainer, range.startOffset);
  }
  return subtreeLength(root);
}

/** Viewport rect of the caret at a logical offset, for the drop ghost caret. */
export function caretRect(root: HTMLElement, offset: number): DOMRect | null {
  const { node, offset: inner } = offsetToDom(root, offset);
  const range = document.createRange();
  try {
    range.setStart(node, inner);
    range.collapse(true);
  } catch {
    return null;
  }
  const rects = range.getClientRects();
  if (rects.length > 0) return rects[0]!;
  const fallback = (node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node.parentElement)
    ?.getBoundingClientRect();
  return fallback ?? null;
}

/** The badge element a pointer event landed on, if any. */
export function badgeIdFromEvent(target: EventTarget | null): string | null {
  const el = target instanceof Element ? target.closest(`[${BADGE_ATTR}]`) : null;
  return el?.getAttribute(BADGE_ATTR) ?? null;
}

/**
 * Enrich a badge's tooltip with the preview the host just resolved. Written
 * straight to the DOM: a preview must never dirty the document or the caret.
 */
export function setBadgeTooltip(root: HTMLElement, refId: string, tooltip: string): void {
  const el = root.querySelector<HTMLElement>(`[${BADGE_ATTR}="${CSS.escape(refId)}"]`);
  if (el) el.dataset.tooltip = tooltip;
}
