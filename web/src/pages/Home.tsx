import { ArrowRight, Cable, Download, KeyRound, MousePointerClick, ShieldCheck, Usb } from "lucide-react";
import { Link } from "react-router";
import { ExperimentalNotice } from "@/components/common/ExperimentalNotice";
import { InstallerStatusBanner } from "@/components/common/InstallerStatusBanner";
import { BoardDiagram } from "@/components/hardware/BoardDiagram";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCatalog } from "@/hooks/useCatalog";
import { BOARDS, LEVEL_LABEL } from "@/lib/compatibility/boards";
import { defaultRelease } from "@/lib/firmware/catalog";
import { ERRORS, type ErrorCode } from "@/lib/errors/catalog";

const STEPS = [
  { icon: Usb, title: "Get a board", text: "An ESP32-S3 board with 16 MB flash (marked N16R8) and a USB data cable." },
  { icon: MousePointerClick, title: "Open the installer", text: "In desktop Chrome or Edge. Nothing to download or set up." },
  { icon: Cable, title: "Connect in download mode", text: "Hold the BOOT button while plugging the board in, then pick it in the browser." },
  { icon: Download, title: "Install", text: "The firmware is checked, then written. Your board's stored keys area is never erased silently." },
  { icon: KeyRound, title: "Use it", text: "Replug it: it is now a security key. Press BOOT when a website asks you to touch it." },
];

const COMMON_ERRORS: ErrorCode[] = ["browser-unsupported", "no-device-selected", "not-download-mode", "power-only-cable", "wrong-connector", "wrong-flash-size"];

function ReleaseTeaser() {
  const catalog = useCatalog();
  if (catalog.status === "loading") return <Skeleton className="h-16 w-full" />;
  const latest = catalog.status === "ready" ? defaultRelease(catalog.catalog) : null;
  if (!latest) {
    return <p className="text-muted-foreground">No firmware release published yet. Until then, use the developer method in the README.</p>;
  }
  const b = latest.manifest.builds[0];
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="font-heading text-lg font-semibold">{latest.name}</span>
      {latest.prerelease && <Badge variant="secondary">Pre-release</Badge>}
      {b && <span className="text-muted-foreground">{b.title}</span>}
      <Button asChild variant="link">
        <Link to="/releases">All releases</Link>
      </Button>
    </div>
  );
}

export function HomePage() {
  return (
    <>
      <section className="relative overflow-hidden border-b">
        <div className="hero-backdrop pointer-events-none absolute inset-0" aria-hidden />
        <div className="relative mx-auto flex max-w-4xl flex-col items-center gap-6 px-4 py-20 text-center">
          <Badge variant="outline" className="gap-1">
            <ShieldCheck className="size-3.5 text-primary" aria-hidden /> Open source · FIDO2 / passkeys
          </Badge>
          <h1 className="text-4xl font-bold sm:text-5xl">Turn an ESP32-S3 board into a security key</h1>
          <p className="max-w-2xl text-lg text-muted-foreground">
            MultiKeys installs from your browser in a few minutes. No programming tools, no command line.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <Button asChild size="lg" className="h-11 px-5 text-base">
              <Link to="/install">
                Install MultiKeys <ArrowRight aria-hidden />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="h-11 px-5 text-base">
              <Link to="/first-use">Already installed? First use →</Link>
            </Button>
          </div>
          <ExperimentalNotice className="max-w-2xl text-left" />
          <InstallerStatusBanner className="max-w-2xl text-left" />
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16" aria-labelledby="how">
        <h2 id="how" className="mb-8 text-2xl font-semibold">How it works</h2>
        <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {STEPS.map((s, i) => (
            <li key={s.title}>
              <Card className="h-full">
                <CardHeader>
                  <s.icon className="size-6 text-primary" aria-hidden />
                  <CardTitle>
                    {i + 1}. {s.title}
                  </CardTitle>
                  <CardDescription>{s.text}</CardDescription>
                </CardHeader>
              </Card>
            </li>
          ))}
        </ol>
      </section>

      <section id="compatibility" className="border-y bg-muted/30" aria-labelledby="compat">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 lg:grid-cols-2">
          <div>
            <h2 id="compat" className="mb-4 text-2xl font-semibold">Hardware</h2>
            <ul className="mb-6 list-disc space-y-1 pl-5 text-muted-foreground">
              <li>ESP32-S3 chip with 16 MB flash (module marked N16R8 or N16R2)</li>
              <li>A USB connector wired to the chip itself, usually labelled USB or OTG</li>
              <li>A BOOT button (GPIO0): it becomes the key's touch button</li>
              <li>A USB cable that carries data, not only power</li>
              <li>Desktop Chrome or Edge on Windows, macOS, Linux or ChromeOS</li>
            </ul>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Board</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {BOARDS.filter((b) => b.id !== "unknown").map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="whitespace-normal">{b.label}</TableCell>
                    <TableCell>
                      <Badge variant={b.level === "unsupported" ? "outline" : b.level === "verified" ? "default" : "secondary"}>
                        {LEVEL_LABEL[b.level]}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <BoardDiagram />
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-10 px-4 py-16 lg:grid-cols-2">
        <div aria-labelledby="releases">
          <h2 id="releases" className="mb-4 text-2xl font-semibold">Latest firmware</h2>
          <ReleaseTeaser />
        </div>
        <div aria-labelledby="help">
          <h2 id="help" className="mb-4 text-2xl font-semibold">Common problems</h2>
          <ul className="space-y-2">
            {COMMON_ERRORS.map((c) => (
              <li key={c}>
                <Link className="underline-offset-4 transition-colors hover:underline" to={`/help#${c}`}>
                  {ERRORS[c].title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </>
  );
}
