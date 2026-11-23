import { Badge } from "@/components/reui/badge";
import { LEVEL_BADGE, LEVEL_TEXT, MATRIX } from "@/lib/compatibility/matrix";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export function HardwareTable() {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Hardware</TableHead>
          <TableHead>Details</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {MATRIX.map((row) => (
          <TableRow key={row.id}>
            <TableCell className="font-medium whitespace-normal">{row.hardware}</TableCell>
            <TableCell className="whitespace-normal text-muted-foreground">{row.detail}</TableCell>
            <TableCell>
              <Badge variant={LEVEL_BADGE[row.level]}>{LEVEL_TEXT[row.level]}</Badge>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
