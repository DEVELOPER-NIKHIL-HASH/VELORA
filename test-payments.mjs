import Database from "better-sqlite3";
import crypto from "node:crypto";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  initPaymentDatabase,
  calculateOrderTotalServerSide,
  verifyRazorpaySignature,
  CURATED_MARKETPLACE_CATALOG
} from "./server/payments.js";
import { calculatePlatformFee, normalizeOrderFees, PLATFORM_FEE_RATE } from "./server/fees.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "server", ".env") });

console.log("==================================================================");
console.log("VELORA Phase 5 — Payment Gateway Test Suite");
console.log("==================================================================");

const db = new Database("./server/velora.db");
initPaymentDatabase(db);

const SECRET = process.env.RAZORPAY_KEY_SECRET || "velora_test_secret_32bytes_sec1234";

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

// -----------------------------------------------------------------------------
// Test 1: Server-side Amount Calculation for Marketplace
// -----------------------------------------------------------------------------
console.log("\n[Test 1] Server-side calculation for Marketplace orders (store_id = null):");
{
  // User adds Headphone (1999) + Watch (2499) = 4498 -> shipping = 0
  const items = [
    { id: 1, quantity: 1 },
    { id: 2, quantity: 1 }
  ];
  const calc = calculateOrderTotalServerSide(db, items, null, null);
  assert(calc.subtotal === 4498, "Marketplace subtotal is 4498 (1999 + 2499)");
  assert(calc.shipping === 0, "Free shipping applies for subtotal >= 1999");
  assert(calc.verifiedTotal === 4498, "Verified total matches subtotal");

  // User adds only Backpack (1299) -> shipping = 99
  const singleItem = [{ id: 3, quantity: 1 }];
  const singleCalc = calculateOrderTotalServerSide(db, singleItem, null, null);
  assert(singleCalc.subtotal === 1299, "Subtotal is 1299");
  assert(singleCalc.shipping === 99, "Standard shipping 99 applies for subtotal < 1999");
  assert(singleCalc.verifiedTotal === 1398, "Verified total is 1299 + 99 = 1398");
}

// -----------------------------------------------------------------------------
// Test 2: Platform Fee Logic Verification (3% Untouched)
// -----------------------------------------------------------------------------
console.log("\n[Test 2] Verify existing 3% Platform Fee logic:");
{
  const total = 4498;
  const fees = calculatePlatformFee(total);
  const expectedFee = Math.round(4498 * 0.03 * 100) / 100;
  assert(fees.fee_rate === 0.03, "Fee rate is exactly 0.03 (3%)");
  assert(fees.platform_fee === expectedFee, `Platform fee is ${expectedFee}`);
  assert(fees.seller_payout === Math.round((total - expectedFee) * 100) / 100, "Seller payout is total - fee");
}

// -----------------------------------------------------------------------------
// Test 3: Razorpay Signature Verification Algorithm
// -----------------------------------------------------------------------------
console.log("\n[Test 3] Razorpay HMAC SHA256 Signature Verification:");
{
  const testOrderId = "order_test_987654";
  const testPaymentId = "pay_test_123456";

  const validSignature = crypto
    .createHmac("sha256", SECRET)
    .update(`${testOrderId}|${testPaymentId}`)
    .digest("hex");

  const isVerified = verifyRazorpaySignature({
    razorpay_order_id: testOrderId,
    razorpay_payment_id: testPaymentId,
    razorpay_signature: validSignature,
    secret: SECRET
  });
  assert(isVerified === true, "Valid Razorpay signature correctly returns TRUE");

  const invalidSignature = "wrong_signature_1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
  const isInvalid = verifyRazorpaySignature({
    razorpay_order_id: testOrderId,
    razorpay_payment_id: testPaymentId,
    razorpay_signature: invalidSignature,
    secret: SECRET
  });
  assert(isInvalid === false, "Tampered/invalid signature correctly returns FALSE");

  const missingSig = verifyRazorpaySignature({
    razorpay_order_id: testOrderId,
    razorpay_payment_id: testPaymentId,
    razorpay_signature: "",
    secret: SECRET
  });
  assert(missingSig === false, "Empty signature safely returns FALSE");
}

// -----------------------------------------------------------------------------
// Test 4: Database Schema and Constraints
// -----------------------------------------------------------------------------
console.log("\n[Test 4] Database schema integrity for orders & payments:");
{
  const orderColumns = db.prepare("PRAGMA table_info(orders)").all().map((c) => c.name);
  assert(orderColumns.includes("payment_status"), "orders table has payment_status column");
  assert(orderColumns.includes("razorpay_order_id"), "orders table has razorpay_order_id column");
  assert(orderColumns.includes("razorpay_payment_id"), "orders table has razorpay_payment_id column");
  assert(orderColumns.includes("payment_method"), "orders table has payment_method column");

  const paymentColumns = db.prepare("PRAGMA table_info(payments)").all().map((c) => c.name);
  assert(paymentColumns.includes("order_id"), "payments table has order_id column");
  assert(paymentColumns.includes("razorpay_order_id"), "payments table has razorpay_order_id column");
  assert(paymentColumns.includes("razorpay_payment_id"), "payments table has razorpay_payment_id column");
  assert(paymentColumns.includes("verification_status"), "payments table has verification_status column");
}

db.close();

console.log("\n==================================================================");
console.log(`Results: ${passed} Passed, ${failed} Failed`);
console.log("==================================================================");

if (failed > 0) {
  process.exit(1);
}
