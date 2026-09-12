import { Download, Share, Plus, Check } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { usePwaInstall } from "@/hooks/use-pwa-install";
import { cn } from "@/lib/utils";

export function InstallAppButton({ className }: { className?: string }) {
  const { canShowCta, canPromptNatively, platform, promptInstall, dismiss } = usePwaInstall();
  const [helpOpen, setHelpOpen] = useState(false);

  if (!canShowCta) return null;

  const handleClick = async () => {
    if (canPromptNatively) {
      const outcome = await promptInstall();
      if (outcome === "accepted") {
        toast.success("Installing Redirect Chain Analyzer", {
          description: "You'll find it on your home screen in a moment.",
        });
      }
      if (outcome === "unavailable") setHelpOpen(true);
      return;
    }
    setHelpOpen(true);
  };

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={handleClick}
            aria-label="Install Redirect Chain Analyzer"
            className={cn(
              "group inline-flex h-8 min-h-8 shrink-0 items-center gap-1.5 rounded-full border border-hairline bg-surface/80 px-2.5 text-[11.5px] font-semibold text-foreground shadow-soft transition-all duration-200 [transition-timing-function:var(--ease-premium)] hover:border-brand/40 hover:text-brand active:scale-[0.97] sm:px-3",
              className,
            )}
          >
            <Download className="size-3.5 transition-transform duration-300 group-hover:translate-y-[1px]" />
            <span className="hidden sm:inline">Install app</span>
          </button>
        </TooltipTrigger>
        <TooltipContent>Install Redirect Chain Analyzer for faster access.</TooltipContent>
      </Tooltip>

      <Dialog
        open={helpOpen}
        onOpenChange={(open) => {
          setHelpOpen(open);
          if (!open && !canPromptNatively) dismiss();
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Add to Home Screen</DialogTitle>
            <DialogDescription>
              Install Redirect Chain Analyzer for faster access — it opens full screen, without
              browser chrome.
            </DialogDescription>
          </DialogHeader>

          {platform === "ios" ? (
            <ol className="space-y-2.5 text-sm text-muted-foreground">
              <li className="flex items-start gap-2">
                <Share className="mt-0.5 size-4 shrink-0 text-brand" />
                Tap the Share button in the Safari toolbar.
              </li>
              <li className="flex items-start gap-2">
                <Plus className="mt-0.5 size-4 shrink-0 text-brand" />
                Choose “Add to Home Screen”.
              </li>
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 size-4 shrink-0 text-brand" />
                Tap “Add” — the CrosX icon appears on your home screen.
              </li>
            </ol>
          ) : (
            <ol className="space-y-2.5 text-sm text-muted-foreground">
              <li className="flex items-start gap-2">
                <Plus className="mt-0.5 size-4 shrink-0 text-brand" />
                Open your browser menu (⋮ on Android Chrome, the address-bar install icon on
                desktop).
              </li>
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 size-4 shrink-0 text-brand" />
                Choose “Install app” or “Add to Home screen” and confirm.
              </li>
            </ol>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
