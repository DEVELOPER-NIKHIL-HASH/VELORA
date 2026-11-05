import crypto from "node:crypto";
import { PLATFORM_FEE_RATE, calculatePlatformFee, normalizeOrderFees } from "./fees.js";
import { getRazorpayConfig, getRazorpayClient } from "./payments.js";
import { createSellerAuthenticator } from "./auth.js";
import { createAdminAuthenticator } from "./adminAuth.js";

export const MIN_PAYOUT_AMOUNT = 500; // Minimum ₹500 payout threshold

/**
 * Initializes all financial tables, indexes, and triggers safely and idempotently.
 *
 * @param {import('better-sqlite3').Database} db
 */
export function initFinancialDatabase(db) {
  // 1. Safe migrations on 'orders'
  const orderColumns = db.prepare("PRAGMA table_info(orders)").all().map((c) => c.name);
  if (!orderColumns.includes("refund_status")) {
    db.exec("ALTER TABLE orders ADD COLUMN refund_status TEXT NOT NULL DEFAULT 'none'");
    console.log("Financial Migration: Added column 'refund_status' to orders.");
  }
  if (!orderColumns.includes("refunded_amount")) {
    db.exec("ALTER TABLE orders ADD COLUMN refunded_amount REAL NOT NULL DEFAULT 0");
    console.log("Financial Migration: Added column 'refunded_amount' to orders.");
  }

  // 2. Safe migrations on 'payments'
  const paymentColumns = db.prepare("PRAGMA table_info(payments)").all().map((c) => c.name);
  if (!paymentColumns.includes("refunded_amount")) {
    db.exec("ALTER TABLE payments ADD COLUMN refunded_amount REAL NOT NULL DEFAULT 0");
    console.log("Financial Migration: Added column 'refunded_amount' to payments.");
  }

  // 3. Create 'payout_requests' table
  db.exec(`
    CREATE TABLE IF NOT EXISTS payout_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      payout_ref TEXT NOT NULL UNIQUE,
      seller_id INTEGER NOT NULL REFERENCES stores(id),
      amount REAL NOT NULL CHECK (amount > 0),
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'completed', 'rejected', 'failed')),
      bank_name TEXT NOT NULL,
      bank_account_number TEXT NOT NULL,
      bank_ifsc TEXT NOT NULL,
      bank_account_holder TEXT NOT NULL,
      utr_reference TEXT DEFAULT NULL,
      admin_notes TEXT DEFAULT NULL,
      requested_at TEXT DEFAULT CURRENT_TIMESTAMP,
      processed_at TEXT DEFAULT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_payouts_seller_id ON payout_requests(seller_id);
    CREATE INDEX IF NOT EXISTS idx_payouts_status ON payout_requests(status);
    CREATE INDEX IF NOT EXISTS idx_payouts_payout_ref ON payout_requests(payout_ref);
  `);

  // 4. Create 'refunds' table
  db.exec(`
    CREATE TABLE IF NOT EXISTS refunds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      refund_ref TEXT NOT NULL UNIQUE,
      order_id INTEGER NOT NULL REFERENCES orders(id),
      payment_id INTEGER REFERENCES payments(id),
      razorpay_refund_id TEXT DEFAULT NULL,
      amount REAL NOT NULL CHECK (amount > 0),
      reason TEXT DEFAULT 'Customer refund request',
      status TEXT NOT NULL DEFAULT 'completed'
        CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
      gateway_status TEXT DEFAULT NULL,
      fee_reversed REAL DEFAULT 0,
      seller_debited REAL DEFAULT 0,
      created_by TEXT DEFAULT 'admin',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_refunds_order_id ON refunds(order_id);
    CREATE INDEX IF NOT EXISTS idx_refunds_payment_id ON refunds(payment_id);
    CREATE INDEX IF NOT EXISTS idx_refunds_refund_ref ON refunds(refund_ref);
  `);

  // 5. Create 'financial_ledger' table (Immutable Double-Entry Ledger)
  db.exec(`
    CREATE TABLE IF NOT EXISTS financial_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_ref TEXT NOT NULL UNIQUE,
      seller_id INTEGER REFERENCES stores(id),
      order_id INTEGER REFERENCES orders(id),
      payout_id INTEGER REFERENCES payout_requests(id),
      refund_id INTEGER REFERENCES refunds(id),
      transaction_type TEXT NOT NULL
        CHECK (transaction_type IN (
          'PAYMENT_CREDIT',
          'PLATFORM_FEE',
          'SELLER_EARNING',
          'REFUND_DEBIT',
          'REFUND_FEE_REVERSAL',
          'PAYOUT_DEBIT',
          'PAYOUT_REVERSAL',
          'ADJUSTMENT'
        )),
      entry_type TEXT NOT NULL CHECK (entry_type IN ('DEBIT', 'CREDIT')),
      amount REAL NOT NULL CHECK (amount >= 0),
      balance_after REAL DEFAULT NULL,
      status TEXT NOT NULL DEFAULT 'completed'
        CHECK (status IN ('pending', 'completed', 'failed', 'reversed')),
      related_ref TEXT DEFAULT NULL,
      description TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_ledger_seller_id ON financial_ledger(seller_id);
    CREATE INDEX IF NOT EXISTS idx_ledger_order_id ON financial_ledger(order_id);
    CREATE INDEX IF NOT EXISTS idx_ledger_transaction_ref ON financial_ledger(transaction_ref);
    CREATE INDEX IF NOT EXISTS idx_ledger_created_at ON financial_ledger(created_at);
  `);

  // 6. Enforce ledger immutability via SQLite database triggers
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS prevent_ledger_update
    BEFORE UPDATE ON financial_ledger
    BEGIN
      SELECT RAISE(ABORT, 'Financial ledger entries are strictly immutable. Corrections must be made via new adjustment entries.');
    END;

    CREATE TRIGGER IF NOT EXISTS prevent_ledger_delete
    BEFORE DELETE ON financial_ledger
    BEGIN
      SELECT RAISE(ABORT, 'Financial ledger entries are strictly immutable. Deletions are forbidden.');
    END;
  `);

  // 7. Create 'webhook_events' table (Idempotent Webhook Processing)
  db.exec(`
    CREATE TABLE IF NOT EXISTS webhook_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL UNIQUE,
      event_type TEXT NOT NULL,
      entity_id TEXT DEFAULT NULL,
      status TEXT NOT NULL DEFAULT 'processed' CHECK (status IN ('processed', 'ignored', 'failed')),
      payload TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_webhook_events_event_id ON webhook_events(event_id);
  `);

  // 8. Create 'financial_audit_logs' table
  db.exec(`
    CREATE TABLE IF NOT EXISTS financial_audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      actor_type TEXT NOT NULL CHECK (actor_type IN ('admin', 'seller', 'system', 'webhook')),
      actor_id TEXT NOT NULL,
      details TEXT,
      ip_address TEXT DEFAULT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_audit_created_at ON financial_audit_logs(created_at);
  `);

  console.log("VELORA Phase 5 Financial Database & Ledger initialized successfully.");

  // Safe idempotent backfill for delivered orders that don't yet have ledger records
  backfillDeliveredOrdersLedger(db);
}

/**
 * Ensures historical delivered orders have immutable ledger entries.
 *
 * @param {import('better-sqlite3').Database} db
 */
export function backfillDeliveredOrdersLedger(db) {
  try {
    const deliveredOrders = db.prepare(`
      SELECT o.*
      FROM orders o
      WHERE o.status = 'Delivered'
        AND NOT EXISTS (
          SELECT 1 FROM financial_ledger fl
          WHERE fl.order_id = o.id AND fl.transaction_type IN ('SELLER_EARNING', 'PLATFORM_FEE')
        )
    `).all();

    for (const order of deliveredOrders) {
      recordOrderDeliverySettlement(db, order.id);
    }
  } catch (err) {
    console.error("Backfill delivered orders error:", err);
  }
}

/**
 * Records financial ledger settlement entries when an order status reaches 'Delivered'.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} orderId
 */
export function recordOrderDeliverySettlement(db, orderId) {
  const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId);
  if (!order || order.status !== "Delivered") return;

  // Check if already settled in ledger
  const existingLedger = db
    .prepare("SELECT id FROM financial_ledger WHERE order_id = ? AND transaction_type IN ('SELLER_EARNING', 'PLATFORM_FEE')")
    .get(orderId);

  if (existingLedger) return;

  const total = Number(order.total) || 0;
  const feeData = calculatePlatformFee(total);
  const platformFee = typeof order.platform_fee === "number" ? order.platform_fee : feeData.platform_fee;
  const sellerPayout = typeof order.seller_payout === "number" ? order.seller_payout : feeData.seller_payout;

  const tx = db.transaction(() => {
    // 1. If seller store order:
    if (order.store_id) {
      // Seller earning credit
      const sellerRef = `LEDG_EARN_${order.id}_${Date.now()}`;
      db.prepare(`
        INSERT INTO financial_ledger (
          transaction_ref, seller_id, order_id, transaction_type, entry_type, amount, status, description
        ) VALUES (?, ?, ?, 'SELLER_EARNING', 'CREDIT', ?, 'completed', ?)
      `).run(sellerRef, order.store_id, order.id, sellerPayout, `Seller net payout (97%) for Delivered Order #${order.id}`);

      // Platform fee entry (3%)
      const feeRef = `LEDG_FEE_${order.id}_${Date.now()}`;
      db.prepare(`
        INSERT INTO financial_ledger (
          transaction_ref, seller_id, order_id, transaction_type, entry_type, amount, status, description
        ) VALUES (?, ?, ?, 'PLATFORM_FEE', 'CREDIT', ?, 'completed', ?)
      `).run(feeRef, order.store_id, order.id, platformFee, `VELORA Platform fee (3%) for Delivered Order #${order.id}`);
    } else {
      // Marketplace order: group items by seller store if present
      let rawItems = [];
      try {
        rawItems = typeof order.items === "string" ? JSON.parse(order.items) : (order.items || []);
      } catch {
        rawItems = [];
      }

      const storeGroups = new Map();
      let unassignedTotal = 0;

      for (const it of rawItems) {
        const itTotal = (Number(it.price) || 0) * (Number(it.quantity) || 1);
        if (it.store_id) {
          const sid = Number(it.store_id);
          storeGroups.set(sid, (storeGroups.get(sid) || 0) + itTotal);
        } else {
          unassignedTotal += itTotal;
        }
      }

      if (storeGroups.size > 0) {
        for (const [sId, sTotal] of storeGroups.entries()) {
          const sFeeData = calculatePlatformFee(sTotal);
          const sellerRef = `LEDG_EARN_${order.id}_S${sId}_${Date.now()}`;
          db.prepare(`
            INSERT INTO financial_ledger (
              transaction_ref, seller_id, order_id, transaction_type, entry_type, amount, status, description
            ) VALUES (?, ?, ?, 'SELLER_EARNING', 'CREDIT', ?, 'completed', ?)
          `).run(sellerRef, sId, order.id, sFeeData.seller_payout, `Seller net payout (97%) for Delivered Order #${order.id}`);

          const feeRef = `LEDG_FEE_${order.id}_S${sId}_${Date.now()}`;
          db.prepare(`
            INSERT INTO financial_ledger (
              transaction_ref, seller_id, order_id, transaction_type, entry_type, amount, status, description
            ) VALUES (?, ?, ?, 'PLATFORM_FEE', 'CREDIT', ?, 'completed', ?)
          `).run(feeRef, sId, order.id, sFeeData.platform_fee, `VELORA Platform fee (3%) for Delivered Order #${order.id}`);
        }

        if (unassignedTotal > 0) {
          const feeRef = `LEDG_MKT_${order.id}_${Date.now()}`;
          db.prepare(`
            INSERT INTO financial_ledger (
              transaction_ref, seller_id, order_id, transaction_type, entry_type, amount, status, description
            ) VALUES (?, NULL, ?, 'PLATFORM_FEE', 'CREDIT', ?, 'completed', ?)
          `).run(feeRef, order.id, unassignedTotal, `Marketplace direct revenue for Delivered Order #${order.id}`);
        }
      } else {
        // Marketplace direct order
        const feeRef = `LEDG_MKT_${order.id}_${Date.now()}`;
        db.prepare(`
          INSERT INTO financial_ledger (
            transaction_ref, seller_id, order_id, transaction_type, entry_type, amount, status, description
          ) VALUES (?, NULL, ?, 'PLATFORM_FEE', 'CREDIT', ?, 'completed', ?)
        `).run(feeRef, order.id, total, `Marketplace direct revenue for Delivered Order #${order.id}`);
      }
    }

    // Ensure order record fee columns are synchronized
    db.prepare(`
      UPDATE orders
      SET platform_fee = COALESCE(platform_fee, ?),
          seller_payout = COALESCE(seller_payout, ?),
          fee_rate = COALESCE(fee_rate, ?)
      WHERE id = ?
    `).run(platformFee, sellerPayout, feeData.fee_rate, order.id);

    // Audit log
    db.prepare(`
      INSERT INTO financial_audit_logs (action, actor_type, actor_id, details)
      VALUES ('ORDER_SETTLEMENT_RECORDED', 'system', 'system', ?)
    `).run(`Settled Order #${order.id}: total ₹${total}, fee ₹${platformFee}, seller ₹${sellerPayout}`);
  });

  tx();
}

