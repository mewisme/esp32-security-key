import { cn } from "cn";

/**
 * The one place that decides page width and rhythm: `flow` (max-w-3xl) for the Install and First use flows, `wide`
 * (max-w-5xl) for Home, Releases and Help. Children are separated by the section gap of the spacing ladder.
 */
export function Page({ width = "flow", className, ...props }: React.ComponentProps<"div"> & { width?: "flow" | "wide" }) {
  return (
    <div
      className={cn(
        "mx-auto flex w-full flex-col gap-8 px-4 py-8 sm:px-6 sm:py-12",
        width === "flow" ? "max-w-3xl" : "max-w-5xl",
        className,
      )}
      {...props}
    />
  );
}
