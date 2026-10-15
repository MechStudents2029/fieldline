"use client";

import { useActionState } from "react";
import { createCredentialAction, editCredentialAction, type ActionState } from "@/app/actions";
import { FileButton } from "@/components/file-button";
import { Button } from "@/components/ui/button";

export type CredentialFormValue = {
  id: string;
  userId: string;
  typeId: string;
  numberLabel: string;
  issuedOn: string;
  expiresOn: string | null;
  doesNotExpire: boolean;
  status: string;
};

export function CredentialForm({
  types,
  people,
  credential,
}: {
  types: { id: string; name: string; archived: boolean }[];
  people?: { id: string; name: string }[];
  credential?: CredentialFormValue;
}) {
  const action = credential ? editCredentialAction.bind(null, credential.id) : createCredentialAction;
  const [state, formAction, pending] = useActionState(action, null as ActionState);
  const choices = types.filter((type) => !type.archived || type.id === credential?.typeId);
  return (
    <section className="flex flex-col gap-3" aria-label="Credential">
      <h2 className="fl-section">{credential ? "Edit" : "Credential"}</h2>
      <form action={formAction} className="grid gap-2" aria-busy={pending}>
        {people && people.length > 1 ? (
          <label className="text-sm">
            Person
            <select name="userId" aria-label="Person" className="field mt-1" defaultValue={credential?.userId ?? people[0]?.id ?? ""}>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="text-sm">
          Type
          <select name="typeId" aria-label="Type" className="field mt-1" required defaultValue={credential?.typeId ?? choices[0]?.id ?? ""}>
            {choices.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Number
          <input name="number" aria-label="Number" className="field mt-1" defaultValue={credential?.numberLabel ?? ""} />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-sm">
            Issued
            <input name="issuedOn" aria-label="Issued" type="date" className="field mt-1" required defaultValue={credential?.issuedOn ?? ""} />
          </label>
          <label className="text-sm">
            Expires
            <input name="expiresOn" aria-label="Expires" type="date" className="field mt-1" defaultValue={credential?.expiresOn ?? ""} />
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input name="open" type="checkbox" value="1" defaultChecked={credential?.doesNotExpire ?? false} />
          Does not expire
        </label>
        <FileButton name="file" label="Card" accept="image/jpeg,image/png,image/webp,application/pdf" empty="Card" />
        <Button type="submit" className="h-11">
          Save
        </Button>
        {pending ? <p className="text-xs text-muted-foreground">Working…</p> : null}
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
    </section>
  );
}
