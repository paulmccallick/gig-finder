import { writeFile } from "node:fs/promises";
import path from "node:path";

const encoder = new TextEncoder();

function bytes(value: string) {
  return encoder.encode(value).byteLength;
}

function escapePdfText(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}

export function syntheticTextPdf(text = "Synthetic resume for production upload verification") {
  const stream = `BT /F1 12 Tf 72 720 Td (${escapePdfText(text)}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${bytes(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let output = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(bytes(output));
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = bytes(output);
  output += `xref\n0 ${objects.length + 1}\n`;
  output += "0000000000 65535 f \n";
  output += offsets.slice(1)
    .map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  output += `startxref\n${xrefOffset}\n%%EOF\n`;
  return encoder.encode(output);
}

if (import.meta.main) {
  const filename = process.argv[2];
  if (!filename) throw new Error("Usage: pdf-fixture <output-file>");
  await writeFile(path.resolve(filename), syntheticTextPdf());
}
