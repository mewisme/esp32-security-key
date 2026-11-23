import { Cable, Download, FileKey, Fingerprint, GitBranch, Hash, KeyRound, MousePointerClick, ShieldCheck, TriangleAlert } from "lucide-react";
import { Link } from "react-router";
import { HardwareTable } from "@/components/home/HardwareTable";
import { LatestRelease } from "@/components/home/LatestRelease";
import { Page } from "@/components/layout/Page";
import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { Alert, AlertDescription, AlertTitle } from "@/components/reui/alert";
import { Badge } from "@/components/reui/badge";
import { IconTile } from "@/components/reui/icon-tile";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "@/i18n/context";
import { DOCS_URL, REPO_URL } from "@/lib/status";

const IMAGES = [
  { key: "fido", icon: KeyRound, badge: "success-light" },
  { key: "openpgp", icon: FileKey, badge: "warning-light" },
] as const;

const HOW = [
  { key: "connect", icon: Cable },
  { key: "install", icon: Download },
  { key: "signIn", icon: MousePointerClick },
] as const;

const FEATURES = [
  { key: "passkeys", icon: KeyRound },
  { key: "presence", icon: Fingerprint },
  { key: "pin", icon: Hash },
  { key: "open", icon: GitBranch },
] as const;

const DOCS = [
  { key: "documentation", href: DOCS_URL },
  { key: "hardware", href: `${REPO_URL}/blob/main/docs/HARDWARE.md` },
  { key: "security", href: `${REPO_URL}/blob/main/docs/SECURITY.md` },
  { key: "releasesProcess", href: `${REPO_URL}/blob/main/docs/RELEASES.md` },
] as const;

export function HomePage() {
  const { t } = useI18n();
  return (
    <Page width="wide">
      <PageHeader
        size="hero"
        id="hero"
        eyebrow={<Badge variant="outline">{t.home.badge}</Badge>}
        title={t.home.title}
        description={t.home.lead}
        actions={
          <>
            <Button asChild size="lg">
              <Link to="/install">{t.layout.nav.install}</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link to="/update">{t.home.updateFirmware}</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link to="/first-use">{t.layout.nav.firstUse}</Link>
            </Button>
            <Button asChild size="lg" variant="link">
              <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
                {t.home.source}
              </a>
            </Button>
          </>
        }
      />
      <p className="flex items-start gap-2 text-sm text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden /> <span className="break-words">{t.home.verified}</span>
      </p>

      <Section id="how" title={t.home.how.title}>
        <ol className="grid gap-4 sm:grid-cols-3">
          {HOW.map((s, i) => (
            <li key={s.key} className="flex">
              <Card className="w-full">
                <CardHeader>
                  <IconTile variant="soft">
                    <s.icon aria-hidden />
                  </IconTile>
                  <CardTitle>
                    {i + 1}. {t.home.how[s.key].title}
                  </CardTitle>
                  <CardDescription>{t.home.how[s.key].text}</CardDescription>
                </CardHeader>
              </Card>
            </li>
          ))}
        </ol>
      </Section>

      <Section id="features" title={t.home.features.title}>
        <ul className="grid gap-4 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <li key={f.key} className="flex">
              <Card className="w-full">
                <CardHeader>
                  <IconTile variant="soft">
                    <f.icon aria-hidden />
                  </IconTile>
                  <CardTitle>{t.home.features[f.key].title}</CardTitle>
                  <CardDescription>{t.home.features[f.key].text}</CardDescription>
                </CardHeader>
              </Card>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="images" title={t.home.images.title} description={t.home.images.note}>
        <ul className="grid gap-4 sm:grid-cols-2">
          {IMAGES.map((img) => (
            <li key={img.key} className="flex">
              <Card className="w-full">
                <CardHeader>
                  <IconTile variant="soft">
                    <img.icon aria-hidden />
                  </IconTile>
                  <CardTitle>{t.home.images[img.key].title}</CardTitle>
                  <CardDescription>{t.home.images[img.key].text}</CardDescription>
                  <div>
                    <Badge variant={img.badge}>{t.home.images[img.key].status}</Badge>
                  </div>
                </CardHeader>
              </Card>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="hardware" title={t.home.hardware.title}>
        <HardwareTable />
        <p className="text-sm text-muted-foreground">
          {t.home.hardware.details(
            <a className="underline underline-offset-4 transition-colors hover:text-primary" href={`${REPO_URL}/blob/main/docs/HARDWARE.md`} target="_blank" rel="noopener noreferrer">
              docs/HARDWARE.md
            </a>,
          )}
        </p>
      </Section>

      <Alert variant="warning">
        <TriangleAlert aria-hidden />
        <AlertTitle>{t.home.warning.title}</AlertTitle>
        <AlertDescription>{t.home.warning.text}</AlertDescription>
      </Alert>

      <Section id="release" title={t.home.latest}>
        <LatestRelease />
      </Section>

      <Section id="docs" title={t.home.docs.title}>
        <div className="flex flex-wrap gap-2">
          {DOCS.map((d) => (
            <Button key={d.key} asChild variant="outline">
              <a href={d.href} target="_blank" rel="noopener noreferrer">
                {t.home.docs[d.key]}
              </a>
            </Button>
          ))}
        </div>
      </Section>
    </Page>
  );
}