/**
 * Calculates genuine seller financial balances directly from database records.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} storeId
 */
export function calculateSellerFinancials(db, storeId) {
  // 1. Total Store Sales (all non-cancelled orders for this store)
  const salesRow = db.prepare(`
    SELECT
      COALESCE(SUM(total), 0) AS total_sales,
      COUNT(*) AS total_orders
    FROM orders
    WHERE store_id = ? AND status != 'Cancelled'
  `).get(storeId);

  // 2. Delivered / Settled Orders (settlement eligible)
  const deliveredRow = db.prepare(`
    SELECT
      COALESCE(SUM(total), 0) AS delivered_gross,
      COALESCE(SUM(COALESCE(platform_fee, ROUND(total * 0.03, 2))), 0) AS platform_fees,
      COALESCE(SUM(COALESCE(seller_payout, ROUND(total * 0.97, 2))), 0) AS net_seller_earnings,
      COUNT(*) AS delivered_count
    FROM orders
    WHERE store_id = ? AND status = 'Delivered'
  `).get(storeId);

  // 3. Pending Balance (paid or in-transit orders not yet Delivered)
  const pendingRow = db.prepare(`
    SELECT
      COALESCE(SUM(COALESCE(seller_payout, ROUND(total * 0.97, 2))), 0) AS pending_balance,
      COUNT(*) AS pending_count
    FROM orders
    WHERE store_id = ?
      AND status IN ('Pending', 'Processing', 'Shipped')
      AND (payment_status = 'Paid' OR payment_method = 'cod')
  `).get(storeId);

  // 4. Total Refunds (seller debited amount from completed refunds)
  const refundsRow = db.prepare(`
    SELECT
      COALESCE(SUM(r.seller_debited), 0) AS total_seller_refunds,
      COALESCE(SUM(r.amount), 0) AS total_order_refunds,
      COUNT(*) AS refund_count
    FROM refunds r
    JOIN orders o ON r.order_id = o.id
    WHERE o.store_id = ? AND r.status = 'completed'
  `).get(storeId);

  // 5. Total Withdrawn (completed payout requests)
  const withdrawnRow = db.prepare(`
    SELECT
      COALESCE(SUM(amount), 0) AS total_withdrawn,
      COUNT(*) AS completed_payout_count
    FROM payout_requests
    WHERE seller_id = ? AND status = 'completed'
  `).get(storeId);

  // 6. Pending Payouts (funds reserved in pending or processing payout requests)
  const pendingPayoutsRow = db.prepare(`
    SELECT
      COALESCE(SUM(amount), 0) AS total_pending_payouts,
      COUNT(*) AS pending_payout_count
    FROM payout_requests
    WHERE seller_id = ? AND status IN ('pending', 'processing')
  `).get(storeId);

  const grossEarnings = Math.round(Number(deliveredRow.delivered_gross) * 100) / 100;
  const platformFee = Math.round(Number(deliveredRow.platform_fees) * 100) / 100;
  const netEarnings = Math.round(Number(deliveredRow.net_seller_earnings) * 100) / 100;
  const pendingBalance = Math.round(Number(pendingRow.pending_balance) * 100) / 100;
  const refundedAmount = Math.round(Number(refundsRow.total_seller_refunds) * 100) / 100;
  const withdrawnAmount = Math.round(Number(withdrawnRow.total_withdrawn) * 100) / 100;
  const pendingPayouts = Math.round(Number(pendingPayoutsRow.total_pending_payouts) * 100) / 100;

  // Available balance: Net Delivered Earnings - Refunds - Withdrawn - Pending Payouts
  const availableBalance = Math.max(
    0,
    Math.round((netEarnings - refundedAmount - withdrawnAmount - pendingPayouts) * 100) / 100
  );

  return {
    store_id: storeId,
    total_sales: Math.round(Number(salesRow.total_sales) * 100) / 100,
    total_orders: salesRow.total_orders,
    gross_earnings: grossEarnings,
    platform_fee: platformFee,
    net_seller_earnings: netEarnings,
    pending_balance: pendingBalance,
    refunded_amount: refundedAmount,
    total_order_refunds: Math.round(Number(refundsRow.total_order_refunds) * 100) / 100,
    withdrawn_amount: withdrawnAmount,
    pending_payouts: pendingPayouts,
    available_balance: availableBalance,
    current_wallet_balance: availableBalance,
    delivered_orders_count: deliveredRow.delivered_count,
    pending_orders_count: pendingRow.pending_count,
    minimum_payout_amount: MIN_PAYOUT_AMOUNT
  };
}

