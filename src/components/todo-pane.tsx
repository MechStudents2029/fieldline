"use client";

import { useState, useTransition } from "react";
import {
  addTodoCheckAction,
  attachTodoFileAction,
  completeTodosAction,
  deleteTodoCheckAction,
  moveTodoCheckAction,
  reorderTodoChecksAction,
  saveTodoCheckAction,
  setTodoCheckAction,
} from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { FileButton } from "@/components/file-button";
import { formatCalendarDay } from "@/lib/format";
import type { TodoRow } from "@/lib/services/todos";

type Person = { id: string; name: string };

function assigneeValue(check: TodoRow["checks"][number]) {
  if (check.assigneeUserId) return `user:${check.assigneeUserId}`;
  if (check.assigneeContactId) return `vendor:${check.assigneeContactId}`;
  return "";
}

export function TodoPane({
  todo,
  phrase,
  users,
  vendors,
  canEdit,
  canTick,
}: {
  todo: TodoRow;
  phrase: string;
  users: Person[];
  vendors: Person[];
  canEdit: boolean;
  canTick: boolean;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function dropOn(targetId: string) {
    if (!canEdit || !dragId || dragId === targetId) return;
    const ids = todo.checks.map((row) => row.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    const next = [...ids];
    const [moved] = next.splice(from, 1);
    if (!moved) return;
    next.splice(to, 0, moved);
    setDragId(null);
    startTransition(() => {
      void reorderTodoChecksAction(todo.id, next);
    });
  }

  return (
    <aside className="flex w-full shrink-0 flex-col gap-3 border-t border-[var(--mac-separator)] bg-[var(--mac-window)] p-4 md:w-[360px] md:border-l md:border-t-0" aria-label="To-do" data-due={todo.dueAt || ""} data-status={todo.status}>
      <div className="flex items-start justify-between gap-2">
        <h2 className="mac-t15">{todo.title}</h2>
        {todo.progress ? <span className="num mac-t13 text-[var(--mac-secondary)]">{todo.progress}</span> : null}
      </div>
      <p className="mac-t13 text-[var(--mac-secondary)]">
        {[todo.projectName, todo.priority, phrase, todo.dueAt ? formatCalendarDay(todo.dueAt) : ""].filter(Boolean).join(" · ")}
      </p>
      {todo.tags ? <p className="mac-t11 text-[var(--mac-secondary)]">{todo.tags}</p> : null}
      {todo.notes ? <p className="mac-t13 whitespace-pre-wrap">{todo.notes}</p> : null}
      {todo.assignees.length ? <p className="mac-t13">{todo.assignees.map((person) => person.name).join(", ")}</p> : null}
      <ul className="flex flex-col">
        {todo.checks.map((check) => (
          <CheckRow
            key={check.id}
            todoId={todo.id}
            check={check}
            users={users}
            vendors={vendors}
            canEdit={canEdit}
            canTick={canTick}
            onDrop={() => dropOn(check.id)}
            onDragStart={() => setDragId(check.id)}
          />
        ))}
      </ul>
      {canEdit ? (
        <ActionForm action={addTodoCheckAction} className="flex gap-2">
          <input type="hidden" name="taskId" value={todo.id} />
          <input name="title" aria-label="New item" className="field min-w-0 flex-1" />
          <button type="submit" className="mac-t13">
            Add
          </button>
        </ActionForm>
      ) : null}
      {todo.offerDone && canTick ? (
        <ActionForm action={completeTodosAction}>
          <input type="hidden" name="taskId" value={todo.id} />
          <button type="submit" className="mac-primary">
            Mark to-do done
          </button>
        </ActionForm>
      ) : null}
      {todo.files.length ? (
        <ul className="mac-t11 text-[var(--mac-secondary)]">
          {todo.files.map((file) => (
            <li key={file.id}>{file.filename}</li>
          ))}
        </ul>
      ) : null}
      {canTick ? (
        <ActionForm action={attachTodoFileAction} className="flex flex-col gap-2">
          <input type="hidden" name="taskId" value={todo.id} />
          <FileButton name="photo" label="Photo" accept="image/jpeg,image/png,image/webp" empty="Photo" />
          <button type="submit" className="w-fit mac-t13">
            Attach
          </button>
        </ActionForm>
      ) : null}
    </aside>
  );
}

function CheckRow({
  todoId,
  check,
  users,
  vendors,
  canEdit,
  canTick,
  onDrop,
  onDragStart,
}: {
  todoId: string;
  check: TodoRow["checks"][number];
  users: Person[];
  vendors: Person[];
  canEdit: boolean;
  canTick: boolean;
  onDrop: () => void;
  onDragStart: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const due = check.dueAt ? formatCalendarDay(check.dueAt) : "";
  if (editing && canEdit) {
    return (
      <li className="border-b border-[var(--mac-separator)] py-1">
        <form
          className="flex flex-col gap-1"
          action={async (formData) => {
            await saveTodoCheckAction(formData);
            setEditing(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setEditing(false);
            }
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.requestSubmit();
            }
          }}
        >
          <input type="hidden" name="checkId" value={check.id} />
          <input name="title" aria-label="Item title" defaultValue={check.title} autoFocus className="field" />
          <select name="assignee" aria-label="Item assignee" defaultValue={assigneeValue(check)} className="field">
            <option value="">Unassigned</option>
            {users.map((person) => (
              <option key={person.id} value={`user:${person.id}`}>
                {person.name}
              </option>
            ))}
            {vendors.map((person) => (
              <option key={person.id} value={`vendor:${person.id}`}>
                {person.name}
              </option>
            ))}
          </select>
          <input name="dueAt" type="date" aria-label="Item due" defaultValue={check.dueAt || ""} className="field" />
        </form>
      </li>
    );
  }
  return (
    <li className="border-b border-[var(--mac-separator)]" onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
      <div className="flex items-center gap-2 py-1">
        {canEdit ? (
          <button type="button" draggable aria-label={`Drag ${check.title}`} className="cursor-grab text-[var(--mac-tertiary)]" onDragStart={onDragStart}>
            ⋮⋮
          </button>
        ) : null}
        {canTick ? (
          <form action={setTodoCheckAction.bind(null, check.id, check.status !== "done")}>
            <button type="submit" role="checkbox" aria-checked={check.status === "done"} aria-label={check.title} className="mac-t13">
              {check.status === "done" ? "☑" : "☐"}
            </button>
          </form>
        ) : (
          <span aria-hidden className="mac-t13">{check.status === "done" ? "☑" : "☐"}</span>
        )}
        <button type="button" className="min-w-0 flex-1 text-left" aria-label={canEdit ? `Edit ${check.title}` : undefined} onClick={() => canEdit && setEditing(true)} disabled={!canEdit}>
          <span className="block truncate mac-t13">{check.title}</span>
          {check.assigneeName || due ? <span className="block truncate mac-t11 text-[var(--mac-secondary)]">{[check.assigneeName, due].filter(Boolean).join(" · ")}</span> : null}
        </button>
        {canEdit ? (
          <details className="list-pop">
            <summary aria-label={`Menu ${check.title}`} role="button">⋯</summary>
            <div className="list-menu">
              <form action={moveTodoCheckAction.bind(null, todoId, check.id, "up")}>
                <button type="submit">Move up</button>
              </form>
              <form action={moveTodoCheckAction.bind(null, todoId, check.id, "down")}>
                <button type="submit">Move down</button>
              </form>
              <form action={deleteTodoCheckAction.bind(null, check.id)}>
                <button type="submit">Delete</button>
              </form>
            </div>
          </details>
        ) : null}
      </div>
    </li>
  );
}
