import { cn } from "cn";

/** A page section: its h2, an optional lead, then the content, separated by the section gap. */
export function Section({
  id,
  title,
  description,
  className,
  children,
}: {
  id: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className={cn("flex min-w-0 flex-col gap-4", className)}>
      <div className="flex min-w-0 flex-col gap-1">
        <h2 id={id} className="break-words text-xl font-semibold sm:text-2xl">
          {title}
        </h2>
        {description && <p className="max-w-2xl break-words text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}
