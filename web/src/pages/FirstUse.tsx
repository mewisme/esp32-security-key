import { Link } from "react-router";
import { ExperimentalNotice } from "@/components/common/ExperimentalNotice";
import { RenameKey } from "@/components/first-use/RenameKey";
import { Page } from "@/components/layout/Page";
import { PageHeader } from "@/components/layout/PageHeader";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "@/i18n/context";
import { REPO_URL } from "@/lib/status";

/** One numbered step of the checklist; the number is shown by the list, the text wraps freely in either language. */
function Step({ n, title, description, children }: { n: number; title: string; description?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <li className="flex min-w-0 gap-3">
      <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-medium text-primary">
        {n}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-col gap-1">
          <h2 className="break-words font-medium">{title}</h2>
          {description && <p className="break-words text-sm text-muted-foreground">{description}</p>}
        </div>
        {children}
      </div>
    </li>
  );
}

export function FirstUsePage() {
  const { t } = useI18n();
  const f = t.firstUse;
  const more: { id: "register" | "pin" | "recovery"; title: string; body: React.ReactNode }[] = [
    { id: "register", title: f.more.register.title, body: <p>{f.more.register.text}</p> },
    {
      id: "pin",
      title: f.more.pin.title,
      body: (
        <div className="flex flex-col gap-2">
          <p>{f.more.pin.intro}</p>
          <p>
            {f.more.pin.read(
              <a className="underline underline-offset-4 transition-colors hover:text-primary" href={`${REPO_URL}/blob/main/docs/FIDO_UV.md`} target="_blank" rel="noopener noreferrer">
                {f.more.pin.link}
              </a>,
            )}
          </p>
        </div>
      ),
    },
    { id: "recovery", title: f.more.recovery.title, body: <p>{f.more.recovery.text}</p> },
  ];
  return (
    <Page width="flow">
      <PageHeader title={f.title} description={f.lead} />
      <ExperimentalNotice />
      <Card>
        <CardContent>
          <ol className="flex flex-col gap-6">
            <Step n={1} title={f.reconnect.title} description={f.reconnect.text} />
            <Step n={2} title={f.presence.title} description={f.presence.text} />
            <Step n={3} title={f.pin.title} description={f.pin.text}>
              <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
                <li>{f.pin.windows(<strong>Windows:</strong>)}</li>
                <li>{f.pin.macos(<strong>macOS:</strong>)}</li>
                <li>{f.pin.linux(<strong>Linux:</strong>)}</li>
              </ul>
            </Step>
            <Step n={4} title={f.check.title} description={f.check.text}>
              <Button asChild>
                <Link to="/key">{f.check.cta}</Link>
              </Button>
            </Step>
            <Step n={5} title={f.rename.title} description={f.rename.text}>
              <RenameKey />
            </Step>
            <Step n={6} title={f.tryPasskeys.title} description={f.tryPasskeys.text}>
              <Button asChild>
                <Link to="/passkeys">{f.tryPasskeys.cta}</Link>
              </Button>
            </Step>
          </ol>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{f.more.title}</CardTitle>
        </CardHeader>
        <CardContent>
          <Accordion type="multiple">
            {more.map((m) => (
              <AccordionItem key={m.id} value={m.id}>
                <AccordionTrigger>{m.title}</AccordionTrigger>
                <AccordionContent className="text-muted-foreground">{m.body}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </CardContent>
      </Card>
    </Page>
  );
}
