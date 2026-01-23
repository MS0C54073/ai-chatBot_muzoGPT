import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { saveUpload } from "@/lib/db";

export const runtime = "nodejs";

const UPLOAD_DIR = path.join(process.cwd(), "data", "uploads");
const MAX_BYTES = 5 * 1024 * 1024;

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get("file");

  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "file too large (max 5MB)" },
      { status: 400 }
    );
  }

  await fs.mkdir(UPLOAD_DIR, { recursive: true });

  const id = crypto.randomUUID();
  const safeName = file.name.replace(/[^\w.\-]+/g, "_");
  const storagePath = path.join(UPLOAD_DIR, `${id}-${safeName}`);
  const buffer = Buffer.from(await file.arrayBuffer());

  await fs.writeFile(storagePath, buffer);

  const upload = await saveUpload({
    id,
    filename: file.name,
    mimeType: file.type || "application/octet-stream",
    sizeBytes: file.size,
    storagePath,
  });

  return NextResponse.json(upload, { status: 201 });
}
