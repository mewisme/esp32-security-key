import { Link } from "react-router";
import { Button } from "@/components/ui/button";

export function NotFoundPage() {
  return (
    <div className="mx-auto max-w-xl space-y-4 px-4 py-20 text-center">
      <h1 className="text-3xl font-semibold">Page not found</h1>
      <Button asChild>
        <Link to="/">Go to the home page</Link>
      </Button>
    </div>
  );
}
