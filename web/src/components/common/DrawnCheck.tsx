import { cn } from "cn";

/**
 * A check mark that draws itself once when it mounts (a plain mark under reduced motion), in lucide's geometry so it sits
 * where `Check` and `CircleCheck` do. `ring` adds the circle of `CircleCheck`. The path has `pathLength` 1 so the draw
 * (`.draw-check` in styles/index.css) does not depend on its real length.
 */
export function DrawnCheck({ ring, strokeWidth = 2, className }: { ring?: boolean; strokeWidth?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn("shrink-0", className)}
    >
      {ring ? (
        <>
          <circle cx="12" cy="12" r="10" />
          <path className="draw-check" pathLength={1} d="m9 12 2 2 4-4" />
        </>
      ) : (
        <path className="draw-check" pathLength={1} d="M20 6 9 17l-5-5" />
      )}
    </svg>
  );
}
