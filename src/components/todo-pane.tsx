"use client";

import { useState, useTransition } from "react";
import {
  addTodoCheckAction,
  attachTodoFileAction,
  completeTodosAction,
  deleteTodoCheckAction,
  moveTodoCheckAction,
  renameTodoCheckAction,
  reorderTodoChecksAction,
  setTodoCheckAction,
  updateTodoCheckAction,
} from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import type { TodoRow } from "@/lib/services/todos";

type Person = { id: string; name: string };

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
        {[todo.projectName, todo.priority, phrase, todo.dueAt].filter(Boolean).join(" · ")}
      </p>
      {todo.tags ? <p className="mac-t11 text-[var(--mac-secondary)]">{todo.tags}</p> : null}
      {todo.notes ? <p className="mac-t13 whitespace-pre-wrap">{todo.notes}</p> : null}
      {todo.assignees.length ? <p className="mac-t13">{todo.assignees.map((person) => person.name).join(", ")}</p> : null}
      <ul className="flex flex-col gap-2">
        {todo.checks.map((check) => (
          <li
            key={check.id}
            className="flex flex-col gap-1 rounded-md border border-[var(--mac-separator)] p-2"
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => dropOn(check.id)}
          >
            <div className="flex items-center gap-2">
              {canEdit ? (
                <button
                  type="button"
                  draggable
                  aria-label={`Drag ${check.title}`}
                  className="cursor-grab text-[var(--mac-tertiary)]"
                  onDragStart={() => setDragId(check.id)}
                >
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
                <span className="mac-t13">{check.status === "done" ? "☑" : "☐"} {check.title}</span>
              )}
              {canTick ? <span className="min-w-0 flex-1 truncate mac-t13">{check.title}</span> : null}
              {canEdit ? (
                <span className="flex gap-1">
                  <form action={moveTodoCheckAction.bind(null, todo.id, check.id, "up")}>
                    <button type="submit" aria-label={`Up ${check.title}`} className="mac-t11 text-[var(--mac-secondary)]">
                      Up
                    </button>
                  </form>
                  <form action={moveTodoCheckAction.bind(null, todo.id, check.id, "down")}>
                    <button type="submit" aria-label={`Down ${check.title}`} className="mac-t11 text-[var(--mac-secondary)]">
                      Down
                    </button>
                  </form>
                  <form action={deleteTodoCheckAction.bind(null, check.id)}>
                    <button type="submit" aria-label={`Delete ${check.title}`} className="mac-t11 text-[var(--mac-secondary)]">
                      Delete
                    </button>
                  </form>
                </span>
              ) : null}
            </div>
            {check.assigneeName || check.dueAt ? (
              <p className="mac-t11 text-[var(--mac-secondary)]">{[check.assigneeName, check.dueAt].filter(Boolean).join(" · ")}</p>
            ) : null}
            {canEdit ? (
              <ActionForm action={renameTodoCheckAction} className="flex gap-1">
                <input type="hidden" name="checkId" value={check.id} />
                <input name="title" aria-label={`Rename ${check.title}`} defaultValue={check.title} className="field min-w-0 flex-1" />
                <button type="submit" className="mac-t11">
                  Save
                </button>
              </ActionForm>
            ) : null}
            {canEdit ? (
              <ActionForm action={updateTodoCheckAction} className="flex gap-1">
                <input type="hidden" name="checkId" value={check.id} />
                <select name="assignee" aria-label={`Assignee ${check.title}`} defaultValue={check.assigneeUserId ? `user:${check.assigneeUserId}` : check.assigneeContactId ? `vendor:${check.assigneeContactId}` : ""} className="field min-w-0 flex-1">
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
                <input name="dueAt" type="date" aria-label={`Due ${check.title}`} defaultValue={check.dueAt || ""} className="field" />
                <button type="submit" className="mac-t11">
                  Set
                </button>
              </ActionForm>
            ) : null}
          </li>
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
          <label className="mac-t13">
            Photo
            <input name="photo" type="file" accept="image/jpeg,image/png,image/webp" aria-label="Photo" className="mt-1 block w-full text-[13px]" />
          </label>
          <button type="submit" className="w-fit mac-t13">
            Attach
          </button>
        </ActionForm>
      ) : null}
    </aside>
  );
}
