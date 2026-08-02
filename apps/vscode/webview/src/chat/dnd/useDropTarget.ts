import { useCallback, useRef, useState } from "react";
import type { DragEvent as ReactDragEvent, MutableRefObject } from "react";
import {
  createDropEnterHandler,
  createDropHandler,
  createDropLeaveHandler,
  createDropOverHandler,
  type DropHandlerState,
  type DropTargetOptions,
} from "./dropTargetHandlers.js";
import type { GhostCaret } from "./dropTargetTypes.js";

export { PICK_SUGGESTION_MIME } from "./dropTargetTypes.js";
export type { DraggedSuggestion } from "./dropTargetTypes.js";

interface DropTarget {
  active: boolean;
  label: string;
  ghost: GhostCaret | null;
  handlers: {
    onDragEnter: (e: ReactDragEvent) => void;
    onDragOver: (e: ReactDragEvent) => void;
    onDragLeave: (e: ReactDragEvent) => void;
    onDrop: (e: ReactDragEvent) => void;
  };
}

function useDropHandlers(stateRef: MutableRefObject<DropHandlerState>) {
  const onDragEnter = useCallback((e: ReactDragEvent) => {
    createDropEnterHandler(stateRef.current)(e);
  }, [stateRef]);

  const onDragOver = useCallback((e: ReactDragEvent) => {
    createDropOverHandler(stateRef.current)(e);
  }, [stateRef]);

  const onDragLeave = useCallback((e: ReactDragEvent) => {
    createDropLeaveHandler(stateRef.current)(e);
  }, [stateRef]);

  const onDrop = useCallback((e: ReactDragEvent) => {
    createDropHandler(stateRef.current)(e);
  }, [stateRef]);

  return { onDragEnter, onDragOver, onDragLeave, onDrop };
}

export function useDropTarget(options: DropTargetOptions): DropTarget {
  const [active, setActive] = useState(false);
  const [label, setLabel] = useState("Drop to attach");
  const [ghost, setGhost] = useState<GhostCaret | null>(null);
  const depthRef = useRef(0);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const end = useCallback(() => {
    depthRef.current = 0;
    setActive(false);
    setGhost(null);
  }, []);

  const stateRef = useRef<DropHandlerState>({
    active,
    setActive,
    setLabel,
    setGhost,
    depthRef,
    optionsRef,
    end,
  });
  stateRef.current = { active, setActive, setLabel, setGhost, depthRef, optionsRef, end };

  const handlers = useDropHandlers(stateRef);

  return { active, label, ghost, handlers };
}
