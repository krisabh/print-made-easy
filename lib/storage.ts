import path from "path";

export function getUploadDir() {
  return path.join(process.cwd(), process.env.UPLOAD_DIR ?? "storage/uploads");
}

/**
 * Resolve a stored upload filename safely (basename only — no path traversal).
 */
export function getStoredFilePath(storedFileName: string) {
  const uploadDir = path.resolve(getUploadDir());
  const safeName = path.basename(storedFileName);
  if (!safeName || safeName === "." || safeName === "..") {
    throw new Error("Invalid file path.");
  }

  const resolved = path.resolve(uploadDir, safeName);
  const relative = path.relative(uploadDir, resolved);

  if (
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    relative.includes("..")
  ) {
    throw new Error("Invalid file path.");
  }

  return resolved;
}

export function getContentType(extension: string) {
  switch (extension.toLowerCase()) {
    case "pdf":
      return "application/pdf";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    default:
      return "application/octet-stream";
  }
}

export function canPreviewInBrowser(extension: string) {
  const ext = extension.toLowerCase();
  return ext === "pdf" || ext === "png" || ext === "jpg" || ext === "jpeg";
}
