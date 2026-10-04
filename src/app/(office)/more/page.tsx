import Link from "next/link";
import { logoutAction } from "@/app/actions";

const links = [
  ["/contacts", "Contacts"],
  ["/invoices", "Invoices"],
  ["/price-book", "Price book"],
  ["/copilot", "Copilot"],
  ["/settings", "Settings"],
  ["/feedback", "Feedback"],
  ["/leads/new", "New lead"],
];

export default function MorePage() {
  return (
    <div className="flex flex-col gap-3">
      <h1 className="font-heading text-3xl">More</h1>
      <ul className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
        {links.map(([href, label]) => (
          <li key={href} className="border-b border-border last:border-0">
            <Link href={href} className="block px-4 py-3">
              {label}
            </Link>
          </li>
        ))}
      </ul>
      <form action={logoutAction}>
        <button className="text-sm text-muted-foreground underline">Sign out</button>
      </form>
    </div>
  );
}
