/** One-page plan PDF with rooms, built so a client can render it without a network call. */
export function floorPlanPdf(title: string): Buffer {
  const safe = title.replace(/[()\\]/g, "").slice(0, 40);
  const stream = [
    "0.6 w",
    "36 36 540 720 re S",
    "72 420 200 260 re S",
    "300 420 230 260 re S",
    "72 72 458 300 re S",
    `BT /F1 16 Tf 80 700 Td (${safe}) Tj ET`,
    "BT /F1 11 Tf 84 650 Td (Shower) Tj ET",
    "BT /F1 11 Tf 312 650 Td (Vanity) Tj ET",
    "BT /F1 11 Tf 84 340 Td (Bath) Tj ET",
    "",
  ].join("\n");
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n",
    `4 0 obj\n<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream\nendobj\n`,
    "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(body));
    body += object;
  }
  const start = Buffer.byteLength(body);
  let xref = `xref\n0 ${objects.length + 1}\n`;
  xref += "0000000000 65535 f \n";
  for (let index = 1; index <= objects.length; index += 1) {
    xref += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(body + xref + trailer);
}
