"use client";

import { useActionState } from "react";
import type { ActionState } from "@/app/actions";
import { FileButton } from "@/components/file-button";
import { SignaturePad } from "@/components/signature-pad";
import type { FormField } from "@/lib/forms/template";

export function FormFill({
  action,
  fields,
  startedAt,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  fields: FormField[];
  startedAt?: number;
}) {
  const [state, formAction, pending] = useActionState(action, null as ActionState);
  if (state?.ok) return <p className="text-base">Received.</p>;
  return (
    <form action={formAction} className="mt-6 flex flex-col gap-3" aria-label="Form">
      {startedAt != null ? <input type="hidden" name="startedAt" value={String(startedAt)} /> : null}
      {startedAt != null ? (
        <div className="absolute left-[-9999px] h-0 overflow-hidden" aria-hidden="true">
          <input name="hp_field" tabIndex={-1} autoComplete="off" defaultValue="" />
        </div>
      ) : null}
      {fields.map((field) => (
        <Field key={field.id} field={field} />
      ))}
      {state?.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
      <button type="submit" className="ctl h-9 w-fit" disabled={pending}>
        Send
      </button>
    </form>
  );
}

function Field({ field }: { field: FormField }) {
  if (field.type === "photo" || field.type === "file") {
    return (
      <FileButton
        name={`file_${field.id}`}
        label={field.label}
        accept={field.type === "photo" ? "image/jpeg,image/png,image/webp" : "image/jpeg,image/png,image/webp,application/pdf"}
        empty={field.type === "photo" ? "Photo" : "File"}
      />
    );
  }
  if (field.type === "signature") return <SignaturePad name={`f_${field.id}`} label={field.label} />;
  if (field.type === "checkbox") {
    return (
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name={`f_${field.id}`} value="yes" aria-label={field.label} />
        {field.label}
      </label>
    );
  }
  if (field.type === "select") {
    return (
      <label className="text-sm">
        {field.label}
        <select name={`f_${field.id}`} aria-label={field.label} className="field mt-1" defaultValue="" required={field.required}>
          <option value="">Choose</option>
          {field.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
    );
  }
  return (
    <label className="text-sm">
      {field.label}
      <input
        name={`f_${field.id}`}
        aria-label={field.label}
        type={field.type === "date" ? "date" : field.type === "number" ? "number" : "text"}
        required={field.required}
        className="field mt-1"
      />
    </label>
  );
}
