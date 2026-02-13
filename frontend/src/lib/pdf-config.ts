"use client";

import { pdfjs } from "react-pdf";

// configure pdf.js worker using cdn (recommended for next.js)
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

export { pdfjs };
