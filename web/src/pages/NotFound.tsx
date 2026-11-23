import { Link } from "react-router";
import { Page } from "@/components/layout/Page";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/context";

export function NotFoundPage() {
  const { t } = useI18n();
  return (
    <Page width="flow">
      <PageHeader
        title={t.notFound.title}
        description={t.notFound.text}
        actions={
          <>
            <Button asChild>
              <Link to="/">{t.notFound.home}</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/install">{t.layout.nav.install}</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/help">{t.notFound.help}</Link>
            </Button>
          </>
        }
      />
    </Page>
  );
}
