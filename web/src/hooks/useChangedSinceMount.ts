import { useState } from "react";

/**
 * True once `value` has differed from what it was when the component first rendered. Content that is already there when a
 * view appears rides on the view's own entrance; only what arrives afterwards (a load finishing, a result, a state change)
 * gets a reveal of its own, so a view never plays two entrances at once.
 */
export function useChangedSinceMount(value: unknown): boolean {
  const [seen, setSeen] = useState(value);
  const [changed, setChanged] = useState(false);
  if (!Object.is(value, seen)) {
    setSeen(value);
    setChanged(true);
  }
  return changed;
}
