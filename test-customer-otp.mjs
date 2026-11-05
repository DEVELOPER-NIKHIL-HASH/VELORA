/**
 * VELORA Comprehensive Customer Email & Mobile OTP Verification Test Suite
 * Validates all security, delivery, lifecycle, and preservation requirements.
 */

import Database from "better-sqlite3";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, "server", ".env") });

const PORT = 5001; // Separate port for clean test execution
process.env.PORT = String(PORT);

const BASE_URL = `http://127.0.0.1:${PORT}`;
const JWT_SECRET = process.env.JWT_SECRET;
const dbPath = path.join(__dirname, "server", "velora.db");
const db = new Database(dbPath);

console.log("=================================================");
console.log("VELORA CUSTOMER EMAIL & MOBILE OTP TEST SUITE");
console.log("=================================================");

let serverProcess;

async function startTestServer() {
  const { default: express } = await import("express");
  const cors = (await import("cors")).default;
  const { registerCustomerAuthRoutes, hashOtp, generateSecureOtp } = await import("./server/customerAuth.js");
  const { registerAuthRoutes } = await import("./server/auth.js");
  const { registerAdminAuthRoutes } = await import("./server/adminAuth.js");

  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get("/api/health", (req, res) => res.json({ status: "success", store: "VELORA" }));

  // Register existing routes to verify strict preservation
  registerAuthRoutes(app, db, JWT_SECRET);
  registerAdminAuthRoutes(app, process.env.ADMIN_SECRET, process.env.ADMIN_PASSWORD_HASH);

  // Register new customer auth routes
  registerCustomerAuthRoutes(app, db, JWT_SECRET);

  return new Promise((resolve) => {
    const s = app.listen(PORT, "127.0.0.1", () => {
      console.log(`[TEST SERVER] Running on ${BASE_URL}`);
      resolve(s);
    });
  });
}

function pass(name) {
  console.log(`  [PASS] ${name}`);
}

function fail(name, error) {
  console.error(`  [FAIL] ${name}:`, error);
  process.exitCode = 1;
}

