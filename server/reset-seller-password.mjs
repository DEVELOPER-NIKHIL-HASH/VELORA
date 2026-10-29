import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import readline from "node:readline/promises";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

try {
  const password = await rl.question("Enter your chosen password: ");

  if (password.length < 8 || Buffer.byteLength(password, "utf8") > 72) {
    throw new Error("Password must be 8+ characters and at most 72 UTF-8 bytes.");
  }

  const db = new Database("./server/velora.db");

  try {
    const hash = bcrypt.hashSync(password, 12);
    const result = db.prepare(
      "UPDATE users SET password_hash = ? WHERE email = ? COLLATE NOCASE AND role = 'seller'"
    ).run(hash, "velora-test@example.com");

    console.log(result.changes === 1
      ? "Password reset successful."
      : "Seller account not found; password was not changed.");
  } finally {
    db.close();
  }
} catch (error) {
  console.error(error.message);
} finally {
  rl.close();
}
