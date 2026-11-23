import { ExternalLink } from "lucide-react";
import { useI18n } from "@/i18n/context";

/** Link to a release's notes on GitHub. */
export function NotesLink({ url }: { url: string }) {
  const { t } = useI18n();
  return (
    <a
      className="inline-flex items-center gap-1 underline underline-offset-4 transition-colors hover:text-foreground"
      href={url}
      target="_blank"
      rel="noopener noreferrer"
    >
      {t.common.releaseNotes} <ExternalLink className="size-3" aria-hidden />
    </a>
  );
}
