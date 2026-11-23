import { ExperimentalNotice } from "@/components/common/ExperimentalNotice";
import { KeyCheck } from "@/components/first-use/KeyCheck";
import { RenameKey } from "@/components/first-use/RenameKey";
import { Page } from "@/components/layout/Page";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "@/i18n/context";
import { REPO_URL } from "@/lib/status";

function Step({ n, title, description, children }: { n: number; title: string; description?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {n}. {title}
        </CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      {children && <CardContent>{children}</CardContent>}
    </Card>
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
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold">{f.title}</h1>
        <p className="text-muted-foreground">{f.lead}</p>
      </header>
      <ExperimentalNotice />
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
        <KeyCheck />
      </Step>
      <Step n={5} title={f.rename.title} description={f.rename.text}>
        <RenameKey />
      </Step>
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
