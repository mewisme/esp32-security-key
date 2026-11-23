import { Monitor, Moon, Sun } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/i18n/context";
import { useChangedSinceMount } from "@/hooks/useChangedSinceMount";
import { applyTheme, storedTheme, type ThemeChoice } from "@/lib/theme";

export function ThemeToggle() {
  const { t } = useI18n();
  const [choice, setChoice] = useState<ThemeChoice>(storedTheme);
  // The icon turns into the new one (a plain fade under reduced motion); at page load it is simply there.
  const swapped = useChangedSinceMount(choice);
  const Icon = choice === "dark" ? Moon : choice === "light" ? Sun : Monitor;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="icon" aria-label={t.layout.theme.label} data-testid="theme-toggle">
          <Icon
            key={choice}
            aria-hidden
            className={swapped ? "animate-in fade-in-0 duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-safe:-spin-in-45" : undefined}
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={choice}
          onValueChange={(v) => {
            const c = v as ThemeChoice;
            setChoice(c);
            applyTheme(c);
          }}
        >
          <DropdownMenuRadioItem value="light">{t.layout.theme.light}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">{t.layout.theme.dark}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">{t.layout.theme.system}</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
