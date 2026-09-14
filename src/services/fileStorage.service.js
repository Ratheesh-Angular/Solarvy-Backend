import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_ROOT = path.resolve(__dirname, "../../uploads");

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

const ALLOWED_EXTENSIONS = new Set([
  ".pdf",
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
]);

export function getUploadsRoot() {
  return UPLOADS_ROOT;
}

export async function ensureUploadDirs() {
  await fs.mkdir(path.join(UPLOADS_ROOT, "expert-reviews"), { recursive: true });
  await fs.mkdir(path.join(UPLOADS_ROOT, "quote-uploads"), { recursive: true });
}

function sanitizeOriginalName(name) {
  const base = path.basename(String(name || "file")).replace(/[^\w.\- ()]/g, "_");
  return base.slice(0, 180) || "file";
}

function extensionOf(originalName, mimeType) {
  const ext = path.extname(originalName || "").toLowerCase();
  if (ext && ALLOWED_EXTENSIONS.has(ext)) return ext;
  if (mimeType === "application/pdf") return ".pdf";
  if (mimeType === "image/jpeg") return ".jpg";
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/webp") return ".webp";
  return "";
}

export function assertAllowedUpload(file) {
  if (!file?.buffer?.length) {
    throw new Error("No file uploaded");
  }

  const originalName = sanitizeOriginalName(file.originalname);
  const mimeType = String(file.mimetype || "").toLowerCase();
  const ext = extensionOf(originalName, mimeType);

  if (!ext || (!ALLOWED_MIME_TYPES.has(mimeType) && !ALLOWED_EXTENSIONS.has(ext))) {
    throw new Error(
      "Unsupported file type. Allowed: PDF, images, Word, and Excel files.",
    );
  }

  return { originalName, mimeType, ext };
}

/**
 * Persist an uploaded file under uploads/<folder>/ and return metadata.
 * @param {"expert-reviews"|"quote-uploads"} folder
 * @param {{ buffer: Buffer, originalname?: string, mimetype?: string, size?: number }} file
 */
export async function saveUpload(folder, file) {
  if (folder !== "expert-reviews" && folder !== "quote-uploads") {
    throw new Error("Invalid upload folder");
  }

  await ensureUploadDirs();
  const { originalName, mimeType, ext } = assertAllowedUpload(file);
  const storedName = `${randomUUID()}${ext}`;
  const absolutePath = path.join(UPLOADS_ROOT, folder, storedName);
  await fs.writeFile(absolutePath, file.buffer);

  return {
    originalName,
    storedName,
    mimeType,
    sizeBytes: file.size ?? file.buffer.length,
    storagePath: path.join(folder, storedName).replace(/\\/g, "/"),
    absolutePath,
  };
}

export function resolveStoredPath(storagePath) {
  if (!storagePath || storagePath.includes("..")) {
    return null;
  }
  const absolute = path.resolve(UPLOADS_ROOT, storagePath);
  if (!absolute.startsWith(UPLOADS_ROOT)) {
    return null;
  }
  return absolute;
}
