import { KeyRound } from "lucide-react";
import { ActivityCard } from "@/components/key-info/ActivityCard";
import { FirmwareCard } from "@/components/key-info/FirmwareCard";
import { Page } from "@/components/layout/Page";
import { PageHeader } from "@/components/layout/PageHeader";
import { Alert, AlertDescription } from "@/components/reui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useCatalog } from "@/hooks/useCatalog";
import { useKeyDevice } from "@/hooks/useKeyDevice";
import { useI18n } from "@/i18n/context";

/** Read-only: what firmware the key runs and what its passkeys are doing, as the key itself reports it. */
export function KeyInfoPage() {
  const { t } = useI18n();
  const k = t.keyInfo;
  const key = useKeyDevice();
  const catalog = useCatalog();
  const connected = key.connect.status === "connected";
  return (
    <Page width="flow">
      <PageHeader title={k.title} description={k.intro} />
      {!key.supported && (
        <Alert variant="warning">
          <AlertDescription>{k.unsupported}</AlertDescription>
        </Alert>
      )}
      <Card>
        <CardHeader>
          <CardTitle>{k.connect.title}</CardTitle>
          <CardDescription>{k.connect.description}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2" aria-live="polite">
          {key.connect.status === "connected" && (
            <p className="text-sm" data-testid="connected">
              {k.connect.connected(key.connect.identity?.productName ?? "?")}
            </p>
          )}
          {key.connect.status === "not-chosen" && <p className="text-sm">{k.connect.notChosen}</p>}
        </CardContent>
        <CardFooter className="flex flex-wrap gap-2">
          {connected ? (
            <Button type="button" variant="outline" onClick={() => void key.disconnect()}>
              {k.connect.disconnect}
            </Button>
          ) : (
            <Button type="button" disabled={!key.supported || key.connect.status === "connecting"} onClick={() => void key.connectKey()}>
              <KeyRound aria-hidden /> {key.connect.status === "connecting" ? k.connect.connecting : k.connect.button}
            </Button>
          )}
        </CardFooter>
      </Card>
      {connected && <FirmwareCard build={key.build} catalog={catalog} onReadAgain={() => void key.readAgain()} />}
      {connected && <ActivityCard feed={key.feed} watch={key.watch} onStart={key.startWatching} onStop={key.stopWatching} />}
    </Page>
  );
}
