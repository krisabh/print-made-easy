/**
 * Phase 8E.3 — Real Agent print pipeline against localhost.
 * Creates a PENDING job and waits for the running Agent to claim+complete it.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient, PrintStatus } from "@prisma/client";

const prisma = new PrismaClient();
const secrets = JSON.parse(
  fs.readFileSync("C:/Temp/pme-8e3/localhost-test-secrets.json", "utf8"),
) as {
  shopId: string;
  shopCode: string;
  agentA: string;
  deviceAId: string;
  tokenA: string;
  base: string;
};

const OUT = "C:/Temp/pme-8e3/print-pipeline-result.json";

function fp(t: string) {
  return crypto.createHash("sha256").update(t).digest("hex").slice(0, 12);
}

async function createJob() {
  const max = await prisma.printJob.aggregate({
    where: { shopId: secrets.shopId },
    _max: { jobSequence: true },
  });
  const seq = (max._max.jobSequence || 0) + 1;
  const uploadDir = path.join(process.cwd(), "storage", "uploads");
  fs.mkdirSync(uploadDir, { recursive: true });
  const stored = `e3-agent-print-${seq}.pdf`;
  // Minimal valid-ish PDF for Sumatra
  const pdf = Buffer.from(
    `%PDF-1.4
1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj
2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj
3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources<< /Font<< /F1 5 0 R >> >> >>endobj
4 0 obj<< /Length 44 >>stream
BT /F1 24 Tf 100 700 Td (Phase 8E.3) Tj ET
endstream
endobj
5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000266 00000 n 
0000000360 00000 n 
trailer<< /Size 6 /Root 1 0 R >>
startxref
441
%%EOF
`,
  );
  fs.writeFileSync(path.join(uploadDir, stored), pdf);
  return prisma.printJob.create({
    data: {
      shopId: secrets.shopId,
      jobSequence: seq,
      jobNumber: `E3-PRINT-${seq}`,
      copies: 1,
      totalPages: 1,
      printMode: "BW",
      printType: "SINGLE",
      totalPrice: 2,
      status: PrintStatus.PENDING,
      files: {
        create: {
          originalFileName: "phase8e3-test.pdf",
          storedFileName: stored,
          fileExtension: "pdf",
          fileSize: pdf.length,
          totalPages: 1,
        },
      },
    },
    include: { files: true },
  });
}

async function main() {
  const results: Record<string, unknown> = {};

  // Heartbeat evidence for device A
  const before = await prisma.agentDevice.findUnique({
    where: { id: secrets.deviceAId },
    select: { lastSeen: true, agentId: true, tokenHash: true },
  });
  assert.equal(before?.agentId, secrets.agentA);
  results.deviceA_before_lastSeen = before?.lastSeen?.toISOString() || null;

  // Wait up to 30s for Agent heartbeat to refresh lastSeen
  let hbOk = false;
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const d = await prisma.agentDevice.findUnique({
      where: { id: secrets.deviceAId },
      select: { lastSeen: true },
    });
    if (
      d?.lastSeen &&
      (!before?.lastSeen || d.lastSeen.getTime() > before.lastSeen.getTime())
    ) {
      hbOk = true;
      results.deviceA_after_lastSeen = d.lastSeen.toISOString();
      break;
    }
    // Also accept fresh within 20s of now (Agent may have beaten us)
    if (d?.lastSeen && Date.now() - d.lastSeen.getTime() < 20_000) {
      hbOk = true;
      results.deviceA_after_lastSeen = d.lastSeen.toISOString();
      break;
    }
  }
  results.agent_heartbeat = hbOk ? "PASS" : "FAIL";

  // Shop online
  const statusRes = await fetch(
    `${secrets.base}/api/print-agent/heartbeat`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${secrets.tokenA}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        printerName: "Canon LBP6030/6040/6018L XPS",
        printerStatus: "idle",
      }),
    },
  );
  results.manual_hb_status = statusRes.status;

  const job = await createJob();
  results.jobId = job.id;
  results.jobNumber = job.jobNumber;
  console.log("Created PENDING job", job.jobNumber);

  const jobsDir = "C:/ProgramData/PrintMadeEasy/jobs";
  let sawActiveFile = false;
  let finalStatus: string | null = null;
  let claimedBy: string | null = null;

  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    if (fs.existsSync(jobsDir)) {
      const files = fs.readdirSync(jobsDir, { recursive: true }) as string[];
      if (files.length > 0) sawActiveFile = true;
    }
    const row = await prisma.printJob.findUnique({
      where: { id: job.id },
      select: {
        status: true,
        claimedByAgentDeviceId: true,
        lastError: true,
        printAttempts: true,
      },
    });
    finalStatus = row?.status || null;
    claimedBy = row?.claimedByAgentDeviceId || null;
    if (
      row &&
      (row.status === PrintStatus.READY_FOR_PICKUP ||
        row.status === PrintStatus.FAILED ||
        row.status === PrintStatus.CANCELLED)
    ) {
      results.lastError = row.lastError;
      results.printAttempts = row.printAttempts;
      break;
    }
    process.stdout.write(".");
  }
  console.log("");

  const jobsAfter = fs.existsSync(jobsDir)
    ? (fs.readdirSync(jobsDir, { recursive: true }) as string[]).length
    : 0;

  results.finalStatus = finalStatus;
  results.claimedByDeviceA = claimedBy === secrets.deviceAId;
  results.sawActiveTempFile = sawActiveFile;
  results.jobsDirFileCountAfter = jobsAfter;
  results.temp_cleanup =
    finalStatus === PrintStatus.READY_FOR_PICKUP && jobsAfter === 0
      ? "PASS"
      : finalStatus === PrintStatus.READY_FOR_PICKUP && jobsAfter > 0
        ? "FAIL_LEAK"
        : "N/A_OR_INCOMPLETE";

  results.print_pipeline =
    finalStatus === PrintStatus.READY_FOR_PICKUP &&
    claimedBy === secrets.deviceAId
      ? "PASS"
      : `FAIL status=${finalStatus}`;

  // Token still only hashed in DB
  const device = await prisma.agentDevice.findUnique({
    where: { id: secrets.deviceAId },
  });
  const dj = JSON.stringify(device);
  results.token_not_in_db = !dj.includes(secrets.tokenA) ? "PASS" : "FAIL";
  results.tokenFp = fp(secrets.tokenA);

  fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));

  if (results.print_pipeline !== "PASS") process.exitCode = 1;
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
