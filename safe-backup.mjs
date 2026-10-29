import Database from "better-sqlite3";
import path from "node:path";
import { mkdirSync, statSync } from "node:fs";

const source = path.join(process.cwd(), "server", "velora.db");
const backupDir = "C:\\VELORA-Backups";

mkdirSync(backupDir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const destination = path.join(backupDir, `velora-${stamp}.db`);

const db = new Database(source);
try {
  await db.backup(destination);
} finally {
  db.close();
}

const check = new Database(destination, { readonly: true });
try {
  const result = check.pragma("integrity_check");
  if (result.length !== 1 || result[0].integrity_check !== "ok") {
    throw new Error("Backup integrity check failed");
  }

  console.log("BACKUP VERIFIED");
  console.log("Path:", destination);
  console.log("Size:", statSync(destination).size, "bytes");
  console.log("Integrity:", result[0].integrity_check);
} finally {
  check.close();
}
