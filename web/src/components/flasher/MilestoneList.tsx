import { CircleCheck, CircleHelp } from "lucide-react";
import type { Milestones } from "@/lib/flashing/machine";

const ITEMS: { key: keyof Milestones; label: string }[] = [
  { key: "downloaded", label: "Downloaded" },
  { key: "integrityVerified", label: "Checksums verified" },
  { key: "written", label: "Written" },
  { key: "flashVerified", label: "Flash contents verified" },
  { key: "deviceDetected", label: "Key detected" },
];

export function MilestoneList({ milestones }: { milestones: Milestones }) {
  return (
    <ul className="flex flex-col gap-2" data-testid="milestones">
      {ITEMS.map(({ key, label }) => {
        const ok = milestones[key];
        const Icon = ok ? CircleCheck : CircleHelp;
        return (
          <li key={key} className="flex items-center gap-2">
            <Icon className={ok ? "size-4 text-success-foreground dark:text-success" : "size-4 text-muted-foreground"} aria-hidden />
            <span>
              {label}: {ok ? "yes" : "not confirmed"}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
