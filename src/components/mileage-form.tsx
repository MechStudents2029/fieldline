"use client";

import { useActionState } from "react";
import { createMileageTripAction, editMileageTripAction, type ActionState } from "@/app/actions";
import { Button } from "@/components/ui/button";

export type MileageFormTrip = {
  id: string;
  tripOn: string;
  startLabel: string;
  endLabel: string;
  milesLabel: string;
  projectId: string | null;
  fromText: string | null;
  toText: string | null;
  purpose: string;
  business: boolean;
  userId: string;
  status: string;
};

export function MileageForm({
  jobs,
  people,
  trip,
}: {
  jobs: { id: string; name: string }[];
  people?: { id: string; name: string }[];
  trip?: MileageFormTrip;
}) {
  const action = trip ? editMileageTripAction.bind(null, trip.id) : createMileageTripAction;
  const [state, formAction, pending] = useActionState(action, null as ActionState);
  const showSubmit = !trip || trip.status === "draft";
  return (
    <section className="flex flex-col gap-3" aria-label="Trip">
      <h2 className="fl-section">{trip ? "Edit" : "Trip"}</h2>
      <form action={formAction} className="grid gap-2" aria-busy={pending}>
        {people && people.length > 0 ? (
          <label className="text-sm">
            Person
            <select name="userId" aria-label="Person" className="field mt-1" defaultValue={trip?.userId ?? people[0]?.id ?? ""}>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="text-sm">
          Date
          <input name="tripOn" aria-label="Date" type="date" className="field mt-1" required defaultValue={trip?.tripOn ?? ""} />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-sm">
            Start
            <input name="start" aria-label="Start" inputMode="decimal" className="field mt-1" defaultValue={trip?.startLabel ?? ""} />
          </label>
          <label className="text-sm">
            End
            <input name="end" aria-label="End" inputMode="decimal" className="field mt-1" defaultValue={trip?.endLabel ?? ""} />
          </label>
        </div>
        <label className="text-sm">
          Miles
          <input name="miles" aria-label="Miles" inputMode="decimal" className="field mt-1" defaultValue={trip?.milesLabel ?? ""} />
        </label>
        <label className="text-sm">
          Job
          <select name="projectId" aria-label="Job" className="field mt-1" defaultValue={trip?.projectId ?? ""}>
            <option value="">No job</option>
            {jobs.map((job) => (
              <option key={job.id} value={job.id}>
                {job.name}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-sm">
            From
            <input name="from" aria-label="From" className="field mt-1" defaultValue={trip?.fromText ?? ""} />
          </label>
          <label className="text-sm">
            To
            <input name="to" aria-label="To" className="field mt-1" defaultValue={trip?.toText ?? ""} />
          </label>
        </div>
        <label className="text-sm">
          Purpose
          <input name="purpose" aria-label="Purpose" className="field mt-1" required defaultValue={trip?.purpose ?? ""} />
        </label>
        <label className="text-sm">
          Kind
          <select name="kind" aria-label="Kind" className="field mt-1" defaultValue={trip && !trip.business ? "personal" : "business"}>
            <option value="business">Business</option>
            <option value="personal">Personal</option>
          </select>
        </label>
        <div className="flex gap-2">
          <Button type="submit" name="intent" value="draft" variant="outline" className="h-11">
            Save
          </Button>
          {showSubmit ? (
            <Button type="submit" name="intent" value="submit" className="h-11">
              Submit
            </Button>
          ) : null}
        </div>
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