/**
 * Calculates admin-wide financial summary across all orders, platform fees, and sellers.
 *
 * @param {import('better-sqlite3').Database} db
 */
export function calculateAdminFinancialOverview(db) {
  // GMV & Orders
  const gmvRow = db.prepare(`
    SELECT
      COALESCE(SUM(total), 0) AS total_gmv,
      COUNT(*) AS total_orders
    FROM orders
    WHERE status != 'Cancelled'
  `).get();

  // Successful Payments
  const paymentsRow = db.prepare(`
    SELECT
      COALESCE(SUM(amount), 0) AS total_paid_amount,
      COUNT(*) AS total_paid_count
    FROM payments
    WHERE status IN ('paid', 'captured')
  `).get();

  // Delivered Settlements
  const deliveredRow = db.prepare(`
    SELECT
      COALESCE(SUM(total), 0) AS delivered_volume,
      COALESCE(SUM(COALESCE(platform_fee, ROUND(total * 0.03, 2))), 0) AS total_platform_fees,
      COALESCE(SUM(COALESCE(seller_payout, ROUND(total * 0.97, 2))), 0) AS total_seller_earnings,
      COUNT(*) AS delivered_count
    FROM orders
    WHERE status = 'Delivered'
  `).get();

  // Pending Seller Balances (Paid orders waiting delivery)
  const pendingRow = db.prepare(`
    SELECT
      COALESCE(SUM(COALESCE(seller_payout, ROUND(total * 0.97, 2))), 0) AS pending_balances,
      COUNT(*) AS pending_count
    FROM orders
    WHERE status IN ('Pending', 'Processing', 'Shipped')
      AND (payment_status = 'Paid' OR payment_method = 'cod')
      AND store_id IS NOT NULL
  `).get();

  // Refunds
  const refundsRow = db.prepare(`
    SELECT
      COALESCE(SUM(amount), 0) AS total_refunds_amount,
      COALESCE(SUM(fee_reversed), 0) AS total_fees_reversed,
      COALESCE(SUM(seller_debited), 0) AS total_seller_debited,
      COUNT(*) AS total_refunds_count
    FROM refunds
    WHERE status = 'completed'
  `).get();

  // Payouts Summary
  const payoutsSummary = db.prepare(`
    SELECT
      status,
      COUNT(*) AS count,
      COALESCE(SUM(amount), 0) AS total_amount
    FROM payout_requests
    GROUP BY status
  `).all();

  const payouts = {
    pending: { count: 0, amount: 0 },
    processing: { count: 0, amount: 0 },
    completed: { count: 0, amount: 0 },
    rejected: { count: 0, amount: 0 }
  };

  for (const p of payoutsSummary) {
    if (payouts[p.status]) {
      payouts[p.status] = {
        count: p.count,
        amount: Math.round(p.total_amount * 100) / 100
      };
    }
  }

  // Calculate sum of available balances across all stores
  const stores = db.prepare("SELECT id FROM stores").all();
  let totalAvailableSellerBalances = 0;
  for (const s of stores) {
    const fin = calculateSellerFinancials(db, s.id);
    totalAvailableSellerBalances += fin.available_balance;
  }

  return {
    total_gmv: Math.round(Number(gmvRow.total_gmv) * 100) / 100,
    total_orders: gmvRow.total_orders,
    successful_payments_amount: Math.round(Number(paymentsRow.total_paid_amount) * 100) / 100,
    successful_payments_count: paymentsRow.total_paid_count,
    delivered_volume: Math.round(Number(deliveredRow.delivered_volume) * 100) / 100,
    total_platform_fees: Math.round(Number(deliveredRow.total_platform_fees) * 100) / 100,
    total_seller_earnings: Math.round(Number(deliveredRow.total_seller_earnings) * 100) / 100,
    pending_seller_balances: Math.round(Number(pendingRow.pending_balances) * 100) / 100,
    available_seller_balances: Math.round(totalAvailableSellerBalances * 100) / 100,
    total_refunds_amount: Math.round(Number(refundsRow.total_refunds_amount) * 100) / 100,
    total_refunds_count: refundsRow.total_refunds_count,
    payouts
  };
}

