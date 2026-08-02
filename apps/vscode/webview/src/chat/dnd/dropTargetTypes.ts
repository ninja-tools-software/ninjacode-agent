/** Custom MIME used when dragging a badge that is already in the composer. */
export const INTERNAL_REF_MIME = "application/x-ninjacode-ref";

/** Custom MIME used when dragging a result out of the `+` picker. */
export const PICK_SUGGESTION_MIME = "application/x-ninjacode-pick";

/** Payload behind `PICK_SUGGESTION_MIME`. */
export interface DraggedSuggestion {
  queryType: string;
  id: string;
  label: string;
}

export interface GhostCaret {
  x: number;
  y: number;
  height: number;
}
