import { NextResponse } from "next/server";
import { databaseKind } from "@/lib/db/paths";
import { PRODUCT_NAME } from "@/lib/product";

export function GET() {
  let database: string = "sqlite-file";
  try {
    database = databaseKind();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Database is not configured.";
    return NextResponse.json({ ok: false, product: PRODUCT_NAME, error: message }, { status: 500 });
  }
  return NextResponse.json({
    ok: true,
    product: PRODUCT_NAME,
    mode: process.env.STRIPE_SECRET_KEY ? "stripe" : "demo",
    database,
  });
}
