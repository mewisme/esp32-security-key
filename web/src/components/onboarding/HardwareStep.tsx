import { CircleX } from "lucide-react";
import { useState } from "react";
import { BoardDiagram } from "@/components/hardware/BoardDiagram";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { BOARDS, LEVEL_LABEL } from "@/lib/compatibility/boards";

export function HardwareStep({ onConfirm }: { onConfirm: (boardId: string) => void }) {
  const [boardId, setBoardId] = useState<string>("");
  const [hasPorts, setHasPorts] = useState(false);
  const board = BOARDS.find((b) => b.id === boardId);
  const unsupported = board?.level === "unsupported";
  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_minmax(0,22rem)]">
      <div className="space-y-5">
        <fieldset className="space-y-3">
          <legend className="mb-2 font-medium">Which board do you have?</legend>
          <RadioGroup value={boardId} onValueChange={setBoardId} className="gap-2">
            {BOARDS.map((b) => (
              <Label
                key={b.id}
                htmlFor={`board-${b.id}`}
                className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 font-normal transition-colors hover:bg-accent has-data-[state=checked]:border-primary"
              >
                <RadioGroupItem id={`board-${b.id}`} value={b.id} className="mt-0.5" />
                <span className="grid gap-0.5">
                  <span>{b.label}</span>
                  <span className="text-xs text-muted-foreground">{LEVEL_LABEL[b.level]}</span>
                </span>
              </Label>
            ))}
          </RadioGroup>
        </fieldset>
        {board && (
          <Alert variant={unsupported ? "destructive" : "default"}>
            {unsupported && <CircleX aria-hidden />}
            <AlertTitle>{unsupported ? "This board can't run MultiKeys" : LEVEL_LABEL[board.level]}</AlertTitle>
            <AlertDescription>{board.note}</AlertDescription>
          </Alert>
        )}
        {board && !unsupported && (
          <Label className="flex items-start gap-3 font-normal">
            <Checkbox checked={hasPorts} onCheckedChange={(v) => setHasPorts(v === true)} className="mt-0.5" />
            My board has a BOOT button and a USB connector labelled USB or OTG
          </Label>
        )}
        <Button disabled={!board || unsupported || !hasPorts} onClick={() => onConfirm(boardId)}>
          Continue
        </Button>
      </div>
      <BoardDiagram />
    </div>
  );
}
