/**
 * TEMPORARY DEBUG ENDPOINT — REMOVE AFTER HOSTINGER DB DEBUGGING.
 * Exposes only non-secret DATABASE_URL parts (never the password).
 * Delete this file (and the debug folder) once production DB auth is fixed.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl || databaseUrl.trim() === "") {
    return NextResponse.json(
      {
        databaseUrlPresent: false,
        error: "DATABASE_URL is missing or empty in the runtime environment.",
      },
      {
        status: 200,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  try {
    // Password may contain encoded characters; URL parses userinfo safely.
    const parsed = new URL(databaseUrl);

    const database = parsed.pathname.replace(/^\//, "") || null;

    return NextResponse.json(
      {
        databaseUrlPresent: true,
        protocol: parsed.protocol,
        username: decodeURIComponent(parsed.username || ""),
        host: parsed.hostname || null,
        port: parsed.port || null,
        database,
      },
      {
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch {
    return NextResponse.json(
      {
        databaseUrlPresent: true,
        error:
          "DATABASE_URL is present but could not be parsed as a valid URL. Check format: mysql://USER:PASSWORD@HOST:PORT/DATABASE",
      },
      {
        status: 200,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
