import { Link } from "react-router";
import { Page } from "@/components/layout/Page";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/context";

export function NotFoundPage() {
  const { t } = useI18n();
  return (
    <Page width="flow" className="items-center text-center">
      <h1 className="text-3xl font-semibold">{t.notFound.title}</h1>
      <p className="text-muted-foreground">{t.notFound.text}</p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button asChild>
          <Link to="/">{t.notFound.home}</Link>
        </Button>
        <Button asChild variant="outline">
          <Link to="/install">{t.layout.nav.install}</Link>
        </Button>
      </div>
    </Page>
  );
}
