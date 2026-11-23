import { Badge } from "@/components/reui/badge";
import { useI18n } from "@/i18n/context";
import type { Authentication } from "@/lib/firmware/signature";

/**
 * Whether a release's manifest is signed by a key built into the site. A release from before signing says so in
 * plain words; nothing here ever calls an unsigned release authenticated.
 */
export function ReleaseAuthentication({ authentication }: { authentication: Authentication }) {
  const { t } = useI18n();
  if (authentication.status === "signed") {
    return (
      <span className="flex flex-wrap items-center gap-2" data-testid="release-authentication" data-status="signed">
        <Badge variant="success-light">{t.authentication.signed}</Badge>
        <span className="text-xs text-muted-foreground" lang="en">
          {authentication.keyId}
        </span>
      </span>
    );
  }
  return (
    <span className="flex flex-col items-start gap-1" data-testid="release-authentication" data-status="unsigned">
      <Badge variant="warning-light" className="h-auto min-h-5 text-left whitespace-normal">
        {t.authentication.unsigned}
      </Badge>
      <span className="text-xs text-muted-foreground">{t.authentication.unsignedNote}</span>
    </span>
  );
}
