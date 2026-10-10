"use client";

export function DateRangeBar({ from, to }: { from: string; to: string }) {
  return (
    <form method="get" className="list-bar" data-bar="filters" onChange={(event) => event.currentTarget.requestSubmit()}>
      <label className="list-date">
        From
        <input type="date" name="from" aria-label="From" defaultValue={from} className="list-search" />
      </label>
      <label className="list-date">
        To
        <input type="date" name="to" aria-label="To" defaultValue={to} className="list-search" />
      </label>
    </form>
  );
}
