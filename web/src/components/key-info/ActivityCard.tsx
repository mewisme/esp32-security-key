import { Hand, KeyRound, LogIn, TriangleAlert } from "lucide-react";
import { Spinner } from "@/components/common/Spinner";
import { Alert, AlertDescription } from "@/components/reui/alert";
import { Badge } from "@/components/reui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { FeedItem, WatchState } from "@/hooks/useKeyDevice";
import { useI18n } from "@/i18n/context";
import { INTL_LOCALE } from "@/i18n/locale";
import type { Messages } from "@/i18n/messages/en";
import { algorithmName, ctapErrorName, type KeyEvent, userPresent, userVerified } from "@/lib/device/key-events";

type Activity = Messages["keyInfo"]["activity"];

function sentence(e: KeyEvent, a: Activity): string {
  const site = e.rpId ?? a.unknownSite;
  switch (e.op) {
    case "make-credential":
      return e.result === "error" ? a.failedCreate(site) : a.created(site);
    case "get-assertion":
      if (e.result === "error") return a.failedSignIn(site);
      // The lookup a browser makes before asking for a touch (up=false) is reported as an ok sign-in without presence.
      return userPresent(e) === false ? a.lookedUp(site) : a.signedIn(site);
    case "user-presence":
      return e.operation === "make-credential" ? a.waitCreate(site) : e.operation === "get-assertion" ? a.waitSignIn(site) : a.waitOther(site);
    default:
      return e.result === "error" ? a.failedOther(site) : a.waitOther(site);
  }
}

function Icon({ e }: { e: KeyEvent }) {
  if (e.result === "error") return <TriangleAlert className="size-4 text-destructive" aria-hidden />;
  if (e.op === "make-credential") return <KeyRound className="size-4 text-primary" aria-hidden />;
  if (e.op === "get-assertion") return <LogIn className="size-4 text-primary" aria-hidden />;
  return <Hand className="size-4 text-muted-foreground" aria-hidden />;
}

function Row({ item }: { item: FeedItem }) {
  const { t, locale } = useI18n();
  const a = t.keyInfo.activity;
  const e = item.event;
  const present = userPresent(e);
  const verified = userVerified(e);
  const alg = e.algorithm === undefined ? null : (algorithmName(e.algorithm) ?? `COSE ${e.algorithm}`);
  const who = e.userDisplayName && e.userDisplayName !== e.userName ? `${e.userName ?? ""} (${e.userDisplayName})` : (e.userName ?? e.userDisplayName);
  return (
    <li className="flex items-start gap-3 py-3" data-testid="activity-item">
      <span className="mt-0.5">
        <Icon e={e} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-sm font-medium break-words">{sentence(e, a)}</p>
        {who && <p className="text-sm text-muted-foreground break-words">{a.account(who.trim())}</p>}
        <div className="flex flex-wrap items-center gap-1.5">
          {present !== undefined && <Badge variant={present ? "success-light" : "warning-light"}>{present ? a.buttonPressed : a.noButton}</Badge>}
          {verified && <Badge variant="outline">{a.userVerified}</Badge>}
          {alg && (
            <Badge variant="outline" lang="en">
              {alg}
            </Badge>
          )}
          {e.credentialCount !== undefined && e.credentialCount > 1 && <Badge variant="outline">{a.matched(e.credentialCount)}</Badge>}
          {e.result === "error" && e.error !== undefined && (
            <Badge variant="destructive-light" lang="en">
              {ctapErrorName(e.error) ?? `0x${e.error.toString(16)}`}
            </Badge>
          )}
        </div>
      </div>
      {!item.backlog && (
        <time className="shrink-0 text-xs text-muted-foreground tabular-nums" dateTime={new Date(item.receivedAt).toISOString()}>
          {new Date(item.receivedAt).toLocaleTimeString(INTL_LOCALE[locale])}
        </time>
      )}
    </li>
  );
}

function Group({ title, note, items }: { title: string; note?: string; items: FeedItem[] }) {
  if (items.length === 0) return null;
  return (
    <section className="flex flex-col gap-1" aria-label={title}>
      <h3 className="text-sm font-medium">{title}</h3>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
      <ul className="divide-y">
        {items.map((i) => (
          <Row key={i.id} item={i} />
        ))}
      </ul>
    </section>
  );
}

export function ActivityCard({ feed, watch, onStart, onStop }: { feed: FeedItem[]; watch: WatchState; onStart: () => void; onStop: () => void }) {
  const { t } = useI18n();
  const a = t.keyInfo.activity;
  const earlier = feed.filter((i) => i.backlog);
  const live = feed.filter((i) => !i.backlog).reverse();
  return (
    <Card data-testid="activity-card">
      <CardHeader>
        <CardTitle>{a.title}</CardTitle>
        <CardDescription>{a.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          {watch === "watching" ? (
            <Button type="button" variant="outline" onClick={onStop}>
              {a.stop}
            </Button>
          ) : (
            <Button type="button" onClick={onStart}>
              {a.start}
            </Button>
          )}
          <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            {watch === "watching" ? (
              <>
                <Spinner className="size-4" />
                {a.watching}
              </>
            ) : (
              a.idle
            )}
          </p>
        </div>
        {watch === "stopped" && (
          <Alert variant="warning" role="alert">
            <TriangleAlert aria-hidden />
            <AlertDescription>{a.watchStopped}</AlertDescription>
          </Alert>
        )}
        {feed.length === 0 && watch === "watching" && <p className="text-sm text-muted-foreground">{a.empty}</p>}
        <div className="flex flex-col gap-4" aria-live="polite">
          <Group title={a.liveTitle} items={live} />
          <Group title={a.earlierTitle} note={a.earlierNote} items={earlier} />
        </div>
      </CardContent>
    </Card>
  );
}
