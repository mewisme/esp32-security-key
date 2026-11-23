import { ExperimentalNotice } from "@/components/common/ExperimentalNotice";
import { KeyCheck } from "@/components/first-use/KeyCheck";
import { RenameKey } from "@/components/first-use/RenameKey";
import { Page } from "@/components/layout/Page";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

const MORE: { id: string; title: string; body: React.ReactNode }[] = [
  {
    id: "register",
    title: "Registering vs. signing in",
    body: (
      <p>
        First add the key to an account (often under Security → Passkeys or Two-step verification → Security key). Later, when you sign
        in, the site asks for the key again and you press BOOT. Use a test account first: this is experimental firmware.
      </p>
    ),
  },
  {
    id: "pin",
    title: "Why a site may ask for a PIN",
    body: (
      <div className="flex flex-col gap-2">
        <p>
          Pressing BOOT proves someone is present. Some sites also want proof that it is <em>you</em>, which this key does with a PIN.
          Once a PIN is set, it can only be removed by resetting the key, which deletes every stored credential.
        </p>
        <p>
          Read{" "}
          <a className="underline underline-offset-4" href={`${REPO_URL}/blob/main/docs/FIDO_UV.md`} target="_blank" rel="noopener noreferrer">
            how the PIN works
          </a>{" "}
          before setting one.
        </p>
      </div>
    ),
  },
  {
    id: "recovery",
    title: "Recovery",
    body: (
      <p>
        If the key stops responding, put the board in download mode (unplug, hold BOOT, plug in, release) and run the installer again.
        It detects the existing MultiKeys installation and doesn't write the area that holds your keys.
      </p>
    ),
  },
];

export function FirstUsePage() {
  return (
    <Page width="flow">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold">First use</h1>
        <p className="text-muted-foreground">Five short steps after the installer has finished.</p>
      </header>
      <ExperimentalNotice />
      <Step
        n={1}
        title="Reconnect"
        description="The serial (COM) port you used for installing disappears. That is normal: the board now presents itself as a security key. Unplug it and plug it into the native USB connector (usually labelled USB or OTG)."
      />
      <Step
        n={2}
        title="The BOOT button is user presence"
        description="When a website or your browser asks you to touch your security key, press the BOOT button once. There is no status light on this firmware, so watch the browser's prompt instead."
      />
      <Step n={3} title="Set a FIDO PIN" description="Your operating system or browser sets the PIN, not this site.">
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
          <li>
            <strong>Windows:</strong> Settings → Accounts → Sign-in options → Security key → Manage.
          </li>
          <li>
            <strong>macOS:</strong> in Chrome or Edge, open Settings → Privacy and security → Security → Manage security keys.
          </li>
          <li>
            <strong>Linux:</strong> in Chrome or Edge, open Settings → Privacy and security → Security → Manage security keys.
          </li>
        </ul>
      </Step>
      <Step n={4} title="Check your key" description="Reads the key's USB name and landing page. Nothing is changed.">
        <KeyCheck />
      </Step>
      <Step n={5} title="Rename your key" description="Choose the name your computer shows for the key. You will press BOOT on the key to confirm.">
        <RenameKey />
      </Step>
      <Card>
        <CardHeader>
          <CardTitle>More about your key</CardTitle>
        </CardHeader>
        <CardContent>
          <Accordion type="multiple">
            {MORE.map((m) => (
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
