import { createLeadAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";

const SAMPLE =
  "Elena Vasquez, 240 sq ft kitchen, gut, new cabinets, quartz, 14 linear ft of base cabinets. Relocate the sink. Paint. Recessed lights. Budget $60–80k. 240 Hillcrest Ave, Oakland.";

export default function NewLeadPage() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <h1 className="font-heading text-3xl">New lead</h1>
      <p className="text-sm text-muted-foreground">
        Paste a text, email, or voicemail. Fieldline pulls the name, area, and budget, then files a contact and a deal.
      </p>
      <ActionForm action={createLeadAction} className="flex flex-col gap-3">
        <label className="text-sm">
          Scope
          <textarea name="scope" required defaultValue={SAMPLE} rows={8} className="mt-1 w-full rounded-lg border border-input bg-card p-3" />
        </label>
        <label className="text-sm">
          Source
          <select name="source" className="field mt-1" defaultValue="referral">
            {["referral", "website", "yard sign", "home show", "repeat", "google", "neighbor", "angi", "manual"].map((source) => (
              <option key={source}>{source}</option>
            ))}
          </select>
        </label>
        <Button type="submit" className="h-11">
          Create lead
        </Button>
      </ActionForm>
    </div>
  );
}