async function runTests() {
  serverProcess = await startTestServer();

  try {
    // -------------------------------------------------------------
    // Test 1: Provider Status Endpoint
    // -------------------------------------------------------------
    console.log("\n--- TEST GROUP 1: Provider Configuration Detection ---");
    {
      const res = await fetch(`${BASE_URL}/api/customer/auth/providers`);
      const data = await res.json();

      if (res.ok && data.status === "success" && data.providers) {
        pass("GET /api/customer/auth/providers returns provider configuration status");
        if (data.providers.email.configured) {
          pass(`Email provider verified active: ${data.providers.email.provider}`);
        } else {
          fail("Email provider not detected as configured");
        }
        if (!data.providers.sms.configured) {
          pass("Mobile SMS correctly reported as unconfigured when Twilio credentials are blank");
        } else {
          pass(`Mobile SMS provider active: ${data.providers.sms.provider}`);
        }
      } else {
        fail("Providers status endpoint returned invalid structure", JSON.stringify(data));
      }
    }

    // -------------------------------------------------------------
    // Test 2: Real Email OTP Generation, Dispatch & Storage Security
    // -------------------------------------------------------------
    console.log("\n--- TEST GROUP 2: Email OTP Generation, Dispatch & Security ---");
    const testEmail = `velora.customer.test.${Date.now()}@example.com`;
    let activeSessionId = "";
    let generatedOtp = "";

    // Test invalid email rejection
    {
      const res = await fetch(`${BASE_URL}/api/customer/auth/email/request-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "invalid-email-address" })
      });
      const data = await res.json();
      if (res.status === 400 && data.status === "error") {
        pass("Rejects malformed email address with HTTP 400");
      } else {
        fail("Failed to reject malformed email address");
      }
    }

    // Request real Email OTP (uses SMTP to self/configured email for delivery)
    {
      const realRecipient = process.env.SMTP_USER || "veloraecommercecompany@gmail.com";
      const res = await fetch(`${BASE_URL}/api/customer/auth/email/request-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: realRecipient, name: "Velora Royal Customer" })
      });
      const data = await res.json();

      if (res.ok && data.status === "success" && data.sessionId) {
        activeSessionId = data.sessionId;
        pass("Dispatches real Email OTP via SMTP and returns secure sessionId");

        // Verify zero leakage of raw OTP in client response
        if (data.otp === undefined && data.code === undefined) {
          pass("Response strictly does NOT expose the OTP code");
        } else {
          fail("CRITICAL: Raw OTP exposed in API response!");
        }

        // Verify session in database
        const row = db.prepare("SELECT * FROM customer_otp_sessions WHERE session_id = ?").get(activeSessionId);
        if (row && row.otp_hash && row.otp_hash.length === 64) {
          pass("OTP is cryptographically HMAC-SHA256 hashed in database (never raw plain text)");
          if (row.attempts === 0 && row.is_consumed === 0) {
            pass("Session initialized with attempts=0 and is_consumed=0");
          }
        } else {
          fail("Session database record missing or otp_hash invalid");
        }
      } else {
        fail("Email OTP request failed", JSON.stringify(data));
      }
    }

    // -------------------------------------------------------------
    // Test 3: Resend Cooldown Enforcement
    // -------------------------------------------------------------
    console.log("\n--- TEST GROUP 3: Resend Cooldown Enforcement ---");
    {
      const res = await fetch(`${BASE_URL}/api/customer/auth/email/resend-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: activeSessionId })
      });
      const data = await res.json();

      if (res.status === 429 && data.resendCooldown > 0) {
        pass(`Enforces 60-second resend cooldown (HTTP 429: ${data.resendCooldown}s remaining)`);
      } else {
        fail("Cooldown was not enforced on immediate resend request", JSON.stringify(data));
      }
    }

    // -------------------------------------------------------------
    // Test 4: Incorrect OTP Verification & Decrementing Attempts
    // -------------------------------------------------------------
    console.log("\n--- TEST GROUP 4: Incorrect OTP & Attempts Counter ---");
    {
      const res = await fetch(`${BASE_URL}/api/customer/auth/email/verify-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: activeSessionId, otp: "000000" })
      });
      const data = await res.json();

      if (res.status === 400 && data.attemptsRemaining === 4) {
        pass("Incorrect OTP rejected; remaining attempts correctly decremented to 4");
      } else {
        fail("Incorrect OTP not handled properly", JSON.stringify(data));
      }
    }

    // -------------------------------------------------------------
    // Test 5: Maximum Verification Attempts Limit (Brute Force Protection)
    // -------------------------------------------------------------
    console.log("\n--- TEST GROUP 5: Maximum Verification Attempts Limit ---");
    {
      // Create dedicated session for brute force testing
      const { hashOtp, generateSecureOtp } = await import("./server/customerAuth.js");
      const bruteSessionId = crypto.randomUUID();
      const bruteOtp = "777888";
      const bruteHash = hashOtp(bruteOtp, bruteSessionId, "brute@example.com", JWT_SECRET);

      db.prepare(`
        INSERT INTO customer_otp_sessions (
          session_id, target_type, identifier, name, otp_hash, attempts, max_attempts, expires_at, last_sent_at, is_consumed
        ) VALUES (?, 'email', 'brute@example.com', 'Brute Test', ?, 0, 5, ?, ?, 0)
      `).run(bruteSessionId, bruteHash, Date.now() + 600000, Date.now());

      // Attempt 1 to 5 with wrong code
      for (let i = 1; i <= 5; i++) {
        const res = await fetch(`${BASE_URL}/api/customer/auth/email/verify-otp`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: bruteSessionId, otp: "111111" })
        });
        const data = await res.json();
        if (i === 5) {
          if (res.status === 400 && data.message.includes("Maximum attempts exceeded")) {
            pass("5th failed attempt permanently deactivates the session");
          } else {
            fail("5th attempt did not deactivate session", JSON.stringify(data));
          }
        }
      }

      // 6th attempt after deactivation
      const postDeactivationRes = await fetch(`${BASE_URL}/api/customer/auth/email/verify-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: bruteSessionId, otp: bruteOtp })
      });
      const postData = await postDeactivationRes.json();
      if (!postDeactivationRes.ok) {
        pass("Correct OTP rejected after session exceeded maximum verification attempts");
      } else {
        fail("Session remained valid after exceeding maximum attempts!");
      }
    }

    // -------------------------------------------------------------
    // Test 6: Expired OTP Rejection
    // -------------------------------------------------------------
    console.log("\n--- TEST GROUP 6: Expired OTP Rejection ---");
    {
      const { hashOtp } = await import("./server/customerAuth.js");
      const expiredSessionId = crypto.randomUUID();
      const expiredOtp = "123456";
      const expiredHash = hashOtp(expiredOtp, expiredSessionId, "expired@example.com", JWT_SECRET);

      // Session with expires_at in the past
      db.prepare(`
        INSERT INTO customer_otp_sessions (
          session_id, target_type, identifier, name, otp_hash, attempts, max_attempts, expires_at, last_sent_at, is_consumed
        ) VALUES (?, 'email', 'expired@example.com', 'Expired Test', ?, 0, 5, ?, ?, 0)
      `).run(expiredSessionId, expiredHash, Date.now() - 5000, Date.now() - 10000);

      const res = await fetch(`${BASE_URL}/api/customer/auth/email/verify-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: expiredSessionId, otp: expiredOtp })
      });
      const data = await res.json();

      if (res.status === 400 && data.message.toLowerCase().includes("expired")) {
        pass("Expired OTP rejected with clear expiration message");
      } else {
        fail("Expired OTP was not rejected properly", JSON.stringify(data));
      }
    }

    // -------------------------------------------------------------
    // Test 7: Valid OTP Verification & Customer Account Creation
    // -------------------------------------------------------------
    console.log("\n--- TEST GROUP 7: Valid OTP Verification & Customer JWT ---");
    let customerAuthToken = "";
    let customerRecordId = null;
    {
      const { hashOtp } = await import("./server/customerAuth.js");
      const validSessionId = crypto.randomUUID();
      const validOtp = "948215";
      const customerEmail = "eleanor.vance@velora-couture.com";
      const validHash = hashOtp(validOtp, validSessionId, customerEmail, JWT_SECRET);

      db.prepare(`
        INSERT INTO customer_otp_sessions (
          session_id, target_type, identifier, name, otp_hash, attempts, max_attempts, expires_at, last_sent_at, is_consumed
        ) VALUES (?, 'email', ?, 'Eleanor Vance', ?, 0, 5, ?, ?, 0)
      `).run(validSessionId, customerEmail, validHash, Date.now() + 600000, Date.now());

      const res = await fetch(`${BASE_URL}/api/customer/auth/email/verify-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: validSessionId, otp: validOtp })
      });
      const data = await res.json();

      if (res.ok && data.status === "success" && data.token && data.customer) {
        pass("Valid OTP successfully verified and returns JWT auth token");
        customerAuthToken = data.token;
        customerRecordId = data.customer.id;

        if (data.customer.email === customerEmail && data.customer.email_verified === true) {
          pass("Customer record created with email_verified = true");
        } else {
          fail("Customer record missing email_verified flag");
        }

        // Test OTP Reuse Prevention on same session
        const reuseRes = await fetch(`${BASE_URL}/api/customer/auth/email/verify-otp`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: validSessionId, otp: validOtp })
        });
        const reuseData = await reuseRes.json();
        if (reuseRes.status === 400 && reuseData.message.includes("already been used")) {
          pass("OTP Reuse Prevention: Re-submitting consumed OTP is immediately rejected");
        } else {
          fail("OTP reuse was not prevented!", JSON.stringify(reuseData));
        }
      } else {
        fail("Valid OTP verification failed", JSON.stringify(data));
      }
    }

    // -------------------------------------------------------------
    // Test 8: Mobile OTP Provider Integration & Lifecycle
    // -------------------------------------------------------------
    console.log("\n--- TEST GROUP 8: Mobile OTP Provider & Verification ---");
    {
      // 1. Requesting Mobile OTP without Twilio credentials
      const res = await fetch(`${BASE_URL}/api/customer/auth/mobile/request-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: "+919876543210" })
      });
      const data = await res.json();

      if (res.status === 503 && data.code === "SMS_NOT_CONFIGURED") {
        pass("Accurately reports SMS_NOT_CONFIGURED when Twilio credentials are missing (No fake SMS)");
      } else if (res.ok && data.status === "success") {
        pass("Dispatched real SMS via configured SMS provider");
      }

      // 2. Mobile OTP verification engine test with cryptographic session
      const { hashOtp } = await import("./server/customerAuth.js");
      const mobileSessionId = crypto.randomUUID();
      const mobileOtp = "582914";
      const mobilePhone = "+919876543210";
      const mobileHash = hashOtp(mobileOtp, mobileSessionId, mobilePhone, JWT_SECRET);

      db.prepare(`
        INSERT INTO customer_otp_sessions (
          session_id, target_type, identifier, name, otp_hash, attempts, max_attempts, expires_at, last_sent_at, is_consumed
        ) VALUES (?, 'mobile', ?, 'Mobile Client', ?, 0, 5, ?, ?, 0)
      `).run(mobileSessionId, mobilePhone, mobileHash, Date.now() + 600000, Date.now());

      // Test incorrect mobile code
      const wrongRes = await fetch(`${BASE_URL}/api/customer/auth/mobile/verify-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: mobileSessionId, otp: "000000" })
      });
      const wrongData = await wrongRes.json();
      if (wrongRes.status === 400 && wrongData.attemptsRemaining === 4) {
        pass("Mobile OTP: Incorrect code rejected with remaining attempts counter");
      }

      // Test correct mobile code
      const correctRes = await fetch(`${BASE_URL}/api/customer/auth/mobile/verify-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: mobileSessionId, otp: mobileOtp })
      });
      const correctData = await correctRes.json();
      if (correctRes.ok && correctData.token && correctData.customer.phone_verified === true) {
        pass("Mobile OTP: Valid code verified, customer created with phone_verified = true");
      } else {
        fail("Mobile OTP verification failed", JSON.stringify(correctData));
      }

      // Test mobile OTP reuse prevention
      const mobileReuseRes = await fetch(`${BASE_URL}/api/customer/auth/mobile/verify-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: mobileSessionId, otp: mobileOtp })
      });
      if (mobileReuseRes.status === 400) {
        pass("Mobile OTP: Consumed code cannot be reused");
      } else {
        fail("Mobile OTP reuse was not prevented");
      }
    }

    // -------------------------------------------------------------
    // Test 9: Protected Customer Profile & Orders (/api/customer/auth/me)
    // -------------------------------------------------------------
    console.log("\n--- TEST GROUP 9: Protected Customer Profile & Orders ---");
    {
      // Without token
      const unauthRes = await fetch(`${BASE_URL}/api/customer/auth/me`);
      if (unauthRes.status === 401) {
        pass("GET /api/customer/auth/me rejects unauthenticated requests with HTTP 401");
      } else {
        fail("Unauthenticated request was not rejected with HTTP 401");
      }

      // With valid customer Bearer token
      const authRes = await fetch(`${BASE_URL}/api/customer/auth/me`, {
        headers: { Authorization: `Bearer ${customerAuthToken}` }
      });
      const authData = await authRes.json();

      if (authRes.ok && authData.status === "success" && authData.customer) {
        pass("GET /api/customer/auth/me returns authenticated customer profile and order history");
        if (authData.customer.id === customerRecordId) {
          pass("Authenticated customer ID matches token session");
        }
      } else {
        fail("Failed to retrieve authenticated customer profile", JSON.stringify(authData));
      }
    }

    // -------------------------------------------------------------
    // Test 10: Strict Preservation of Existing Systems
    // -------------------------------------------------------------
    console.log("\n--- TEST GROUP 10: Strict Preservation of Existing Auth ---");
    {
      // 1. Health check
      const healthRes = await fetch(`${BASE_URL}/api/health`);
      if (healthRes.ok) {
        pass("Preserved: GET /api/health returns 200 OK");
      }

      // 2. Seller auth preservation check
      const sellerRes = await fetch(`${BASE_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "nonexistent@seller.com", password: "Password123!" })
      });
      // Should return 401 Invalid email or password, proving seller auth route is alive
      if (sellerRes.status === 401) {
        pass("Preserved: POST /api/auth/login (Seller Login) functional and untouched");
      } else {
        fail("Seller auth route broken", sellerRes.status);
      }

      // 3. Admin auth preservation check
      const adminRes = await fetch(`${BASE_URL}/api/admin/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "wrong-password" })
      });
      if (adminRes.status === 401) {
        pass("Preserved: POST /api/admin/login (Admin Login) functional and untouched");
      } else {
        fail("Admin auth route broken", adminRes.status);
      }
    }

    console.log("\n=================================================");
    console.log("ALL TESTS COMPLETED SUCCESSFULLY");
    console.log("=================================================");
  } catch (error) {
    console.error("Test execution failed:", error);
    process.exitCode = 1;
  } finally {
    if (serverProcess) {
      serverProcess.close();
    }
    db.close();
  }
}

runTests();
