import { CircleCheck, Info, ShieldAlert, TriangleAlert } from "lucide-react";
import { Link } from "react-router";
import { Alert, AlertDescription, AlertTitle } from "@/components/reui/alert";
import { Badge } from "@/components/reui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useI18n } from "@/i18n/context";
import type { UpdateReport, UpdateVerdict } from "@/lib/flashing/update-report";

const VERDICT_ALERT = {
  verified: { variant: "success", Icon: CircleCheck },
  partial: { variant: "info", Icon: Info },
  unchecked: { variant: "warning", Icon: TriangleAlert },
  mismatch: { variant: "destructive", Icon: ShieldAlert },
} as const satisfies Record<UpdateVerdict, { variant: string; Icon: unknown }>;

function Result({ value }: { value: boolean | null }) {
  const { t } = useI18n();
  const r = t.install.finish.report.results;
  if (value === true) return <Badge variant="success-light">{r.yes}</Badge>;
  if (value === false) return <Badge variant="destructive-light">{r.no}</Badge>;
  return <Badge variant="warning-light">{r.unknown}</Badge>;
}

/** What the page could check about the key after an application-only write: the verdict and one row per check. */
export function FlashReport({ report }: { report: UpdateReport }) {
  const { t } = useI18n();
  const v = t.install.finish.report;
  const { variant, Icon } = VERDICT_ALERT[report.verdict];
  const rows = [
    { id: "image", value: report.imageMatches },
    { id: "version", value: report.versionMatches },
    { id: "name", value: report.nameUnchanged },
    { id: "mkauth", value: report.mkauthUnchanged },
  ] as const;
  return (
    <div className="flex flex-col gap-3">
      <h3 className="font-medium">{v.title}</h3>
      <p className="text-sm text-muted-foreground">{v.description}</p>
      <Alert variant={variant} data-testid="update-verdict" data-verdict={report.verdict}>
        <Icon aria-hidden />
        <AlertTitle>{v.verdicts[report.verdict].title}</AlertTitle>
        <AlertDescription>{v.verdicts[report.verdict].text}</AlertDescription>
      </Alert>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{v.table.check}</TableHead>
            <TableHead>{v.table.result}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id} data-testid={`verify-${row.id}`}>
              <TableCell className="whitespace-normal">{v.rows[row.id]}</TableCell>
              <TableCell>
                <Result value={row.value} />
              </TableCell>
            </TableRow>
          ))}
          <TableRow data-testid="verify-fido">
            <TableCell className="whitespace-normal">{v.rows.fido}</TableCell>
            <TableCell className="whitespace-normal">
              <Result value={null} />
              <span className="mt-1 block text-xs text-muted-foreground">{v.fidoNote}</span>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
      <div>
        <Button asChild variant="outline">
          <Link to="/passkeys">{v.passkeyTest}</Link>
        </Button>
      </div>
    </div>
  );
}