/**
 * Performs end-to-end accounting reconciliation between payments, orders, ledger, wallets, and payouts.
 *
 * @param {import('better-sqlite3').Database} db
 */
export function performFinancialReconciliation(db) {
  // 1. Payments vs Orders: Sum of paid payments vs paid orders
  const paidPayments = db.prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE status = 'paid'").get().total;
  const paidOrders = db.prepare("SELECT COALESCE(SUM(total), 0) AS total FROM orders WHERE payment_status = 'Paid'").get().total;
  const paymentOrderDiff = Math.abs(paidPayments - paidOrders);

  // 2. Refunds: refunds table vs payments refunded_amount
  const refundsTableSum = db.prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM refunds WHERE status = 'completed'").get().total;
  const paymentsRefundedSum = db.prepare("SELECT COALESCE(SUM(refunded_amount), 0) AS total FROM payments").get().total;
  const refundDiff = Math.abs(refundsTableSum - paymentsRefundedSum);

  // 3. Completed Payouts: payout_requests vs ledger
  const completedPayoutsSum = db.prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM payout_requests WHERE status = 'completed'").get().total;
  const ledgerPayoutDebitsSum = db.prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM financial_ledger WHERE transaction_type = 'PAYOUT_DEBIT' AND status = 'completed'").get().total;
  const payoutDiff = Math.abs(completedPayoutsSum - ledgerPayoutDebitsSum);

  // 4. Ledger Double-Entry Balance Check
  const ledgerTotalCredits = db.prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM financial_ledger WHERE entry_type = 'CREDIT'").get().total;
  const ledgerTotalDebits = db.prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM financial_ledger WHERE entry_type = 'DEBIT'").get().total;

  const isReconciled = paymentOrderDiff < 0.01 && refundDiff < 0.01 && payoutDiff < 0.01;

  return {
    is_reconciled: isReconciled,
    payments_to_orders: {
      paid_payments_total: Math.round(paidPayments * 100) / 100,
      paid_orders_total: Math.round(paidOrders * 100) / 100,
      difference: Math.round(paymentOrderDiff * 100) / 100,
      matches: paymentOrderDiff < 0.01
    },
    refunds_reconciliation: {
      refunds_recorded_total: Math.round(refundsTableSum * 100) / 100,
      payments_refunded_total: Math.round(paymentsRefundedSum * 100) / 100,
      difference: Math.round(refundDiff * 100) / 100,
      matches: refundDiff < 0.01
    },
    payouts_reconciliation: {
      completed_payouts_total: Math.round(completedPayoutsSum * 100) / 100,
      ledger_payout_debits: Math.round(ledgerPayoutDebitsSum * 100) / 100,
      difference: Math.round(payoutDiff * 100) / 100,
      matches: payoutDiff < 0.01
    },
    ledger_totals: {
      total_credits: Math.round(ledgerTotalCredits * 100) / 100,
      total_debits: Math.round(ledgerTotalDebits * 100) / 100,
      net: Math.round((ledgerTotalCredits - ledgerTotalDebits) * 100) / 100
    },
    timestamp: new Date().toISOString()
  };
}

/**
 * Mask sensitive bank account number: '•••• •••• 1234'
 *
 * @param {string} accountNum
 */
export function maskBankAccount(accountNum) {
  if (!accountNum || typeof accountNum !== "string") return "";
  const clean = accountNum.trim();
  if (clean.length <= 4) return clean;
  const last4 = clean.slice(-4);
  return `•••• •••• ${last4}`;
}

/**
 * Registers all Financial API routes for Sellers, Admins, and Razorpay Webhooks.
 *
 * @param {import('express').Express} app
 * @param {import('better-sqlite3').Database} db
 * @param {string} jwtSecret
 * @param {string} adminSecret
 */
