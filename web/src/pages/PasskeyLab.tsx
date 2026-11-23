import { Fingerprint, Hand, KeyRound, ScanSearch, ShieldCheck, TriangleAlert } from "lucide-react";
import { useRef, useState } from "react";
import { Page } from "@/components/layout/Page";
import { PageHeader } from "@/components/layout/PageHeader";
import { Inspector, type Latest } from "@/components/passkey/Inspector";
import { KeyVisual, type KeyVisualState } from "@/components/passkey/KeyVisual";
import { type CardStatus, TestCard } from "@/components/passkey/TestCard";
import { Alert, AlertDescription, AlertTitle } from "@/components/reui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useI18n } from "@/i18n/context";
import { type LabCredential, webAuthnSupported } from "@/lib/passkey/lab";
import { type Outcome, runTest, TESTS, type TestId, timeoutFor } from "@/lib/passkey/tests";

const ICONS: Record<TestId, React.ReactNode> = {
  register: <KeyRound />,
  signIn: <Fingerprint />,
  discoverable: <ScanSearch />,
  refusal: <Hand />,
};

const CODE = "rounded bg-muted px-1.5 py-0.5 font-mono text-xs";

/** Tries the key's passkeys with the browser's WebAuthn API. Everything lives in memory: a reload starts over. */
export function PasskeyLabPage() {
  const { t } = useI18n();
  const p = t.passkeyLab;
  const supported = webAuthnSupported();
  const [credential, setCredential] = useState<LabCredential | null>(null);
  const [signCount, setSignCount] = useState(0);
  const [results, setResults] = useState<Partial<Record<TestId, Outcome>>>({});
  const [running, setRunning] = useState<TestId | null>(null);
  const [latest, setLatest] = useState<Latest | null>(null);
  const [runId, setRunId] = useState(0);
  const counter = useRef(0);

  const run = async (test: TestId) => {
    if (running) return;
    const id = ++counter.current;
    setRunId(id);
    setRunning(test);
    const outcome = await runTest(test, credential, signCount);
    const d = outcome.detail;
    if (d.kind === "register") {
      if (outcome.passed) {
        // A new passkey: what the other tests found belongs to the old one.
        setCredential(d.credential);
        setSignCount(d.credential.signCount);
        setResults({ register: outcome });
      } else {
        setResults((r) => ({ ...r, register: outcome }));
      }
    } else {
      if ((d.kind === "assertion" || d.kind === "refusal") && d.assertion) setSignCount(d.assertion.signCount);
      setResults((r) => ({ ...r, [test]: outcome }));
    }
    setLatest({ id, outcome });
    setRunning(null);
  };

  const status = (test: TestId): CardStatus => {
    if (running === test) return "waiting";
    const r = results[test];
    return r ? (r.passed ? "passed" : "failed") : "idle";
  };
  const passed = TESTS.filter((test) => results[test]?.passed).length;
  const visual: KeyVisualState = running ? "waiting" : latest ? (latest.outcome.passed ? "success" : "failed") : "idle";

  return (
    <Page width="flow">
      <div className="grid items-center gap-8 md:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-4">
          <PageHeader title={p.title} description={p.lead} />
          <Alert variant="info">
            <ShieldCheck aria-hidden />
            <AlertDescription>{p.localOnly}</AlertDescription>
          </Alert>
        </div>
        <KeyVisual state={visual} timeoutMs={running ? timeoutFor(running) : 0} runId={runId} refuse={running === "refusal"} />
      </div>

      {!supported ? (
        <Alert variant="warning" data-testid="not-supported">
          <TriangleAlert aria-hidden />
          <AlertTitle>{p.notSupported.title}</AlertTitle>
          <AlertDescription>{p.notSupported.text}</AlertDescription>
        </Alert>
      ) : (
        <>
          <section className="flex flex-col gap-3" aria-label={p.testsLabel}>
            <div className="flex items-center gap-3">
              <Progress value={(passed / TESTS.length) * 100} aria-label={p.scoreLabel} className="h-1.5" />
              <span className="text-sm font-medium whitespace-nowrap tabular-nums" data-testid="score">
                {p.score(passed, TESTS.length)}
              </span>
            </div>
            {passed === TESTS.length && (
              <Alert variant="success" className="enter-reveal" data-testid="all-passed">
                <ShieldCheck aria-hidden />
                <AlertTitle>{p.allPassed.title}</AlertTitle>
                <AlertDescription>{p.allPassed.text}</AlertDescription>
              </Alert>
            )}
            <ol className="flex flex-col gap-3">
              {TESTS.map((test, i) => (
                <li key={test}>
                  <TestCard
                    id={test}
                    n={i + 1}
                    icon={ICONS[test]}
                    status={status(test)}
                    hasRun={results[test] !== undefined}
                    locked={test !== "register" && !credential}
                    busy={running !== null}
                    onRun={() => void run(test)}
                  />
                </li>
              ))}
            </ol>
          </section>
          <Inspector latest={latest} />
        </>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{p.cleanup.title}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <p className="text-muted-foreground">{p.cleanup.intro}</p>
          <ul className="flex list-disc flex-col gap-1 pl-5">
            <li>{p.cleanup.windows(<strong>Windows:</strong>)}</li>
            <li>{p.cleanup.chrome(<strong>Chrome / Edge:</strong>)}</li>
            <li>
              {p.cleanup.cli(
                <code className={CODE} lang="en">
                  multikey fido credentials list
                </code>,
                <code className={CODE} lang="en">
                  multikey fido credentials delete --id &lt;id&gt;
                </code>,
              )}
            </li>
          </ul>
        </CardContent>
      </Card>
    </Page>
  );
}
