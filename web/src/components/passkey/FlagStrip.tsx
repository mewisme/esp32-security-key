import { Badge } from "@/components/reui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useI18n } from "@/i18n/context";
import type { AuthFlags } from "@/lib/passkey/authdata";

const FLAGS = ["up", "uv", "be", "bs"] as const;

/** The four flags of the authenticator data as pills: a set flag is green, an unset one an outline; each explains itself. */
export function FlagStrip({ flags }: { flags: AuthFlags }) {
  const { t } = useI18n();
  const i = t.passkeyLab.inspector;
  return (
    <ul className="flex flex-wrap gap-2" aria-label={i.flagsLabel}>
      {FLAGS.map((id) => {
        const set = flags[id];
        return (
          <li key={id}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant={set ? "success-light" : "outline"} radius="full" size="lg" tabIndex={0} data-testid={`flag-${id}`} data-set={set}>
                  <span lang="en">{i.flags[id].label}</span>
                  <span className="sr-only">: {set ? i.yes : i.no}</span>
                </Badge>
              </TooltipTrigger>
              <TooltipContent>{i.flags[id].tip}</TooltipContent>
            </Tooltip>
          </li>
        );
      })}
    </ul>
  );
}
