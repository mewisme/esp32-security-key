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
import { applyTheme, storedTheme, type ThemeChoice } from "@/lib/theme";

export function ThemeToggle() {
  const { t } = useI18n();
  const [choice, setChoice] = useState<ThemeChoice>(storedTheme);
  const Icon = choice === "dark" ? Moon : choice === "light" ? Sun : Monitor;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="icon" aria-label={t.layout.theme.label} data-testid="theme-toggle">
          <Icon aria-hidden />
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
