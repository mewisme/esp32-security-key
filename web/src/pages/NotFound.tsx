import { Link } from "react-router";
import { Page } from "@/components/layout/Page";
import { Button } from "@/components/ui/button";

export function NotFoundPage() {
  return (
    <Page width="flow" className="items-center text-center">
      <h1 className="text-3xl font-semibold">Page not found</h1>
      <p className="text-muted-foreground">That address doesn't exist on this site.</p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button asChild>
          <Link to="/">Go home</Link>
        </Button>
        <Button asChild variant="outline">
          <Link to="/install">Install</Link>
        </Button>
      </div>
    </Page>
  );
}
