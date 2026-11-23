import { Cable, Download, Fingerprint, GitBranch, Hash, KeyRound, MousePointerClick, ShieldCheck, TriangleAlert } from "lucide-react";
import { Link } from "react-router";
import { HardwareTable } from "@/components/home/HardwareTable";
import { LatestRelease } from "@/components/home/LatestRelease";
import { Page } from "@/components/layout/Page";
import { Alert, AlertDescription, AlertTitle } from "@/components/reui/alert";
import { Badge } from "@/components/reui/badge";
import { IconTile } from "@/components/reui/icon-tile";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DOCS_URL, REPO_URL } from "@/lib/status";

const HOW: { icon: typeof Cable; title: string; text: string }[] = [
  { icon: Cable, title: "Connect", text: "Plug an ESP32-S3 board into your computer's USB port in download mode." },
  { icon: Download, title: "Install", text: "The installer checks the board and the firmware, shows what it will write, then writes it." },
  { icon: MousePointerClick, title: "Press BOOT to sign in", text: "Replug it: it is now a security key. Press BOOT when a website asks you to touch it." },
];

const FEATURES: { icon: typeof Cable; title: string; text: string }[] = [
  { icon: KeyRound, title: "Passkeys and FIDO2", text: "Works with WebAuthn sign-in on sites and apps that accept security keys." },
  { icon: Fingerprint, title: "BOOT-button presence", text: "Every sign-in needs a physical press of the BOOT button." },
  { icon: Hash, title: "PIN", text: "Protect stored credentials with a FIDO PIN set from your browser or OS." },
  { icon: GitBranch, title: "Open source and auditable", text: "Firmware, host tools and this site are published under the AGPL." },
];

const DOCS: { label: string; href: string }[] = [
  { label: "Documentation", href: DOCS_URL },
  { label: "Hardware", href: `${REPO_URL}/blob/main/docs/HARDWARE.md` },
  { label: "Security", href: `${REPO_URL}/blob/main/docs/SECURITY.md` },
  { label: "Releases process", href: `${REPO_URL}/blob/main/docs/RELEASES.md` },
];

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4">
      <h2 id={id} className="text-2xl font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function HomePage() {
  return (
    <Page width="wide">
      <section className="flex flex-col items-start gap-4" aria-labelledby="hero">
        <Badge variant="outline">Experimental · open source</Badge>
        <h1 id="hero" className="max-w-3xl text-4xl font-bold sm:text-5xl">
          Turn an ESP32-S3 into a FIDO2 security key
        </h1>
        <p className="max-w-2xl text-lg text-muted-foreground">Install MultiKeys from your browser in a few minutes, no command line needed.</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild size="lg">
            <Link to="/install">Install</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link to="/first-use">First use</Link>
          </Button>
          <Button asChild size="lg" variant="link">
            <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
              Source on GitHub
            </a>
          </Button>
        </div>
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <ShieldCheck className="size-4" aria-hidden /> Hardware verified on ESP32-S3 N16R8
        </p>
      </section>

      <Section id="how" title="How it works">
        <ol className="grid gap-4 sm:grid-cols-3">
          {HOW.map((s, i) => (
            <li key={s.title} className="flex">
              <Card className="w-full">
                <CardHeader>
                  <IconTile variant="soft">
                    <s.icon aria-hidden />
                  </IconTile>
                  <CardTitle>
                    {i + 1}. {s.title}
                  </CardTitle>
                  <CardDescription>{s.text}</CardDescription>
                </CardHeader>
              </Card>
            </li>
          ))}
        </ol>
      </Section>

      <Section id="features" title="Features">
        <ul className="grid gap-4 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <li key={f.title} className="flex">
              <Card className="w-full">
                <CardHeader>
                  <IconTile variant="soft">
                    <f.icon aria-hidden />
                  </IconTile>
                  <CardTitle>{f.title}</CardTitle>
                  <CardDescription>{f.text}</CardDescription>
                </CardHeader>
              </Card>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="hardware" title="Supported hardware">
        <HardwareTable />
        <p className="text-sm text-muted-foreground">
          Details and how to read your module's marking:{" "}
          <a className="underline underline-offset-4" href={`${REPO_URL}/blob/main/docs/HARDWARE.md`} target="_blank" rel="noopener noreferrer">
            docs/HARDWARE.md
          </a>
          .
        </p>
      </Section>

      <Alert variant="warning">
        <TriangleAlert aria-hidden />
        <AlertTitle>Development firmware</AlertTitle>
        <AlertDescription>Development firmware: not FIDO-certified, no secure element, flash encryption off. Don't use it as your only key.</AlertDescription>
      </Alert>

      <Section id="release" title="Latest release">
        <LatestRelease />
      </Section>

      <Section id="docs" title="Documentation">
        <div className="flex flex-wrap gap-2">
          {DOCS.map((d) => (
            <Button key={d.label} asChild variant="outline">
              <a href={d.href} target="_blank" rel="noopener noreferrer">
                {d.label}
              </a>
            </Button>
          ))}
        </div>
      </Section>
    </Page>
  );
}
