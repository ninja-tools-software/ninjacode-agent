import type { DragEvent as ReactDragEvent, MutableRefObject } from "react";
import type { DropItem } from "../types.js";
import { describeDrop, hasDroppableContent, parseDataTransfer } from "./dropParser.js";
import {
  INTERNAL_REF_MIME,
  PICK_SUGGESTION_MIME,
  type DraggedSuggestion,
  type GhostCaret,
} from "./dropTargetTypes.js";

export interface DropTargetOptions {
  locate: (x: number, y: number) => { offset: number; ghost: GhostCaret | null };
  onDropItems: (items: DropItem[], offset: number) => void;
  onMoveRef: (refId: string, offset: number) => void;
  onDropSuggestion: (suggestion: DraggedSuggestion, offset: number) => void;
  disabled?: boolean;
}

const INTERNAL_MIMES = [INTERNAL_REF_MIME, PICK_SUGGESTION_MIME];

function accepts(types: readonly string[]): boolean {
  return hasDroppableContent(types) || types.some((t) => INTERNAL_MIMES.includes(t));
}

function parseSuggestion(raw: string): DraggedSuggestion | null {
  try {
    const parsed = JSON.parse(raw) as Partial<DraggedSuggestion>;
    if (typeof parsed.queryType !== "string" || typeof parsed.id !== "string") return null;
    return { queryType: parsed.queryType, id: parsed.id, label: String(parsed.label ?? parsed.id) };
  } catch {
    return null;
  }
}

export interface DropHandlerState {
  active: boolean;
  setActive: (active: boolean) => void;
  setLabel: (label: string) => void;
  setGhost: (ghost: GhostCaret | null) => void;
  depthRef: MutableRefObject<number>;
  optionsRef: MutableRefObject<DropTargetOptions>;
  end: () => void;
}

export function createDropEnterHandler(state: DropHandlerState) {
  return (e: ReactDragEvent) => {
    const { disabled } = state.optionsRef.current;
    const types = Array.from(e.dataTransfer.types);
    if (disabled || !accepts(types)) return;
    e.preventDefault();
    state.depthRef.current += 1;
    state.setLabel(types.includes(INTERNAL_REF_MIME) ? "Move here" : describeDrop(types));
    state.setActive(true);
  };
}

export function createDropOverHandler(state: DropHandlerState) {
  return (e: ReactDragEvent) => {
    const { disabled, locate } = state.optionsRef.current;
    const types = Array.from(e.dataTransfer.types);
    if (disabled || !accepts(types)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = types.includes(INTERNAL_REF_MIME) ? "move" : "copy";
    if (!state.active) state.setActive(true);
    state.setGhost(locate(e.clientX, e.clientY).ghost);
  };
}

export function createDropLeaveHandler(state: DropHandlerState) {
  return (e: ReactDragEvent) => {
    e.preventDefault();
    state.depthRef.current -= 1;
    if (state.depthRef.current <= 0) state.end();
  };
}

export function createDropHandler(state: DropHandlerState) {
  return (e: ReactDragEvent) => {
    const { disabled, locate, onDropItems, onMoveRef, onDropSuggestion } = state.optionsRef.current;
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    const dataTransfer = e.dataTransfer;
    const { offset } = locate(e.clientX, e.clientY);
    state.end();

    const movedRef = dataTransfer.getData(INTERNAL_REF_MIME);
    if (movedRef) {
      onMoveRef(movedRef, offset);
      return;
    }
    const picked = dataTransfer.getData(PICK_SUGGESTION_MIME);
    if (picked) {
      const suggestion = parseSuggestion(picked);
      if (suggestion) onDropSuggestion(suggestion, offset);
      return;
    }
    const snapshot = {
      types: Array.from(dataTransfer.types),
      getData: (format: string) => dataTransfer.getData(format),
      files: Array.from(dataTransfer.files),
    };
    void parseDataTransfer(snapshot).then((items) => {
      if (items.length > 0) onDropItems(items, offset);
    });
  };
}
