import { CircleCheck, CircleHelp } from "lucide-react";
import { useI18n } from "@/i18n/context";
import type { Milestones } from "@/lib/flashing/machine";

const KEYS = ["downloaded", "integrityVerified", "written", "flashVerified", "deviceDetected"] as const satisfies readonly (keyof Milestones)[];

export function MilestoneList({ milestones }: { milestones: Milestones }) {
  const { t } = useI18n();
  return (
    <ul className="flex flex-col gap-2" data-testid="milestones">
      {KEYS.map((key) => {
        const ok = milestones[key];
        const Icon = ok ? CircleCheck : CircleHelp;
        return (
          <li key={key} className="flex items-center gap-2">
            <Icon className={ok ? "size-4 text-success-foreground dark:text-success" : "size-4 text-muted-foreground"} aria-hidden />
            <span>{t.flasher.milestones.state(t.flasher.milestones[key], ok)}</span>
          </li>
        );
      })}
    </ul>
  );
}
