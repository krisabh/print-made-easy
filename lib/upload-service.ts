import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";

import { PDFDocument } from "pdf-lib";

import { getUploadDir } from "@/lib/storage";

const ALLOWED_EXTENSIONS = new Set(["pdf", "docx", "png", "jpg", "jpeg"]);
const MAX_FILES = 10;
const MAX_FILE_SIZE_MB = Number(process.env.MAX_UPLOAD_SIZE_MB ?? 20);
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

export type SavedUploadFile = {
  originalFileName: string;
  storedFileName: string;
  fileExtension: string;
  fileSize: number;
  totalPages: number;
};

function getExtension(fileName: string) {
  return path.extname(fileName).replace(".", "").toLowerCase();
}

export function validateUploadFiles(files: File[]) {
  if (files.length === 0) {
    return "Please upload at least one document.";
  }

  if (files.length > MAX_FILES) {
    return "You can upload a maximum of 10 files.";
  }

  for (const file of files) {
    const extension = getExtension(file.name);

    if (!ALLOWED_EXTENSIONS.has(extension)) {
      return "This file type is not supported.";
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      return "File size must be less than 20 MB.";
    }
  }

  return null;
}

async function getPageCountFromBuffer(buffer: Buffer, extension: string) {
  if (extension === "pdf") {
    const pdf = await PDFDocument.load(buffer, { ignoreEncryption: true });
    return pdf.getPageCount();
  }

  // Images and DOCX: 1 page for MVP
  return 1;
}

export async function saveUploadFiles(files: File[]): Promise<SavedUploadFile[]> {
  const validationError = validateUploadFiles(files);
  if (validationError) {
    throw new Error(validationError);
  }

  const uploadDir = getUploadDir();
  await mkdir(uploadDir, { recursive: true });

  const savedFiles: SavedUploadFile[] = [];

  for (const file of files) {
    const fileExtension = getExtension(file.name);
    const storedFileName = `${randomUUID()}.${fileExtension}`;
    const destination = path.join(uploadDir, storedFileName);
    const buffer = Buffer.from(await file.arrayBuffer());
    const totalPages = await getPageCountFromBuffer(buffer, fileExtension);

    await writeFile(destination, buffer);

    savedFiles.push({
      originalFileName: file.name,
      storedFileName,
      fileExtension,
      fileSize: file.size,
      totalPages,
    });
  }

  return savedFiles;
}
