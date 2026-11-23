import { Badge } from "@/components/reui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useI18n } from "@/i18n/context";
import { LEVEL_BADGE, MATRIX } from "@/lib/compatibility/matrix";

export function HardwareTable() {
  const { t } = useI18n();
  return (
    <Table className="max-md:block">
      <TableHeader className="max-md:sr-only">
        <TableRow>
          <TableHead>{t.home.hardware.table.hardware}</TableHead>
          <TableHead>{t.home.hardware.table.details}</TableHead>
          <TableHead>{t.home.hardware.table.status}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody className="max-md:block">
        {MATRIX.map((row) => (
          <TableRow key={row.id} className="max-md:flex max-md:flex-col max-md:items-start max-md:gap-1 max-md:py-3">
            <TableCell className="font-medium whitespace-normal max-md:p-0">{t.matrix[row.id].hardware}</TableCell>
            <TableCell className="whitespace-normal text-muted-foreground max-md:p-0">{t.matrix[row.id].detail}</TableCell>
            <TableCell className="max-md:p-0 max-md:pt-1">
              <Badge variant={LEVEL_BADGE[row.level]}>{t.levels[row.level]}</Badge>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
