"use client";

import { usePathname } from "next/navigation";
import { feedbackAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export function FeedbackDialog() {
  const pathname = usePathname();
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" className="h-11" aria-label="Send feedback">
          Send feedback
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send feedback</DialogTitle>
          <DialogDescription>Saved on this company. Nothing is emailed, and there is no screenshot.</DialogDescription>
        </DialogHeader>
        <ActionForm action={feedbackAction} className="flex flex-col gap-3">
          <input type="hidden" name="path" value={pathname || "/"} />
          <label className="text-sm">
            What happened
            <textarea name="body" required rows={4} aria-label="Feedback" className="mt-1 w-full rounded-lg border border-input bg-background p-3" placeholder="The sign button did not respond after I checked consent." />
          </label>
          <label className="text-sm">
            Context, optional
            <input name="context" aria-label="Feedback context" className="field mt-1" placeholder="Phone, what you expected" />
          </label>
          <Button type="submit" className="h-11">
            Save feedback
          </Button>
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}
