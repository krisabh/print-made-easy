import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import fs from "fs/promises";

import { loadConfig } from "./config";
import { printPdfFile } from "./printer-service";
import { deleteFileSafe, getTempFilePath } from "./storage-service";

export async function runTestPrint(printerName: string) {
  if (!printerName) {
    throw new Error("Please select a printer first.");
  }

  const config = loadConfig();
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  page.drawText("PrintMadeEasy", {
    x: 50,
    y: 760,
    size: 28,
    font: bold,
    color: rgb(0.15, 0.39, 0.92),
  });

  page.drawText("Agent Test Print", {
    x: 50,
    y: 720,
    size: 18,
    font,
    color: rgb(0.1, 0.1, 0.1),
  });

  const lines = [
    `Shop Code: ${config.shopCode}`,
    `Agent ID: ${config.agentId}`,
    `Printer: ${printerName}`,
    `Printed at: ${new Date().toLocaleString()}`,
    "",
    "If you can read this page, the Print Agent",
    "is connected to your printer correctly.",
  ];

  let y = 660;
  for (const line of lines) {
    page.drawText(line, {
      x: 50,
      y,
      size: 12,
      font,
      color: rgb(0.2, 0.2, 0.2),
    });
    y -= 22;
  }

  const bytes = await pdf.save();
  const tempPath = getTempFilePath(`test-print-${Date.now()}.pdf`);
  await fs.writeFile(tempPath, bytes);

  try {
    await printPdfFile(tempPath, printerName);
  } finally {
    deleteFileSafe(tempPath);
  }
}
