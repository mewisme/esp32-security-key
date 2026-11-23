import { Minus, TriangleAlert, X } from "lucide-react";
import { useEffect, useState } from "react";
import { DrawnCheck } from "@/components/common/DrawnCheck";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "@/i18n/context";
import type { AuthFlags } from "@/lib/passkey/authdata";
import { toHex } from "@/lib/passkey/bytes";
import type { LabCheck } from "@/lib/passkey/lab";
import type { Outcome } from "@/lib/passkey/tests";
import { FlagStrip } from "./FlagStrip";

/** The latest result with the number of the run that made it, so a new run replays the reveal. */
export interface Latest {
  id: number;
  outcome: Outcome;
}

interface Report {
  flags: AuthFlags;
  signCount: number;
  credentialId: Uint8Array;
  checks: LabCheck[];
  /** Only a registration knows these. */
  aaguid?: string;
  transports?: string[];
  discoverable?: boolean | null;
}

function reportOf(outcome: Outcome): Report | null {
  const d = outcome.detail;
  if (d.kind === "register") {
    const c = d.credential;
    return { flags: c.flags, signCount: c.signCount, credentialId: c.id, checks: c.checks, aaguid: c.aaguid, transports: c.transports, discoverable: c.discoverable };
  }
  if (d.kind === "error") return null;
  const assertion = d.assertion;
  if (!assertion) return null;
  return { flags: assertion.flags, signCount: assertion.signCount, credentialId: assertion.credentialId, checks: assertion.checks };
}

function CredentialId({ id }: { id: Uint8Array }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const hex = toHex(id);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <span className="flex flex-wrap items-center gap-2">
      <code className="font-mono text-xs" lang="en" title={hex} data-testid="credential-id">
        {hex.length > 16 ? `${hex.slice(0, 16)}…` : hex}
      </code>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label={t.passkeyLab.inspector.copy}
        onClick={() => {
          void navigator.clipboard.writeText(hex).then(() => setCopied(true));
        }}
      >
        {copied ? (
          <span className="enter-reveal inline-flex items-center gap-1">
            <DrawnCheck className="size-3.5" />
            {t.passkeyLab.inspector.copied}
          </span>
        ) : (
          t.releases.copy
        )}
      </Button>
    </span>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="contents">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function CheckIcon({ ok }: { ok: boolean | null }) {
  if (ok === true) return <DrawnCheck ring className="size-4 text-success" />;
  if (ok === false) return <X className="size-4 shrink-0 text-destructive" aria-hidden />;
  return <Minus className="size-4 shrink-0 text-muted-foreground" aria-hidden />;
}

function Details({ report }: { report: Report }) {
  const { t } = useI18n();
  const p = t.passkeyLab;
  const i = p.inspector;
  const tri = (v: boolean | null | undefined) => (v === true ? i.yes : v === false ? i.no : i.unknown);
  return (
    <>
      <FlagStrip flags={report.flags} />
      <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-6 gap-y-2 text-sm">
        {report.aaguid !== undefined && (
          <Row label={i.aaguid}>
            <code className="font-mono text-xs break-all" lang="en">
              {report.aaguid}
            </code>
          </Row>
        )}
        <Row label={i.algorithm}>
          <span lang="en">ES256 (-7)</span>
        </Row>
        <Row label={i.counter}>
          <span className="tabular-nums" data-testid="sign-count">
            {report.signCount}
          </span>
        </Row>
        {report.transports !== undefined && <Row label={i.transports}>{report.transports.length ? <span lang="en">{report.transports.join(", ")}</span> : i.none}</Row>}
        <Row label={i.credentialId}>
          <CredentialId id={report.credentialId} />
        </Row>
        {report.discoverable !== undefined && <Row label={i.discoverable}>{tri(report.discoverable)}</Row>}
      </dl>
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">{i.checksLabel}</h3>
        <ul className="flex flex-col gap-1.5 text-sm">
          {report.checks.map((c) => (
            <li key={c.id} className="flex items-center gap-2" data-testid={`check-${c.id}`} data-ok={String(c.ok)}>
              <CheckIcon ok={c.ok} />
              {p.checks[c.id]}
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

/** What the key reported in the latest test: flags, the credential's facts, every check, or the error that stopped it. */
export function Inspector({ latest }: { latest: Latest | null }) {
  const { t } = useI18n();
  const p = t.passkeyLab;
  const outcome = latest?.outcome;
  const report = outcome ? reportOf(outcome) : null;
  const error = outcome?.detail.kind === "error" ? p.errors[outcome.detail.error] : null;
  return (
    <Card data-testid="inspector">
      <CardHeader>
        <CardTitle>{p.inspector.title}</CardTitle>
      </CardHeader>
      <CardContent>
        {!latest || !outcome ? (
          <p className="text-sm text-muted-foreground">{p.inspector.empty}</p>
        ) : (
          <div key={latest.id} className="enter-reveal flex flex-col gap-4" data-testid="inspector-result" data-test={outcome.test} data-passed={String(outcome.passed)}>
            {error && (
              <div className="flex flex-col gap-2" data-testid="inspector-error">
                <p className="flex items-center gap-2 font-medium">
                  <TriangleAlert className="size-4 text-warning" aria-hidden />
                  {error.title}
                </p>
                <p className="text-sm text-muted-foreground">{error.what}</p>
                <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
                  {error.next.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ul>
              </div>
            )}
            {outcome.detail.kind === "refusal" && (
              <p className="flex items-center gap-2 text-sm font-medium" data-testid="refusal-result">
                {outcome.passed ? <DrawnCheck ring className="size-4 text-success" /> : <X className="size-4 shrink-0 text-destructive" aria-hidden />}
                {outcome.passed ? p.refusal.passed : p.refusal.failed}
              </p>
            )}
            {report && <Details report={report} />}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
