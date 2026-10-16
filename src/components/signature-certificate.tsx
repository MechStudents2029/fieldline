import { formatWhen } from "@/lib/format";
import type { CertificateView } from "@/lib/services/doc-signatures";

function roleLabel(role: string) {
  if (role === "client") return "Client";
  if (role === "vendor") return "Vendor";
  return "Team";
}

export function SignatureCertificate({ certificate }: { certificate: CertificateView }) {
  const when = (value: string | null) => formatWhen(value, { withTime: true, timeZone: certificate.timeZone });
  return (
    <article data-status={certificate.status} data-hash={certificate.hash} className="mx-auto flex w-full max-w-lg flex-col gap-4 print:max-w-none">
      <h1 className="font-heading text-2xl">{certificate.title}</h1>
      <p className="num break-all text-xs">{certificate.hash}</p>
      <table aria-label="Signers" className="w-full text-left text-sm">
        <thead>
          <tr className="text-[var(--mac-secondary)]">
            <th className="py-1 font-medium">Signer</th>
            <th className="py-1 font-medium">When</th>
            <th className="py-1 font-medium">IP</th>
          </tr>
        </thead>
        <tbody>
          {certificate.signers.map((signer) => (
            <tr key={`${signer.name}-${signer.at}`}>
              <td className="py-1">
                {signer.name}
                <span className="fl-pill ml-2">{roleLabel(signer.role)}</span>
              </td>
              <td className="num py-1">{when(signer.at)}</td>
              <td className="py-1">
                {signer.ip || "—"}
                {signer.userAgent ? <span className="block text-xs text-[var(--mac-secondary)]">{signer.userAgent}</span> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="flex flex-col gap-1 text-sm">
        {certificate.audit.map((row) => (
          <li key={`${row.action}-${row.at}`} className="flex justify-between gap-3">
            <span>{row.action}</span>
            <span className="num">{when(row.at)}</span>
          </li>
        ))}
      </ul>
    </article>
  );
}