export function registerFinancialRoutes(app, db, jwtSecret, adminSecret) {
  initFinancialDatabase(db);

  const authenticateSeller = createSellerAuthenticator(jwtSecret);
  const authenticateAdmin = createAdminAuthenticator(adminSecret);

  function getSellerStore(userId) {
    return db.prepare("SELECT * FROM stores WHERE owner_user_id = ? LIMIT 1").get(userId);
  }

  // ===========================================================================
  // MODULE 2 — RAZORPAY WEBHOOK ENDPOINT
  // ===========================================================================

  app.post("/api/payments/webhook", (req, res) => {
    try {
      const webhookSignature = req.headers["x-razorpay-signature"];
      const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || process.env.RAZORPAY_KEY_SECRET;

      if (!webhookSignature || typeof webhookSignature !== "string") {
        return res.status(400).json({
          status: "error",
          code: "MISSING_WEBHOOK_SIGNATURE",
          message: "x-razorpay-signature header is missing."
        });
      }

      if (!webhookSecret) {
        console.error("Webhook rejected: RAZORPAY_WEBHOOK_SECRET or RAZORPAY_KEY_SECRET is not configured.");
        return res.status(500).json({
          status: "error",
          code: "CONFIG_ERROR",
          message: "Webhook secret is not configured on server."
        });
      }

      // Verify raw payload signature using HMAC SHA256
      const rawPayload = req.rawBody
        ? req.rawBody
        : Buffer.from(JSON.stringify(req.body || {}), "utf8");

      const expectedSignature = crypto
        .createHmac("sha256", webhookSecret)
        .update(rawPayload)
        .digest("hex");

      const isValid =
        expectedSignature.length === webhookSignature.length &&
        crypto.timingSafeEqual(Buffer.from(expectedSignature, "utf8"), Buffer.from(webhookSignature, "utf8"));

      if (!isValid) {
        console.warn("Invalid Razorpay webhook signature detected!");
        return res.status(400).json({
          status: "error",
          code: "INVALID_SIGNATURE",
          message: "Razorpay webhook signature verification failed."
        });
      }

      const event = req.body ?? {};
      const eventId = event.event_id || req.headers["x-razorpay-event-id"] || `evt_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
      const eventType = event.event || "unknown";

      // 1. Idempotency Check
      const existingEvent = db.prepare("SELECT id FROM webhook_events WHERE event_id = ?").get(eventId);
      if (existingEvent) {
        return res.json({
          status: "success",
          duplicate: true,
          message: "Webhook event already processed."
        });
      }

      // 2. Process webhook event atomically
      const webhookTx = db.transaction(() => {
        if (eventType === "payment.captured" || eventType === "order.paid") {
          const paymentEntity = event.payload?.payment?.entity || {};
          const razorpayOrderId = paymentEntity.order_id;
          const razorpayPaymentId = paymentEntity.id;

          if (razorpayOrderId) {
            const payment = db.prepare("SELECT * FROM payments WHERE razorpay_order_id = ?").get(razorpayOrderId);
            if (payment && payment.status !== "paid") {
              db.prepare(`
                UPDATE payments
                SET status = 'paid',
                    verification_status = 'verified',
                    razorpay_payment_id = COALESCE(razorpay_payment_id, ?),
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
              `).run(razorpayPaymentId || `pay_wh_${Date.now()}`, payment.id);

              db.prepare(`
                UPDATE orders
                SET payment_status = 'Paid',
                    razorpay_payment_id = COALESCE(razorpay_payment_id, ?)
                WHERE id = ?
              `).run(razorpayPaymentId || `pay_wh_${Date.now()}`, payment.order_id);
            }
          }
        } else if (eventType === "payment.failed") {
          const paymentEntity = event.payload?.payment?.entity || {};
          const razorpayOrderId = paymentEntity.order_id;

          if (razorpayOrderId) {
            const payment = db.prepare("SELECT * FROM payments WHERE razorpay_order_id = ?").get(razorpayOrderId);
            if (payment && payment.status !== "paid") {
              db.prepare(`
                UPDATE payments
                SET status = 'failed',
                    verification_status = 'failed',
                    error_code = ?,
                    error_description = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
              `).run(paymentEntity.error_code || "PAYMENT_FAILED", paymentEntity.error_description || "Webhook payment failed", payment.id);

              db.prepare("UPDATE orders SET payment_status = 'Failed' WHERE id = ?").run(payment.order_id);
            }
          }
        } else if (eventType === "refund.processed" || eventType === "refund.created") {
          const refundEntity = event.payload?.refund?.entity || {};
          const razorpayPaymentId = refundEntity.payment_id;
          const refundAmount = (Number(refundEntity.amount) || 0) / 100;

          if (razorpayPaymentId && refundAmount > 0) {
            const payment = db.prepare("SELECT * FROM payments WHERE razorpay_payment_id = ?").get(razorpayPaymentId);
            if (payment) {
              const existingRefund = db.prepare("SELECT id FROM refunds WHERE razorpay_refund_id = ?").get(refundEntity.id);
              if (!existingRefund) {
                const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(payment.order_id);
                const ratio = order.total > 0 ? refundAmount / order.total : 1;
                const isDelivered = order.status === "Delivered";
                const feeReversed = isDelivered ? Math.round((order.platform_fee || (order.total * 0.03)) * ratio * 100) / 100 : 0;
                const sellerDebited = Math.round((refundAmount - feeReversed) * 100) / 100;

                const refundRef = `RFND_WH_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
                db.prepare(`
                  INSERT INTO refunds (
                    refund_ref, order_id, payment_id, razorpay_refund_id, amount, reason, status, fee_reversed, seller_debited, created_by
                  ) VALUES (?, ?, ?, ?, ?, 'Webhook refund processed', 'completed', ?, ?, 'webhook')
                `).run(refundRef, order.id, payment.id, refundEntity.id || null, refundAmount, feeReversed, sellerDebited);

                db.prepare("UPDATE payments SET refunded_amount = refunded_amount + ? WHERE id = ?").run(refundAmount, payment.id);
                db.prepare(`
                  UPDATE orders
                  SET refunded_amount = refunded_amount + ?,
                      refund_status = CASE WHEN (refunded_amount + ?) >= total THEN 'full' ELSE 'partial' END
                  WHERE id = ?
                `).run(refundAmount, refundAmount, order.id);

                if (order.store_id) {
                  db.prepare(`
                    INSERT INTO financial_ledger (
                      transaction_ref, seller_id, order_id, transaction_type, entry_type, amount, status, description
                    ) VALUES (?, ?, ?, 'REFUND_DEBIT', 'DEBIT', ?, 'completed', ?)
                  `).run(`LEDG_RFND_WH_${Date.now()}`, order.store_id, order.id, sellerDebited, `Webhook refund debit for Order #${order.id}`);
                }
              }
            }
          }
        }

        // Record processed webhook event
        db.prepare(`
          INSERT INTO webhook_events (event_id, event_type, entity_id, status, payload)
          VALUES (?, ?, ?, 'processed', ?)
        `).run(eventId, eventType, event.payload?.payment?.entity?.id || null, JSON.stringify(event));

        // Audit log
        db.prepare(`
          INSERT INTO financial_audit_logs (action, actor_type, actor_id, details)
          VALUES ('WEBHOOK_PROCESSED', 'webhook', ?, ?)
        `).run(eventId, `Handled event: ${eventType}`);
      });

      webhookTx();

      return res.json({
        status: "success",
        message: `Webhook event ${eventType} processed successfully.`,
        eventId
      });
    } catch (error) {
      console.error("Razorpay webhook error:", error);
      return res.status(500).json({
        status: "error",
        code: "WEBHOOK_PROCESSING_FAILED",
        message: "Failed to process webhook event."
      });
    }
  });

  // ===========================================================================
  // MODULE 3 & MODULE 7 — SELLER WALLET & FINANCIAL DASHBOARD
  // ===========================================================================

  // GET /api/seller/wallet — Authenticated Seller Wallet Balance & Summary
  app.get("/api/seller/wallet", authenticateSeller, (req, res) => {
    try {
      const store = getSellerStore(req.seller.id);
      if (!store) {
        return res.status(404).json({ status: "error", message: "Seller store not found." });
      }

      const financials = calculateSellerFinancials(db, store.id);

      return res.json({
        status: "success",
        store: {
          id: store.id,
          name: store.name,
          bank_name: store.bank_name || "",
          bank_account_holder: store.bank_account_holder || "",
          bank_account_masked: maskBankAccount(store.bank_account_number),
          bank_ifsc: store.bank_ifsc || ""
        },
        financials
      });
    } catch (error) {
      console.error("Get seller wallet error:", error);
      return res.status(500).json({ status: "error", message: "Failed to calculate seller wallet." });
    }
  });

  // GET /api/seller/financials/transactions — Seller-Isolated Ledger History
  app.get("/api/seller/financials/transactions", authenticateSeller, (req, res) => {
    try {
      const store = getSellerStore(req.seller.id);
      if (!store) {
        return res.status(404).json({ status: "error", message: "Seller store not found." });
      }

      const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
      const transactions = db.prepare(`
        SELECT
          id,
          transaction_ref,
          order_id,
          payout_id,
          refund_id,
          transaction_type,
          entry_type,
          amount,
          status,
          description,
          created_at
        FROM financial_ledger
        WHERE seller_id = ?
        ORDER BY id DESC
        LIMIT ?
      `).all(store.id, limit);

      return res.json({
        status: "success",
        count: transactions.length,
        transactions
      });
    } catch (error) {
      console.error("Get seller transactions error:", error);
      return res.status(500).json({ status: "error", message: "Failed to fetch transactions." });
    }
  });

  // ===========================================================================
  // MODULE 4 — SELLER PAYOUT SYSTEM
  // ===========================================================================

  // POST /api/seller/payouts/request — Request Payout from Available Balance
  app.post("/api/seller/payouts/request", authenticateSeller, (req, res) => {
    try {
      const store = getSellerStore(req.seller.id);
      if (!store) {
        return res.status(404).json({ status: "error", message: "Seller store not found." });
      }

      // Check bank account configuration
      if (!store.bank_account_number || !store.bank_ifsc || !store.bank_account_holder) {
        return res.status(400).json({
          status: "error",
          code: "MISSING_BANK_DETAILS",
          message: "Please configure your verified settlement bank account details in Settings before requesting a payout."
        });
      }

      const { amount } = req.body ?? {};
      const payoutAmount = Math.round(Number(amount) * 100) / 100;

      if (!Number.isFinite(payoutAmount) || payoutAmount <= 0) {
        return res.status(400).json({
          status: "error",
          code: "INVALID_AMOUNT",
          message: "Valid payout amount greater than zero is required."
        });
      }

      if (payoutAmount < MIN_PAYOUT_AMOUNT) {
        return res.status(400).json({
          status: "error",
          code: "BELOW_MINIMUM",
          message: `Minimum payout request amount is ₹${MIN_PAYOUT_AMOUNT}. Requested ₹${payoutAmount}.`
        });
      }

      // Prevent duplicate pending requests for the same exact minute
      const recentPending = db.prepare(`
        SELECT id FROM payout_requests
        WHERE seller_id = ? AND status = 'pending' AND amount = ?
          AND datetime(requested_at) >= datetime('now', '-1 minute')
      `).get(store.id, payoutAmount);

      if (recentPending) {
        return res.status(429).json({
          status: "error",
          code: "DUPLICATE_REQUEST",
          message: "A matching payout request is already being processed. Please wait a moment."
        });
      }

      // Check available balance
      const financials = calculateSellerFinancials(db, store.id);
      if (payoutAmount > financials.available_balance) {
        return res.status(400).json({
          status: "error",
          code: "INSUFFICIENT_BALANCE",
          message: `Insufficient available balance. Available: ₹${financials.available_balance}, Requested: ₹${payoutAmount}.`
        });
      }

      const payoutRef = `PAYOUT_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
      let createdPayoutId;

      const createPayoutTx = db.transaction(() => {
        const insertRes = db.prepare(`
          INSERT INTO payout_requests (
            payout_ref,
            seller_id,
            amount,
            status,
            bank_name,
            bank_account_number,
            bank_ifsc,
            bank_account_holder,
            requested_at
          ) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `).run(
          payoutRef,
          store.id,
          payoutAmount,
          store.bank_name || "Bank Account",
          store.bank_account_number,
          store.bank_ifsc,
          store.bank_account_holder
        );

        createdPayoutId = insertRes.lastInsertRowid;

        // Record pending payout debit in immutable ledger
        const ledgerRef = `LEDG_POUT_${createdPayoutId}_${Date.now()}`;
        db.prepare(`
          INSERT INTO financial_ledger (
            transaction_ref, seller_id, payout_id, transaction_type, entry_type, amount, status, description
          ) VALUES (?, ?, ?, 'PAYOUT_DEBIT', 'DEBIT', ?, 'pending', ?)
        `).run(
          ledgerRef,
          store.id,
          createdPayoutId,
          payoutAmount,
          `Payout request of ₹${payoutAmount} to ${store.bank_name || "Bank"} (${maskBankAccount(store.bank_account_number)})`
        );

        // Record audit log
        db.prepare(`
          INSERT INTO financial_audit_logs (action, actor_type, actor_id, details)
          VALUES ('PAYOUT_REQUESTED', 'seller', ?, ?)
        `).run(String(req.seller.id), `Requested payout ₹${payoutAmount} (${payoutRef})`);
      });

      createPayoutTx();

      const created = db.prepare("SELECT * FROM payout_requests WHERE id = ?").get(createdPayoutId);
      const updatedFinancials = calculateSellerFinancials(db, store.id);

      return res.status(201).json({
        status: "success",
        message: `Payout request of ₹${payoutAmount} submitted successfully. It will be reviewed and transferred by VELORA Finance.`,
        payout: {
          ...created,
          bank_account_number: maskBankAccount(created.bank_account_number)
        },
        financials: updatedFinancials
      });
    } catch (error) {
      console.error("Request payout error:", error);
      return res.status(500).json({ status: "error", message: "Failed to submit payout request." });
    }
  });

  // GET /api/seller/payouts — List Seller's Payout Requests
  app.get("/api/seller/payouts", authenticateSeller, (req, res) => {
    try {
      const store = getSellerStore(req.seller.id);
      if (!store) {
        return res.status(404).json({ status: "error", message: "Seller store not found." });
      }

      const payouts = db.prepare(`
        SELECT
          id,
          payout_ref,
          amount,
          status,
          bank_name,
          bank_account_number,
          bank_ifsc,
          bank_account_holder,
          utr_reference,
          admin_notes,
          requested_at,
          processed_at,
          created_at
        FROM payout_requests
        WHERE seller_id = ?
        ORDER BY id DESC
      `).all(store.id);

      const maskedPayouts = payouts.map((p) => ({
        ...p,
        bank_account_number: maskBankAccount(p.bank_account_number)
      }));

      return res.json({
        status: "success",
        count: maskedPayouts.length,
        payouts: maskedPayouts
      });
    } catch (error) {
      console.error("Get seller payouts error:", error);
      return res.status(500).json({ status: "error", message: "Failed to fetch payouts." });
    }
  });

  // ===========================================================================
  // MODULE 5 & MODULE 8 — ADMIN FINANCIAL DASHBOARD, PAYOUTS & REFUNDS
  // ===========================================================================

  // GET /api/admin/financials/overview — Admin Financial Dashboard Summary
  app.get("/api/admin/financials/overview", authenticateAdmin, (_req, res) => {
    try {
      const overview = calculateAdminFinancialOverview(db);
      const reconciliation = performFinancialReconciliation(db);

      return res.json({
        status: "success",
        overview,
        reconciliation
      });
    } catch (error) {
      console.error("Admin financials overview error:", error);
      return res.status(500).json({ status: "error", message: "Failed to generate financial overview." });
    }
  });

  // GET /api/admin/financials/payouts — Admin View All Payout Requests
  app.get("/api/admin/financials/payouts", authenticateAdmin, (req, res) => {
    try {
      const statusFilter = req.query.status;
      let query = `
        SELECT
          p.*,
          s.name AS store_name,
          s.slug AS store_slug,
          u.email AS seller_email
        FROM payout_requests p
        JOIN stores s ON p.seller_id = s.id
        JOIN users u ON s.owner_user_id = u.id
      `;
      const params = [];

      if (statusFilter && ["pending", "processing", "completed", "rejected"].includes(statusFilter)) {
        query += " WHERE p.status = ?";
        params.push(statusFilter);
      }

      query += " ORDER BY p.id DESC";

      const payouts = db.prepare(query).all(...params);

      return res.json({
        status: "success",
        count: payouts.length,
        payouts
      });
    } catch (error) {
      console.error("Admin get payouts error:", error);
      return res.status(500).json({ status: "error", message: "Failed to fetch payout requests." });
    }
  });

  // PUT /api/admin/financials/payouts/:id/approve — Approve & Complete Payout Request
  app.put("/api/admin/financials/payouts/:id/approve", authenticateAdmin, (req, res) => {
    try {
      const payoutId = Number(req.params.id);
      if (!Number.isSafeInteger(payoutId) || payoutId <= 0) {
        return res.status(400).json({ status: "error", message: "Invalid payout ID." });
      }

      const { utr_reference = "", admin_notes = "" } = req.body ?? {};
      const cleanUtr = String(utr_reference).trim();

      if (!cleanUtr) {
        return res.status(400).json({
          status: "error",
          code: "MISSING_UTR",
          message: "Bank transaction UTR / Reference number is required to confirm a payout."
        });
      }

      const payout = db.prepare("SELECT * FROM payout_requests WHERE id = ?").get(payoutId);
      if (!payout) {
        return res.status(404).json({ status: "error", message: "Payout request not found." });
      }

      if (payout.status === "completed") {
        return res.status(400).json({
          status: "error",
          code: "ALREADY_COMPLETED",
          message: "Payout request has already been completed."
        });
      }

      if (payout.status === "rejected") {
        return res.status(400).json({
          status: "error",
          code: "ALREADY_REJECTED",
          message: "Cannot approve a previously rejected payout."
        });
      }

      const approveTx = db.transaction(() => {
        db.prepare(`
          UPDATE payout_requests
          SET status = 'completed',
              utr_reference = ?,
              admin_notes = ?,
              processed_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(cleanUtr, admin_notes.trim(), payoutId);

        // Record a new completed payout ledger entry
        const completedLedgerRef = `LEDG_POUT_CMP_${payoutId}_${Date.now()}`;
        db.prepare(`
          INSERT INTO financial_ledger (
            transaction_ref, seller_id, payout_id, transaction_type, entry_type, amount, status, related_ref, description
          ) VALUES (?, ?, ?, 'PAYOUT_DEBIT', 'DEBIT', ?, 'completed', ?, ?)
        `).run(
          completedLedgerRef,
          payout.seller_id,
          payout.id,
          payout.amount,
          payout.payout_ref,
          `Completed payout of ₹${payout.amount} via UTR ${cleanUtr}`
        );

        // Audit log
        db.prepare(`
          INSERT INTO financial_audit_logs (action, actor_type, actor_id, details)
          VALUES ('PAYOUT_APPROVED', 'admin', 'admin', ?)
        `).run(`Approved payout #${payoutId} (₹${payout.amount}) with UTR: ${cleanUtr}`);
      });

      approveTx();

      const updated = db.prepare("SELECT * FROM payout_requests WHERE id = ?").get(payoutId);

      return res.json({
        status: "success",
        message: "Payout marked as completed. Funds settled to seller bank account.",
        payout: updated
      });
    } catch (error) {
      console.error("Approve payout error:", error);
      return res.status(500).json({ status: "error", message: "Failed to approve payout." });
    }
  });

  // PUT /api/admin/financials/payouts/:id/reject — Reject Payout & Return Balance to Seller
  app.put("/api/admin/financials/payouts/:id/reject", authenticateAdmin, (req, res) => {
    try {
      const payoutId = Number(req.params.id);
      if (!Number.isSafeInteger(payoutId) || payoutId <= 0) {
        return res.status(400).json({ status: "error", message: "Invalid payout ID." });
      }

      const { reason = "Rejected by administration" } = req.body ?? {};

      const payout = db.prepare("SELECT * FROM payout_requests WHERE id = ?").get(payoutId);
      if (!payout) {
        return res.status(404).json({ status: "error", message: "Payout request not found." });
      }

      if (payout.status === "completed") {
        return res.status(400).json({
          status: "error",
          code: "ALREADY_COMPLETED",
          message: "Cannot reject an already completed payout."
        });
      }

      if (payout.status === "rejected") {
        return res.status(400).json({
          status: "error",
          code: "ALREADY_REJECTED",
          message: "Payout is already marked rejected."
        });
      }

      const rejectTx = db.transaction(() => {
        db.prepare(`
          UPDATE payout_requests
          SET status = 'rejected',
              admin_notes = ?,
              processed_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(reason.trim(), payoutId);

        // Immutable ledger reversal entry: CREDIT back to seller
        const reversalRef = `LEDG_POUT_REV_${payoutId}_${Date.now()}`;
        db.prepare(`
          INSERT INTO financial_ledger (
            transaction_ref, seller_id, payout_id, transaction_type, entry_type, amount, status, related_ref, description
          ) VALUES (?, ?, ?, 'PAYOUT_REVERSAL', 'CREDIT', ?, 'completed', ?, ?)
        `).run(
          reversalRef,
          payout.seller_id,
          payout.id,
          payout.amount,
          payout.payout_ref,
          `Payout request #${payoutId} rejected: ${reason.trim()}. Balance released.`
        );

        // Audit log
        db.prepare(`
          INSERT INTO financial_audit_logs (action, actor_type, actor_id, details)
          VALUES ('PAYOUT_REJECTED', 'admin', 'admin', ?)
        `).run(`Rejected payout #${payoutId} (₹${payout.amount}). Reason: ${reason}`);
      });

      rejectTx();

      const updated = db.prepare("SELECT * FROM payout_requests WHERE id = ?").get(payoutId);

      return res.json({
        status: "success",
        message: "Payout rejected. Reserved funds returned to seller's available balance.",
        payout: updated
      });
    } catch (error) {
      console.error("Reject payout error:", error);
      return res.status(500).json({ status: "error", message: "Failed to reject payout." });
    }
  });

  // ===========================================================================
  // MODULE 5 — REFUND SYSTEM ENDPOINTS
  // ===========================================================================

  // POST /api/admin/financials/refunds — Process Full or Partial Refund
  app.post("/api/admin/financials/refunds", authenticateAdmin, async (req, res) => {
    try {
      const { order_id, amount, reason = "Customer refund requested" } = req.body ?? {};

      const orderId = Number(order_id);
      if (!Number.isSafeInteger(orderId) || orderId <= 0) {
        return res.status(400).json({ status: "error", message: "Valid order_id is required." });
      }

      const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId);
      if (!order) {
        return res.status(404).json({ status: "error", message: "Order not found." });
      }

      if (order.payment_status !== "Paid") {
        return res.status(400).json({
          status: "error",
          code: "ORDER_NOT_PAID",
          message: "Only orders with Paid status can be refunded."
        });
      }

      const payment = db
        .prepare("SELECT * FROM payments WHERE order_id = ? AND status = 'paid' ORDER BY id DESC LIMIT 1")
        .get(orderId);

      if (!payment) {
        return res.status(400).json({
          status: "error",
          code: "PAYMENT_NOT_FOUND",
          message: "No verified paid transaction found for this order."
        });
      }

      const alreadyRefunded = Number(payment.refunded_amount) || 0;
      const maxRefundable = Math.max(0, Math.round((payment.amount - alreadyRefunded) * 100) / 100);

      if (maxRefundable <= 0) {
        return res.status(400).json({
          status: "error",
          code: "FULLY_REFUNDED",
          message: "This transaction has already been fully refunded."
        });
      }

      const refundAmount = amount !== undefined && amount !== null && amount !== ""
        ? Math.round(Number(amount) * 100) / 100
        : maxRefundable;

      if (!Number.isFinite(refundAmount) || refundAmount <= 0) {
        return res.status(400).json({
          status: "error",
          code: "INVALID_AMOUNT",
          message: "Refund amount must be greater than zero."
        });
      }

      if (refundAmount > maxRefundable) {
        return res.status(400).json({
          status: "error",
          code: "EXCEEDS_MAX_REFUNDABLE",
          message: `Requested refund of ₹${refundAmount} exceeds maximum remaining refundable balance of ₹${maxRefundable}.`
        });
      }

      // External Razorpay Refund API call
      let razorpayRefundId = null;
      let gatewayStatus = "sandbox_simulated";
      const config = getRazorpayConfig();
      const client = getRazorpayClient();

      if (client && !config.isSimulation && payment.razorpay_payment_id) {
        try {
          const rzpRefund = await client.payments.refund(payment.razorpay_payment_id, {
            amount: Math.round(refundAmount * 100),
            notes: {
              order_id: String(orderId),
              reason: String(reason).slice(0, 200)
            }
          });
          razorpayRefundId = rzpRefund?.id || null;
          gatewayStatus = rzpRefund?.status || "processed";
        } catch (rzpErr) {
          console.error("Razorpay refund error:", rzpErr);
          return res.status(502).json({
            status: "error",
            code: "GATEWAY_REFUND_FAILED",
            message: `Gateway refund failed: ${rzpErr.error?.description || rzpErr.message}`
          });
        }
      } else {
        razorpayRefundId = `rfnd_test_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
      }

      // Proportional fee and seller adjustments
      const ratio = order.total > 0 ? refundAmount / order.total : 1;
      const isDelivered = order.status === "Delivered";

      // If delivered, reverse the proportional 3% platform fee and debit seller 97%
      const feeReversed = isDelivered
        ? Math.round((order.platform_fee || (order.total * 0.03)) * ratio * 100) / 100
        : 0;
      const sellerDebited = Math.round((refundAmount - feeReversed) * 100) / 100;

      const refundRef = `RFND_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
      let createdRefundId;

      const processRefundTx = db.transaction(() => {
        const refundInsert = db.prepare(`
          INSERT INTO refunds (
            refund_ref,
            order_id,
            payment_id,
            razorpay_refund_id,
            amount,
            reason,
            status,
            gateway_status,
            fee_reversed,
            seller_debited,
            created_by
          ) VALUES (?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, 'admin')
        `).run(
          refundRef,
          order.id,
          payment.id,
          razorpayRefundId,
          refundAmount,
          reason,
          gatewayStatus,
          feeReversed,
          sellerDebited
        );

        createdRefundId = refundInsert.lastInsertRowid;

        // Update payment & order refunded balances
        db.prepare("UPDATE payments SET refunded_amount = refunded_amount + ? WHERE id = ?").run(
          refundAmount,
          payment.id
        );

        const newRefundTotal = alreadyRefunded + refundAmount;
        const newRefundStatus = newRefundTotal >= order.total ? "full" : "partial";

        db.prepare(`
          UPDATE orders
          SET refunded_amount = refunded_amount + ?,
              refund_status = ?
          WHERE id = ?
        `).run(refundAmount, newRefundStatus, order.id);

        // Record in financial ledger if seller order
        if (order.store_id) {
          // Seller debit entry
          const debitRef = `LEDG_RFND_SELLER_${createdRefundId}_${Date.now()}`;
          db.prepare(`
            INSERT INTO financial_ledger (
              transaction_ref, seller_id, order_id, refund_id, transaction_type, entry_type, amount, status, related_ref, description
            ) VALUES (?, ?, ?, ?, 'REFUND_DEBIT', 'DEBIT', ?, 'completed', ?, ?)
          `).run(
            debitRef,
            order.store_id,
            order.id,
            createdRefundId,
            sellerDebited,
            refundRef,
            `Refund debit for Order #${order.id} (amount: ₹${refundAmount}, seller portion: ₹${sellerDebited})`
          );

          // Platform fee reversal entry (3%)
          if (feeReversed > 0) {
            const feeRevRef = `LEDG_RFND_FEE_${createdRefundId}_${Date.now()}`;
            db.prepare(`
              INSERT INTO financial_ledger (
                transaction_ref, seller_id, order_id, refund_id, transaction_type, entry_type, amount, status, related_ref, description
              ) VALUES (?, ?, ?, ?, 'REFUND_FEE_REVERSAL', 'DEBIT', ?, 'completed', ?, ?)
            `).run(
              feeRevRef,
              order.store_id,
              order.id,
              createdRefundId,
              feeReversed,
              refundRef,
              `Platform fee reversal (3%) of ₹${feeReversed} for Order #${order.id}`
            );
          }
        }

        // Audit log
        db.prepare(`
          INSERT INTO financial_audit_logs (action, actor_type, actor_id, details)
          VALUES ('REFUND_PROCESSED', 'admin', 'admin', ?)
        `).run(`Refunded ₹${refundAmount} for Order #${orderId} (${refundRef})`);
      });

      processRefundTx();

      const refundRecord = db.prepare("SELECT * FROM refunds WHERE id = ?").get(createdRefundId);
      const updatedOrder = db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId);

      return res.status(201).json({
        status: "success",
        message: `Refund of ₹${refundAmount} processed successfully.`,
        refund: refundRecord,
        order: {
          id: updatedOrder.id,
          total: updatedOrder.total,
          refunded_amount: updatedOrder.refunded_amount,
          refund_status: updatedOrder.refund_status
        }
      });
    } catch (error) {
      console.error("Process refund error:", error);
      return res.status(500).json({ status: "error", message: "Failed to process refund." });
    }
  });

  // GET /api/admin/financials/refunds — List All Processed Refunds
  app.get("/api/admin/financials/refunds", authenticateAdmin, (_req, res) => {
    try {
      const refunds = db.prepare(`
        SELECT
          r.*,
          o.customer_name,
          o.email AS customer_email,
          s.name AS store_name
        FROM refunds r
        JOIN orders o ON r.order_id = o.id
        LEFT JOIN stores s ON o.store_id = s.id
        ORDER BY r.id DESC
      `).all();

      return res.json({
        status: "success",
        count: refunds.length,
        refunds
      });
    } catch (error) {
      console.error("Admin get refunds error:", error);
      return res.status(500).json({ status: "error", message: "Failed to fetch refunds." });
    }
  });

  // GET /api/admin/financials/ledger — Full Immutable Financial Ledger
  app.get("/api/admin/financials/ledger", authenticateAdmin, (req, res) => {
    try {
      const { seller_id, order_id, type } = req.query;
      let query = `
        SELECT
          fl.*,
          s.name AS store_name
        FROM financial_ledger fl
        LEFT JOIN stores s ON fl.seller_id = s.id
        WHERE 1=1
      `;
      const params = [];

      if (seller_id) {
        query += " AND fl.seller_id = ?";
        params.push(Number(seller_id));
      }
      if (order_id) {
        query += " AND fl.order_id = ?";
        params.push(Number(order_id));
      }
      if (type) {
        query += " AND fl.transaction_type = ?";
        params.push(String(type));
      }

      query += " ORDER BY fl.id DESC LIMIT 200";

      const ledger = db.prepare(query).all(...params);

      return res.json({
        status: "success",
        count: ledger.length,
        ledger
      });
    } catch (error) {
      console.error("Admin get ledger error:", error);
      return res.status(500).json({ status: "error", message: "Failed to fetch ledger." });
    }
  });

  // GET /api/admin/financials/audit-logs — Financial Audit Logs
  app.get("/api/admin/financials/audit-logs", authenticateAdmin, (_req, res) => {
    try {
      const logs = db.prepare(`
        SELECT * FROM financial_audit_logs ORDER BY id DESC LIMIT 100
      `).all();

      return res.json({
        status: "success",
        count: logs.length,
        logs
      });
    } catch (error) {
      console.error("Admin get audit logs error:", error);
      return res.status(500).json({ status: "error", message: "Failed to fetch audit logs." });
    }
  });

  // GET /api/admin/financials/reconciliation — System Reconciliation Report
  app.get("/api/admin/financials/reconciliation", authenticateAdmin, (_req, res) => {
    try {
      const report = performFinancialReconciliation(db);
      return res.json({
        status: "success",
        reconciliation: report
      });
    } catch (error) {
      console.error("Admin reconciliation error:", error);
      return res.status(500).json({ status: "error", message: "Failed to generate reconciliation report." });
    }
  });
}
