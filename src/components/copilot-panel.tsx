"use client";

import { useState } from "react";
import { askAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/money";

type Answer = {
  tool: string | null;
  answer: string;
  rows: { label: string; amountCents: number | null; detail: string }[];
};

const prompts = ["Who owes me money?", "Which jobs are under 20% margin?", "What's my pipeline value?", "Which proposals are unsigned?"];

export function CopilotPanel() {
  const [question, setQuestion] = useState(prompts[0]);
  const [result, setResult] = useState<Answer | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask(text: string) {
    setPending(true);
    setError(null);
    try {
      setResult(await askAction(text));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Copilot failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {prompts.map((prompt) => (
          <button key={prompt} type="button" onClick={() => { setQuestion(prompt); void ask(prompt); }} className="rounded-full bg-muted px-3 py-2 text-left text-xs">
            {prompt}
          </button>
        ))}
      </div>
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
          void ask(question);
        }}
      >
        <input className="field" value={question} onChange={(event) => setQuestion(event.target.value)} aria-label="Ask your business" />
        <Button type="submit" className="h-11" disabled={pending}>
          {pending ? "Looking…" : "Ask"}
        </Button>
      </form>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {result ? (
        <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{result.tool ?? "no tool"}</p>
          <p className="mt-1 font-heading text-2xl">{result.answer}</p>
          <ul className="mt-4 divide-y divide-border">
            {result.rows.map((row) => (
              <li key={`${row.label}-${row.detail}`} className="flex items-start justify-between gap-3 py-2 text-sm">
                <span>
                  <span className="font-medium">{row.label}</span>
                  <span className="block text-xs text-muted-foreground">{row.detail}</span>
                </span>
                <span>{row.amountCents == null ? "—" : formatMoney(row.amountCents)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="text-sm text-muted-foreground">Answers use the same numbers as the rest of the app. This version is read-only.</p>
      )}
    </div>
  );
}
