import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const chunks = [];
for await (const chunk of process.stdin) {
  chunks.push(Buffer.from(chunk));
}

const loaded = await getDocument({
  data: Uint8Array.from(Buffer.concat(chunks)),
  disableWorker: true,
  useSystemFonts: true,
}).promise;

try {
  const pages = [];
  for (let pageNumber = 1; pageNumber <= loaded.numPages; pageNumber += 1) {
    const page = await loaded.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(content.items
      .map((item) => typeof item?.str === "string" ? item.str : "")
      .join(" "));
  }
  process.stdout.write(JSON.stringify({ pageCount: loaded.numPages, text: pages.join(" ") }));
} finally {
  await loaded.destroy();
}
