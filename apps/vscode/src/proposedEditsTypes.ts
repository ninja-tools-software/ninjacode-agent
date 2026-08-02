/** A contiguous run of changed lines between `current` and `after`. */
export interface Hunk {
  id: string;
  currentStart: number;
  currentLines: string[];
  afterStart: number;
  afterLines: string[];
}
