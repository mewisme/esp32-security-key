import { cn } from "cn";

/**
 * The heading block every page starts with: an optional eyebrow, the one h1, a lead, and the primary actions.
 * Text is free to wrap in any language (`min-w-0`, `break-words`); nothing here has a fixed width or height.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  size = "page",
  id,
  className,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  /** `hero` is the larger heading of the home page. */
  size?: "page" | "hero";
  id?: string;
  className?: string;
}) {
  return (
    <header className={cn("flex min-w-0 flex-col items-start gap-3", className)}>
      {eyebrow}
      <h1 id={id} className={cn("break-words font-semibold", size === "hero" ? "max-w-3xl text-4xl font-bold sm:text-5xl" : "text-2xl sm:text-3xl")}>
        {title}
      </h1>
      {description && <p className={cn("max-w-2xl break-words text-muted-foreground", size === "hero" && "text-lg")}>{description}</p>}
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
