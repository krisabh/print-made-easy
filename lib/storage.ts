import path from "path";

export function getUploadDir() {
  return path.join(process.cwd(), process.env.UPLOAD_DIR ?? "storage/uploads");
}

export function getStoredFilePath(storedFileName: string) {
  const uploadDir = getUploadDir();
  const resolved = path.resolve(uploadDir, path.basename(storedFileName));

  if (!resolved.startsWith(path.resolve(uploadDir))) {
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
