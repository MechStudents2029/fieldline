"use client";

import { useActionState } from "react";
import { confirmReceiptAction, receiptAction, type ActionState } from "@/app/actions";
import { FileButton } from "@/components/file-button";
import { Button } from "@/components/ui/button";
import { RECEIPT_REVIEW_CONFIDENCE } from "@/lib/ai/receipt";
import { formatMoney } from "@/lib/money";

export function ReceiptCapture({ projectId, codes, allowPost = true }: { projectId: string; codes: string[]; allowPost?: boolean }) {
  const [read, readAction, reading] = useActionState(receiptAction.bind(null, projectId), null as ActionState);
  const [posted, postAction, posting] = useActionState(confirmReceiptAction.bind(null, projectId), null as ActionState);
  const draft = read?.receipt && read.receipt.documentId !== posted?.postedDocumentId ? read.receipt : null;
  const low = draft != null && draft.confidence < RECEIPT_REVIEW_CONFIDENCE;

  return (
    <div className="mt-4 flex flex-col gap-3 border-t border-border pt-3">
      <form action={readAction} className="flex flex-col gap-2" aria-busy={reading}>
        <p className="text-sm font-medium">Receipt</p>
        <p className="text-xs text-muted-foreground">Paste the receipt text, upload a .txt file, or pick a sample. Nothing posts until you confirm.</p>
        <textarea name="text" rows={3} placeholder="Paste receipt text" className="field" />
        <FileButton name="file" label="Upload a text receipt" accept=".txt,.csv,.json,text/plain" empty="File" />
        <label className="text-sm">
          Or use a sample
          <select name="sample" className="field mt-1" defaultValue="">
            <option value="">Upload or paste instead</option>
            <option value="casa-tile.svg">{allowPost ? "Casa Tile · $864.50" : "Casa Tile sample"}</option>
            <option value="harbor-plumbing.svg">{allowPost ? "Harbor Plumbing · $426.00" : "Harbor Plumbing sample"}</option>
            <option value="summit-lumber.svg">{allowPost ? "Summit Lumber · $18,425.00" : "Summit Lumber sample"}</option>
          </select>
        </label>
        <Button type="submit" variant="outline" className="h-11">
          Read receipt
        </Button>
        {reading ? <p className="text-xs text-muted-foreground">Working…</p> : null}
        {read?.error ? (
          <p role="alert" className="text-sm text-destructive">
            {read.error}
          </p>
        ) : null}
      </form>
      {draft && !allowPost ? (
        <p role="status" className="text-sm">
          Saved on the job. An office person posts the cost.
        </p>
      ) : null}
      {draft && allowPost ? (
        <form key={draft.documentId} action={postAction} className="grid gap-2 rounded-lg bg-accent/40 p-3 sm:grid-cols-2" aria-busy={posting}>
          <p className="text-sm font-medium sm:col-span-2">Review before posting</p>
          <p className={`text-xs sm:col-span-2 ${low ? "text-copper" : "text-muted-foreground"}`}>
            {Math.round(draft.confidence * 100)}% confidence. {draft.note}
          </p>
          <label className="text-sm">
            Vendor
            <input name="vendor" defaultValue={draft.vendor} className="field mt-1" required />
          </label>
          <label className="text-sm">
            Amount
            <input name="amount" defaultValue={draft.amount} inputMode="decimal" className="field mt-1" required />
          </label>
          <label className="text-sm">
            Purchase date
            <input name="purchasedOn" type="date" defaultValue={draft.purchasedOn} className="field mt-1" />
          </label>
          <label className="text-sm">
            Cost code
            <input name="costCode" list={`codes-${projectId}`} defaultValue={draft.costCode} className="field mt-1" />
          </label>
          <datalist id={`codes-${projectId}`}>
            {codes.map((code) => (
              <option key={code} value={code} />
            ))}
          </datalist>
          <p className="text-xs text-muted-foreground sm:col-span-2">{draft.suggestionNote}</p>
          {draft.lines.length > 0 ? (
            <ul className="space-y-1 text-sm sm:col-span-2">
              {draft.lines.map((line) => (
                <li key={`${line.description}-${line.amountCents ?? "x"}`} className="flex justify-between gap-2">
                  <span>{line.description}</span>
                  <span>{line.amountCents == null ? "" : formatMoney(line.amountCents)}</span>
                </li>
              ))}
            </ul>
          ) : null}
          <input type="hidden" name="documentId" value={draft.documentId} />
          <input type="hidden" name="lines" value={draft.lines.map((line) => line.description).join(", ")} />
          <Button type="submit" className="h-11 sm:col-span-2">
            Post this cost
          </Button>
          {posting ? <p className="text-xs text-muted-foreground sm:col-span-2">Working…</p> : null}
          {posted?.error ? (
            <p role="alert" className="text-sm text-destructive sm:col-span-2">
              {posted.error}
            </p>
          ) : null}
        </form>
      ) : null}
      {draft && read?.ok ? (
        <p role="status" className="text-sm text-pine">
          {read.ok}
        </p>
      ) : null}
      {posted?.ok ? (
        <p role="status" className="text-sm text-pine">
          {posted.ok}
        </p>
      ) : null}
    </div>
  );
}
