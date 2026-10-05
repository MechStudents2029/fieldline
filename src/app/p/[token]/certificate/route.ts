import { canonicalJson, sha256 } from "@/lib/esign/hash";
import { simplePdf } from "@/lib/esign/pdf";
import { proposalByToken } from "@/lib/services/read";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const data = proposalByToken(token);
  if (!data?.signature) {
    return new Response("No signature on this proposal.", { status: 404 });
  }
  const hash = sha256(canonicalJson(data.snapshot.public));
  const pdf = simplePdf([
    "Fieldline signature certificate",
    data.org?.name || "",
    data.snapshot.public.title,
    `Signer: ${data.signature.typedName}`,
    `Signed: ${data.signature.signedAt}`,
    `IP: ${data.signature.ip || "n/a"}`,
    `Consent: ${data.signature.consentTextVersion}`,
    `Document SHA-256:`,
    hash,
    "This record is evidence of an electronic signature.",
    "It is not a legal opinion. Counsel should review consent language.",
  ]);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="fieldline-certificate.pdf"`,
    },
  });
}
