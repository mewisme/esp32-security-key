import { Badge } from "@/components/reui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useI18n } from "@/i18n/context";
import { LEVEL_BADGE, MATRIX } from "@/lib/compatibility/matrix";

export function HardwareTable() {
  const { t } = useI18n();
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t.home.hardware.table.hardware}</TableHead>
          <TableHead>{t.home.hardware.table.details}</TableHead>
          <TableHead>{t.home.hardware.table.status}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {MATRIX.map((row) => (
          <TableRow key={row.id}>
            <TableCell className="font-medium whitespace-normal">{t.matrix[row.id].hardware}</TableCell>
            <TableCell className="whitespace-normal text-muted-foreground">{t.matrix[row.id].detail}</TableCell>
            <TableCell>
              <Badge variant={LEVEL_BADGE[row.level]}>{t.levels[row.level]}</Badge>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
