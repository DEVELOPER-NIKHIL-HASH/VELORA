import fs from "node:fs";
import bcrypt from "bcryptjs";
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";

const rl = readline.createInterface({ input: stdin, output: stdout });

try {
  const password = await rl.question("New admin password (input visible): ");

  if (password.length < 12) {
    throw new Error("Password must be at least 12 characters.");
  }

  const envPath = new URL("./.env", import.meta.url);
  const env = fs.readFileSync(envPath, "utf8");

  if (!/^ADMIN_PASSWORD_HASH=.*$/m.test(env)) {
    throw new Error("ADMIN_PASSWORD_HASH missing; .env unchanged.");
  }

  const hash = await bcrypt.hash(password, 12);
  const updated = env.replace(
    /^ADMIN_PASSWORD_HASH=.*$/m,
    `ADMIN_PASSWORD_HASH=${hash}`
  );

  fs.writeFileSync(envPath, updated, "utf8");
  console.log("Admin password hash updated successfully.");
} catch (error) {
  console.error("Reset failed:", error.message);
} finally {
  rl.close();
}