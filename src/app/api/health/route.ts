import { NextResponse } from "next/server";
import { PRODUCT_NAME } from "@/lib/product";

export function GET() {
  return NextResponse.json({
    ok: true,
    product: PRODUCT_NAME,
    mode: process.env.STRIPE_SECRET_KEY ? "stripe" : "demo",
  });
}
