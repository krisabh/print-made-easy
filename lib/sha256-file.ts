import { createHash } from "crypto";
import { createReadStream } from "fs";

/**
 * Streaming SHA-256 of a file as lowercase hex.
 * Suitable for large installer EXEs — does not load the whole file into memory.
 * Server / Node scripts only (uses fs).
 */
export function sha256HexOfFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => {
      hash.update(chunk);
    });
    stream.on("error", reject);
    stream.on("end", () => {
      resolve(hash.digest("hex"));
    });
  });
}

/**
 * SHA-256 of an in-memory buffer as lowercase hex.
 */
export function sha256HexOfBuffer(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}
