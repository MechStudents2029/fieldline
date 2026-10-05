import { notFound } from "next/navigation";

export default function E2ECrashPage() {
  if (process.env.FIELDLINE_E2E !== "1") notFound();
  throw new Error("E2E crash check");
}
