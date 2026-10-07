"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { FileButton } from "@/components/file-button";
import type { ActionState } from "@/app/actions";

const ROLES = [
  { id: "office", name: "Office" },
  { id: "field", name: "Field" },
  { id: "admins", name: "Admins" },
];

export function CommentComposer({
  action,
  people,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  people: { id: string; name: string }[];
}) {
  const box = useRef<HTMLTextAreaElement>(null);
  const [body, setBody] = useState("");
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [state, formAction, pending] = useActionState(action, null);
  useEffect(() => {
    if (state?.ok) setBody("");
  }, [state]);
  const options = [...people.map((person) => ({ id: person.id, name: person.name })), ...ROLES].filter((option) =>
    query == null ? false : option.name.toLowerCase().includes(query.toLowerCase()),
  );

  function sync(value: string, cursor: number) {
    setBody(value);
    const match = value.slice(0, cursor).match(/(^|\s)@([^\n@]*)$/);
    setQuery(match ? match[2] ?? "" : null);
    setActive(0);
  }

  function insert(name: string) {
    const field = box.current;
    const cursor = field?.selectionStart ?? body.length;
    const upto = body.slice(0, cursor);
    const match = upto.match(/(^|\s)@([^\n@]*)$/);
    if (!match) return;
    const start = cursor - (match[2]?.length ?? 0) - 1;
    const next = `${body.slice(0, start)}@${name} ${body.slice(cursor)}`;
    setBody(next);
    setQuery(null);
    requestAnimationFrame(() => {
      const point = start + name.length + 2;
      field?.focus();
      field?.setSelectionRange(point, point);
    });
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (query == null || options.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((value) => (value + 1) % options.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((value) => (value - 1 + options.length) % options.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const option = options[active];
      if (option) insert(option.name);
    } else if (event.key === "Escape") {
      setQuery(null);
    }
  }

  return (
    <form action={formAction} className="mt-3 grid gap-2" aria-busy={pending}>
      <label className="text-sm">
        Comment
        <textarea
          ref={box}
          name="body"
          aria-label="Comment"
          rows={2}
          value={body}
          className="field mt-1"
          onChange={(event) => sync(event.target.value, event.target.selectionStart)}
          onKeyDown={onKeyDown}
        />
      </label>
      {query != null && options.length > 0 ? (
        <ul role="listbox" aria-label="Mention" className="mac-box overflow-hidden">
          {options.map((option, index) => (
            <li key={option.id} role="option" aria-selected={index === active}>
              <button type="button" className={`block w-full px-3 py-1.5 text-left mac-t13 ${index === active ? "bg-[var(--mac-fill)]" : ""}`} onMouseDown={(event) => event.preventDefault()} onClick={() => insert(option.name)}>
                {option.name}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <FileButton name="photo" label="Comment photo" accept="image/jpeg,image/png,image/webp" empty="Photo" />
        <button type="submit" className="mac-primary">
          Post
        </button>
      </div>
      {state?.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
      {state?.ok ? (
        <p role="status" className="text-sm text-pine">
          {state.ok}
        </p>
      ) : null}
    </form>
  );
}
