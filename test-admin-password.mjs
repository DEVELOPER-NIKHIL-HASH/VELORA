import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";

import {
  registerAdminAuthRoutes,
  createAdminAuthenticator,
  getAdminPasswordHash,
  getAdminTokenVersion,
  isAdminRecoveryConfigured,
  activeResetSessions,
  otpRequestIpTracker,
  otpRequestCooldownTracker
} from "./server/adminAuth.js";
import { createSellerAuthenticator } from "./server/auth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ENV_PATH = path.join(__dirname, "server", ".env");

// Backup original .env
const originalEnv = fs.readFileSync(ENV_PATH, "utf8");

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`[PASS] ${message}`);
    passed++;
  } else {
    console.error(`[FAIL] ${message}`);
    failed++;
  }
}

async function runTests() {
  console.log("==================================================");
  console.log("VELORA SECURE ADMIN PASSWORD MANAGEMENT TEST SUITE");
  console.log("==================================================");

  try {
    dotenv.config({ path: ENV_PATH });
    const ADMIN_SECRET = process.env.ADMIN_SECRET || "velora-test-admin-secret-minimum-32-chars-long";
    const JWT_SECRET = process.env.JWT_SECRET || "velora-test-jwt-secret-minimum-32-chars-long";

    const INITIAL_PASSWORD = "InitialAdminPassword2026!";
    const initialHash = await bcrypt.hash(INITIAL_PASSWORD, 12);

    // Write initial test hash into server/.env
    const testEnv = originalEnv.replace(/^ADMIN_PASSWORD_HASH=.*$/m, `ADMIN_PASSWORD_HASH=${initialHash}`);
    fs.writeFileSync(ENV_PATH, testEnv, "utf8");

    const app = express();
    app.use(express.json());
    registerAdminAuthRoutes(app, ADMIN_SECRET, initialHash);
    const authenticateAdmin = createAdminAuthenticator(ADMIN_SECRET);
    const authenticateSeller = createSellerAuthenticator(JWT_SECRET);

    // Protected test route
    app.get("/api/admin/protected-test", authenticateAdmin, (req, res) => {
      res.json({ status: "success", admin: req.admin });
    });
    app.get("/api/seller/protected-test", authenticateSeller, (req, res) => {
      res.json({ status: "success", seller: req.seller });
    });

    const server = app.listen(0);
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

    // Helper request
    async function req(endpoint, options = {}) {
      const res = await fetch(`${baseUrl}${endpoint}`, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...(options.headers || {})
        }
      });
      const data = await res.json().catch(() => ({}));
      return { status: res.status, data };
    }

    // 1. Initial login test
    const loginRes = await req("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ password: INITIAL_PASSWORD })
    });
    assert(loginRes.status === 200 && Boolean(loginRes.data.token), "Initial login succeeds with valid token");
    const initialAdminToken = loginRes.data.token;

    // 2. Reject incorrect current password during login
    const wrongLoginRes = await req("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ password: "WrongPassword999!" })
    });
    assert(wrongLoginRes.status === 401, "Login rejected for incorrect password (401)");

    // 3. Change password with incorrect current password
    const wrongCurrentRes = await req("/api/admin/change-password", {
      method: "POST",
      headers: { Authorization: `Bearer ${initialAdminToken}` },
      body: JSON.stringify({
        currentPassword: "BadCurrentPassword123!",
        newPassword: "BrandNewSecurePassword2026!",
        confirmPassword: "BrandNewSecurePassword2026!"
      })
    });
    assert(wrongCurrentRes.status === 401, "Change password rejected for incorrect current password (401)");

    // 4. Change password with confirmation mismatch
    const mismatchRes = await req("/api/admin/change-password", {
      method: "POST",
      headers: { Authorization: `Bearer ${initialAdminToken}` },
      body: JSON.stringify({
        currentPassword: INITIAL_PASSWORD,
        newPassword: "BrandNewSecurePassword2026!",
        confirmPassword: "MismatchPassword2026!"
      })
    });
    assert(mismatchRes.status === 400 && mismatchRes.data.message.includes("match"), "Change password rejected for password confirmation mismatch (400)");

    // 5. Change password with length < 12
    const shortRes = await req("/api/admin/change-password", {
      method: "POST",
      headers: { Authorization: `Bearer ${initialAdminToken}` },
      body: JSON.stringify({
        currentPassword: INITIAL_PASSWORD,
        newPassword: "Short123!",
        confirmPassword: "Short123!"
      })
    });
    assert(shortRes.status === 400 && shortRes.data.message.includes("12 characters"), "Change password rejected for length < 12 characters (400)");

    // 6. Change password with same password as current
    const sameRes = await req("/api/admin/change-password", {
      method: "POST",
      headers: { Authorization: `Bearer ${initialAdminToken}` },
      body: JSON.stringify({
        currentPassword: INITIAL_PASSWORD,
        newPassword: INITIAL_PASSWORD,
        confirmPassword: INITIAL_PASSWORD
      })
    });
    assert(sameRes.status === 400 && sameRes.data.message.includes("same"), "Change password rejected when new password is same as current password (400)");

    // 7. Successful password change
    const NEW_PASSWORD = "BrandNewSuperSecureAdminPassword2026!";
    const changeRes = await req("/api/admin/change-password", {
      method: "POST",
      headers: { Authorization: `Bearer ${initialAdminToken}` },
      body: JSON.stringify({
        currentPassword: INITIAL_PASSWORD,
        newPassword: NEW_PASSWORD,
        confirmPassword: NEW_PASSWORD
      })
    });
    assert(changeRes.status === 200, "Password change succeeds (200)");

    // 8. Rejection of old password on login
    const oldLoginRes = await req("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ password: INITIAL_PASSWORD })
    });
    assert(oldLoginRes.status === 401, "Login with previous password rejected (401)");

    // 9. Login with new password
    const newLoginRes = await req("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ password: NEW_PASSWORD })
    });
    assert(newLoginRes.status === 200 && Boolean(newLoginRes.data.token), "Login with new password succeeds (200)");
    const newAdminToken = newLoginRes.data.token;

    // 10. Session security: revocation of old admin sessions/tokens
    const oldTokenProtectedRes = await req("/api/admin/protected-test", {
      headers: { Authorization: `Bearer ${initialAdminToken}` }
    });
    assert(oldTokenProtectedRes.status === 401, "Previous admin session token revoked and rejected (401)");

    const newTokenProtectedRes = await req("/api/admin/protected-test", {
      headers: { Authorization: `Bearer ${newAdminToken}` }
    });
    assert(newTokenProtectedRes.status === 200, "New admin session token is valid and accepted (200)");

    // 11. Session security: seller authentication & sessions preserved
    const sellerToken = jwt.sign(
      { userId: 42, role: "seller" },
      JWT_SECRET,
      { expiresIn: "1h", issuer: "velora-api", audience: "velora-sellers" }
    );
    const sellerProtectedRes = await req("/api/seller/protected-test", {
      headers: { Authorization: `Bearer ${sellerToken}` }
    });
    assert(sellerProtectedRes.status === 200 && sellerProtectedRes.data.seller.id === 42, "Seller token and session preserved and untouched (200)");

    // 12. Password persistence across server restarts
    // Read .env to verify hash was written
    const persistedEnv = fs.readFileSync(ENV_PATH, "utf8");
    const hashMatch = persistedEnv.match(/^ADMIN_PASSWORD_HASH=(.*)$/m);
    assert(hashMatch && hashMatch[1].startsWith("$2"), "New bcrypt hash persisted in server/.env");
    const persistedHash = hashMatch[1];
    assert(bcrypt.compareSync(NEW_PASSWORD, persistedHash), "Persisted hash in server/.env matches new password");

    // Simulate backend restart by creating fresh instance loading from persisted hash
    const appRestarted = express();
    appRestarted.use(express.json());
    registerAdminAuthRoutes(appRestarted, ADMIN_SECRET, persistedHash);
    const restartedServer = appRestarted.listen(0);
    const restartedPort = restartedServer.address().port;
    const restartedRes = await fetch(`http://127.0.0.1:${restartedPort}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: NEW_PASSWORD })
    });
    assert(restartedRes.status === 200, "Password valid after simulated server restart (Persistence Verified)");
    restartedServer.close();

    // 13. Unconfigured SMTP / Recovery configuration check
    assert(isAdminRecoveryConfigured() === false, "isAdminRecoveryConfigured() correctly returns false when SMTP is not configured");
    const statusRes = await req("/api/admin/forgot-password/status");
    assert(statusRes.status === 200 && statusRes.data.configured === false, "Status endpoint accurately reports recovery unconfigured");

    const unconfiguredForgotRes = await req("/api/admin/forgot-password/request", {
      method: "POST",
      body: JSON.stringify({ email: "admin@velora.com" })
    });
    assert(unconfiguredForgotRes.status === 503 && unconfiguredForgotRes.data.code === "SMTP_NOT_CONFIGURED", "Password recovery returns 503 SMTP_NOT_CONFIGURED without faking credentials or leaking OTP");

    // 14. OTP Cryptographic Reset Flow (Unit & Integration verification)
    // We simulate an active reset session in the memory store
    const testSessionId = crypto.randomBytes(32).toString("hex");
    const testOtp = "729481";
    const testOtpHashed = crypto
      .createHmac("sha256", ADMIN_SECRET)
      .update(`${testSessionId}:${testOtp}`)
      .digest("hex");

    activeResetSessions.set(testSessionId, {
      email: "admin-verified@velora.store",
      otpHashed: testOtpHashed,
      expiresAt: Date.now() + 10 * 60 * 1000,
      attempts: 0,
      createdAt: Date.now()
    });

    // Temporarily set dummy environment so isAdminRecoveryConfigured returns true for unit test
    process.env.SMTP_HOST = "test.smtp";
    process.env.SMTP_USER = "test@smtp";
    process.env.SMTP_PASS = "testpass";
    process.env.ADMIN_RECOVERY_EMAIL = "admin-verified@velora.store";

    // 14a. Test incorrect OTP attempt counting
    const badOtpRes = await req("/api/admin/forgot-password/reset", {
      method: "POST",
      body: JSON.stringify({
        resetSessionId: testSessionId,
        otp: "000000",
        newPassword: "ResetSuperSecretPassword2026!",
        confirmPassword: "ResetSuperSecretPassword2026!"
      })
    });
    assert(badOtpRes.status === 400 && badOtpRes.data.code === "INVALID_OTP" && badOtpRes.data.message.includes("4 attempt"), "Incorrect OTP increments attempt counter and returns INVALID_OTP (400)");

    // 14b. Valid OTP reset
    const OTP_RESET_PASSWORD = "FinalOtpResetPassword2026!";
    const validOtpRes = await req("/api/admin/forgot-password/reset", {
      method: "POST",
      body: JSON.stringify({
        resetSessionId: testSessionId,
        otp: testOtp,
        newPassword: OTP_RESET_PASSWORD,
        confirmPassword: OTP_RESET_PASSWORD
      })
    });
    assert(validOtpRes.status === 200, "Valid OTP resets admin password successfully (200)");

    // 15. Reused OTP (single-use check)
    const reusedOtpRes = await req("/api/admin/forgot-password/reset", {
      method: "POST",
      body: JSON.stringify({
        resetSessionId: testSessionId,
        otp: testOtp,
        newPassword: "AnotherPassword2026!",
        confirmPassword: "AnotherPassword2026!"
      })
    });
    assert(reusedOtpRes.status === 400 && reusedOtpRes.data.code === "INVALID_SESSION", "Reused OTP rejected because session was invalidated upon first use (Single-use Verified)");

    // 16. Expired OTP test (> 10 minutes)
    const expiredSessionId = crypto.randomBytes(32).toString("hex");
    const expiredOtp = "112233";
    const expiredOtpHashed = crypto
      .createHmac("sha256", ADMIN_SECRET)
      .update(`${expiredSessionId}:${expiredOtp}`)
      .digest("hex");

    activeResetSessions.set(expiredSessionId, {
      email: "admin-verified@velora.store",
      otpHashed: expiredOtpHashed,
      expiresAt: Date.now() - 1000, // already expired
      attempts: 0,
      createdAt: Date.now() - 11 * 60 * 1000
    });

    const expiredRes = await req("/api/admin/forgot-password/reset", {
      method: "POST",
      body: JSON.stringify({
        resetSessionId: expiredSessionId,
        otp: expiredOtp,
        newPassword: "ExpiredTestPassword2026!",
        confirmPassword: "ExpiredTestPassword2026!"
      })
    });
    assert(expiredRes.status === 400 && expiredRes.data.code === "OTP_EXPIRED", "Expired OTP rejected with OTP_EXPIRED (Expiry Verified)");

    // 17. Rate limiting & Attempt limit test
    const maxAttemptSessionId = crypto.randomBytes(32).toString("hex");
    activeResetSessions.set(maxAttemptSessionId, {
      email: "admin-verified@velora.store",
      otpHashed: "some-hash",
      expiresAt: Date.now() + 10 * 60 * 1000,
      attempts: 5, // reached maximum attempts
      createdAt: Date.now()
    });
    const maxAttemptRes = await req("/api/admin/forgot-password/reset", {
      method: "POST",
      body: JSON.stringify({
        resetSessionId: maxAttemptSessionId,
        otp: "123456",
        newPassword: "MaxAttemptsPassword2026!",
        confirmPassword: "MaxAttemptsPassword2026!"
      })
    });
    assert(maxAttemptRes.status === 429 && maxAttemptRes.data.code === "MAX_ATTEMPTS_EXCEEDED", "Exceeding 5 incorrect attempts triggers 429 MAX_ATTEMPTS_EXCEEDED (Rate Limit / Brute-Force Protection Verified)");

    // 18. Timing-safe & non-enumeration test
    // Request with non-matching email
    otpRequestIpTracker.clear();
    otpRequestCooldownTracker.clear();
    const nonMatchingEmailRes = await req("/api/admin/forgot-password/request", {
      method: "POST",
      body: JSON.stringify({ email: "unregistered-stranger@gmail.com" })
    });
    assert(nonMatchingEmailRes.status === 200 && Boolean(nonMatchingEmailRes.data.resetSessionId), "Non-matching email returns identical success format with dummy session ID (No Email Enumeration)");

    // Verify login with OTP reset password
    const loginWithOtpResetRes = await req("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ password: OTP_RESET_PASSWORD })
    });
    assert(loginWithOtpResetRes.status === 200, "Login succeeds with password updated via OTP reset");

    // Clean up temporary env vars
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    delete process.env.ADMIN_RECOVERY_EMAIL;

    server.close();
  } finally {
    // Restore original .env
    fs.writeFileSync(ENV_PATH, originalEnv, "utf8");
    console.log("Restored original server/.env successfully.");
  }

  console.log("==================================================");
  console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log("==================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  fs.writeFileSync(ENV_PATH, originalEnv, "utf8");
  process.exit(1);
});
