import "./AdminDashboard.css";
import { useCallback, useEffect, useState } from "react";
import PasswordInput from "./PasswordInput";

type OrderStatus =
  | "Pending"
  | "Processing"
  | "Shipped"
  | "Delivered"
  | "Cancelled";

type OrderItem = {
  id?: number;
  name: string;
  price: number;
  quantity: number;
};

type Order = {
  id: number;
  customer_name: string;
  email: string;
  total: number;
  items: OrderItem[];
  created_at: string;
  status: OrderStatus;
  payment_status?: string | null;
  razorpay_order_id?: string | null;
  razorpay_payment_id?: string | null;
  refund_status?: string | null;
  refunded_amount?: number | null;
  store_name?: string | null;
  store_slug?: string | null;
  platform_fee?: number | null;
  seller_payout?: number | null;
  fee_rate?: number | null;
};

type AdminFinancialOverview = {
  total_gmv: number;
  total_orders: number;
  successful_payments_amount: number;
  successful_payments_count: number;
  delivered_volume: number;
  total_platform_fees: number;
  total_seller_earnings: number;
  pending_seller_balances: number;
  available_seller_balances: number;
  total_refunds_amount: number;
  total_refunds_count: number;
  payouts: {
    pending: { count: number; amount: number };
    processing: { count: number; amount: number };
    completed: { count: number; amount: number };
    rejected: { count: number; amount: number };
  };
};

type FinancialReconciliation = {
  is_reconciled: boolean;
  payments_to_orders: {
    paid_payments_total: number;
    paid_orders_total: number;
    difference: number;
    matches: boolean;
  };
  refunds_reconciliation: {
    refunds_recorded_total: number;
    payments_refunded_total: number;
    difference: number;
    matches: boolean;
  };
  payouts_reconciliation: {
    completed_payouts_total: number;
    ledger_payout_debits: number;
    difference: number;
    matches: boolean;
  };
  ledger_totals: {
    total_credits: number;
    total_debits: number;
    net: number;
  };
  timestamp: string;
};

type PayoutItem = {
  id: number;
  payout_ref: string;
  seller_id: number;
  store_name?: string;
  store_slug?: string;
  seller_email?: string;
  amount: number;
  status: "pending" | "processing" | "completed" | "rejected" | "failed";
  bank_name: string;
  bank_account_number: string;
  bank_ifsc: string;
  bank_account_holder: string;
  utr_reference?: string | null;
  admin_notes?: string | null;
  requested_at: string;
  processed_at?: string | null;
};

type RefundItem = {
  id: number;
  refund_ref: string;
  order_id: number;
  payment_id?: number;
  razorpay_refund_id?: string | null;
  amount: number;
  reason: string;
  status: string;
  fee_reversed: number;
  seller_debited: number;
  customer_name?: string;
  customer_email?: string;
  store_name?: string;
  created_at: string;
};

type LedgerItem = {
  id: number;
  transaction_ref: string;
  seller_id?: number | null;
  store_name?: string | null;
  order_id?: number | null;
  payout_id?: number | null;
  refund_id?: number | null;
  transaction_type: string;
  entry_type: "DEBIT" | "CREDIT";
  amount: number;
  status: string;
  related_ref?: string | null;
  description: string;
  created_at: string;
};

type AuditLogItem = {
  id: number;
  action: string;
  actor_type: string;
  actor_id: string;
  details: string;
  created_at: string;
};

const API_URL = "/api/orders";

const STATUSES: OrderStatus[] = [
  "Pending",
  "Processing",
  "Shipped",
  "Delivered",
  "Cancelled",
];

const COLORS: Record<OrderStatus, string> = {
  Pending: "#d97706",
  Processing: "#2563eb",
  Shipped: "#7c3aed",
  Delivered: "#16a34a",
  Cancelled: "#dc2626",
};

const PAYMENT_COLORS: Record<string, string> = {
  Paid: "#059669",      // emerald
  Pending: "#d97706",   // amber
  Failed: "#dc2626",    // red
  Cancelled: "#64748b", // slate
};

function getPaymentStatusColor(status?: string | null): string {
  if (!status) return "#64748b";
  return PAYMENT_COLORS[status] || (
    status.toLowerCase() === "paid"
      ? "#059669"
      : status.toLowerCase() === "failed"
      ? "#dc2626"
      : status.toLowerCase() === "pending"
      ? "#d97706"
      : "#64748b"
  );
}

const money = (value: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(value);

export default function AdminDashboard() {
  const [activeTab, setActiveTab] = useState<"orders" | "financials" | "settings">("orders");
  const [orders, setOrders] = useState<Order[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(() => Boolean(sessionStorage.getItem("velora_admin_token")));
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState<number | null>(null);
  const [adminToken, setAdminToken] = useState(
    () => sessionStorage.getItem("velora_admin_token") ?? ""
  );
  const [adminPassword, setAdminPassword] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);

  // Admin Password Management State
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changePasswordLoading, setChangePasswordLoading] = useState(false);
  const [changePasswordError, setChangePasswordError] = useState("");
  const [changePasswordSuccess, setChangePasswordSuccess] = useState("");

  // Forgot Password (Login Screen) State
  const [forgotPasswordView, setForgotPasswordView] = useState(false);
  const [forgotStep, setForgotStep] = useState<"request" | "reset">("request");
  const [recoveryEmail, setRecoveryEmail] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotError, setForgotError] = useState("");
  const [forgotSuccess, setForgotSuccess] = useState("");
  const [resetSessionId, setResetSessionId] = useState("");
  const [resetOtp, setResetOtp] = useState("");
  const [resetNewPassword, setResetNewPassword] = useState("");
  const [resetConfirmPassword, setResetConfirmPassword] = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const [resetError, setResetError] = useState("");
  const [resetSuccess, setResetSuccess] = useState("");
  const [smtpConfigured, setSmtpConfigured] = useState<boolean | null>(null);

  // Financial Management State
  const [overview, setOverview] = useState<AdminFinancialOverview | null>(null);
  const [reconciliation, setReconciliation] = useState<FinancialReconciliation | null>(null);
  const [payouts, setPayouts] = useState<PayoutItem[]>([]);
  const [refunds, setRefunds] = useState<RefundItem[]>([]);
  const [ledger, setLedger] = useState<LedgerItem[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);
  const [financialsLoading, setFinancialsLoading] = useState(false);

  // Payout actions state
  const [approvingPayoutId, setApprovingPayoutId] = useState<number | null>(null);
  const [utrInput, setUtrInput] = useState("");
  const [rejectingPayoutId, setRejectingPayoutId] = useState<number | null>(null);
  const [rejectReasonInput, setRejectReasonInput] = useState("");

  // Refund processing state
  const [refundOrderId, setRefundOrderId] = useState("");
  const [refundAmount, setRefundAmount] = useState("");
  const [refundReason, setRefundReason] = useState("");
  const [refundProcessing, setRefundProcessing] = useState(false);

  // Ledger filter state
  const [ledgerTypeFilter, setLedgerTypeFilter] = useState("");
  const [ledgerSearch, setLedgerSearch] = useState("");

  const loadOrders = useCallback(async () => {
    try {
      const response = await fetch(API_URL, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Failed to load orders.");
      }

      setOrders(data.orders ?? []);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Backend connection failed."
      );
    } finally {
      setLoading(false);
    }
  }, [adminToken]);

  const loadFinancialData = useCallback(async () => {
    if (!adminToken) return;
    setFinancialsLoading(true);
    setError("");
    try {
      const headers = { Authorization: `Bearer ${adminToken}` };

      // 1. Overview & Reconciliation
      const ovRes = await fetch("/api/admin/financials/overview", { headers });
      if (ovRes.ok) {
        const ovData = await ovRes.json();
        setOverview(ovData.overview);
        setReconciliation(ovData.reconciliation);
      }

      // 2. Payouts
      const poRes = await fetch("/api/admin/financials/payouts", { headers });
      if (poRes.ok) {
        const poData = await poRes.json();
        setPayouts(poData.payouts ?? []);
      }

      // 3. Refunds
      const rfRes = await fetch("/api/admin/financials/refunds", { headers });
      if (rfRes.ok) {
        const rfData = await rfRes.json();
        setRefunds(rfData.refunds ?? []);
      }

      // 4. Ledger
      const lgRes = await fetch("/api/admin/financials/ledger", { headers });
      if (lgRes.ok) {
        const lgData = await lgRes.json();
        setLedger(lgData.ledger ?? []);
      }

      // 5. Audit logs
      const auRes = await fetch("/api/admin/financials/audit-logs", { headers });
      if (auRes.ok) {
        const auData = await auRes.json();
        setAuditLogs(auData.logs ?? []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load financial data.");
    } finally {
      setFinancialsLoading(false);
    }
  }, [adminToken]);

  useEffect(() => {
    if (!adminToken) return;
    void loadOrders();
    void loadFinancialData();
  }, [adminToken, loadOrders, loadFinancialData]);

  useEffect(() => {
    if (!adminToken && forgotPasswordView) {
      fetch("/api/admin/forgot-password/status")
        .then((res) => res.json())
        .then((data) => {
          if (data && typeof data.configured === "boolean") {
            setSmtpConfigured(data.configured);
          }
        })
        .catch(() => {
          setSmtpConfigured(null);
        });
    }
  }, [adminToken, forgotPasswordView]);

  async function handleAdminLogin() {
    setLoginLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: adminPassword }),
      });
      const data = await response.json();
      if (!response.ok || !data.token) {
        throw new Error(data.message || "Admin login failed.");
      }
      sessionStorage.setItem("velora_admin_token", data.token);
      setLoading(true);
      setAdminToken(data.token);
      setAdminPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed.");
    } finally {
      setLoginLoading(false);
    }
  }

  function handleAdminLogout() {
    sessionStorage.removeItem("velora_admin_token");
    setAdminToken("");
    setLoading(false);
    setAdminPassword("");
    setError("");
    setNotice("");
    setOrders([]);
    setOverview(null);
    setPayouts([]);
    setRefunds([]);
    setLedger([]);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setChangePasswordError("");
    setChangePasswordSuccess("");
    setForgotPasswordView(false);
    setForgotStep("request");
    setResetSessionId("");
    setResetOtp("");
    setResetNewPassword("");
    setResetConfirmPassword("");
    setResetError("");
    setResetSuccess("");
    setForgotError("");
    setForgotSuccess("");
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setChangePasswordError("");
    setChangePasswordSuccess("");

    if (!currentPassword) {
      setChangePasswordError("Current password is required.");
      return;
    }
    if (newPassword.length < 12) {
      setChangePasswordError("New password must be at least 12 characters long.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setChangePasswordError("New password and confirmation do not match.");
      return;
    }
    if (newPassword === currentPassword) {
      setChangePasswordError("New password cannot be the same as the current password.");
      return;
    }

    setChangePasswordLoading(true);
    try {
      const res = await fetch("/api/admin/change-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Failed to update admin password.");
      }

      setChangePasswordSuccess(
        "Password changed successfully! You will be signed out in 2 seconds to authenticate with your new credentials."
      );
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");

      setTimeout(() => {
        handleAdminLogout();
        setNotice("Admin password updated successfully. Please log in with your new password.");
      }, 2000);
    } catch (err) {
      setChangePasswordError(err instanceof Error ? err.message : "Failed to change password.");
    } finally {
      setChangePasswordLoading(false);
    }
  }

  async function handleForgotPasswordRequest(e: React.FormEvent) {
    e.preventDefault();
    setForgotError("");
    setForgotSuccess("");
    setResetError("");
    setResetSuccess("");

    if (!recoveryEmail.trim()) {
      setForgotError("Please enter your admin recovery email.");
      return;
    }

    setForgotLoading(true);
    try {
      const res = await fetch("/api/admin/forgot-password/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: recoveryEmail.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.code === "SMTP_NOT_CONFIGURED") {
          setSmtpConfigured(false);
          throw new Error("Admin password recovery is unavailable because SMTP delivery or ADMIN_RECOVERY_EMAIL is not configured on the server. Please run: node server/reset-admin-password.js");
        }
        throw new Error(data.message || "Password reset request failed.");
      }

      setResetSessionId(data.resetSessionId || "");
      setForgotStep("reset");
      setForgotSuccess(data.message || "If a matching recovery email is registered, a single-use verification code has been dispatched.");
    } catch (err) {
      setForgotError(err instanceof Error ? err.message : "Password reset request failed.");
    } finally {
      setForgotLoading(false);
    }
  }

  async function handleResetPasswordWithOtp(e: React.FormEvent) {
    e.preventDefault();
    setResetError("");
    setResetSuccess("");

    if (!resetOtp.trim()) {
      setResetError("Please enter the 6-digit verification code.");
      return;
    }
    if (resetNewPassword.length < 12) {
      setResetError("New password must be at least 12 characters long.");
      return;
    }
    if (resetNewPassword !== resetConfirmPassword) {
      setResetError("New password and confirmation do not match.");
      return;
    }

    setResetLoading(true);
    try {
      const res = await fetch("/api/admin/forgot-password/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resetSessionId,
          otp: resetOtp.trim(),
          newPassword: resetNewPassword,
          confirmPassword: resetConfirmPassword,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Password reset failed.");
      }

      setResetSuccess(
        "Admin password successfully reset! Redirecting to login..."
      );
      setTimeout(() => {
        setForgotPasswordView(false);
        setForgotStep("request");
        setResetSessionId("");
        setResetOtp("");
        setResetNewPassword("");
        setResetConfirmPassword("");
        setResetSuccess("");
        setForgotSuccess("");
        setNotice("Admin password reset successfully. Please log in with your new password.");
      }, 2000);
    } catch (err) {
      setResetError(err instanceof Error ? err.message : "Password reset failed.");
    } finally {
      setResetLoading(false);
    }
  }

  async function changeStatus(id: number, status: OrderStatus) {
    setSaving(id);
    setError("");
    setNotice("");

    try {
      const response = await fetch(`${API_URL}/${id}/status`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ status }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Status update failed.");
      }

      setOrders((current) =>
        current.map((order) =>
          order.id === id ? { ...order, ...data.order } : order
        )
      );

      setNotice(`Order #${id} updated to ${status}.`);
      void loadFinancialData();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Status update failed."
      );
      await loadOrders();
    } finally {
      setSaving(null);
    }
  }

  // Payout Approval
  async function submitApprovePayout(payoutId: number) {
    if (!utrInput.trim()) {
      setError("Please provide a valid Bank Transaction UTR reference.");
      return;
    }
    setError("");
    try {
      const res = await fetch(`/api/admin/financials/payouts/${payoutId}/approve`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ utr_reference: utrInput.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to approve payout.");
      setNotice(`Payout #${payoutId} approved and completed with UTR: ${utrInput.trim()}`);
      setApprovingPayoutId(null);
      setUtrInput("");
      void loadFinancialData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Approval failed.");
    }
  }

  // Payout Rejection
  async function submitRejectPayout(payoutId: number) {
    if (!rejectReasonInput.trim()) {
      setError("Please provide a reason for rejecting the payout.");
      return;
    }
    setError("");
    try {
      const res = await fetch(`/api/admin/financials/payouts/${payoutId}/reject`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ reason: rejectReasonInput.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to reject payout.");
      setNotice(`Payout #${payoutId} rejected. Reserved balance returned to seller.`);
      setRejectingPayoutId(null);
      setRejectReasonInput("");
      void loadFinancialData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rejection failed.");
    }
  }

  // Process Refund
  async function submitProcessRefund(e: React.FormEvent) {
    e.preventDefault();
    if (!refundOrderId) return;
    setRefundProcessing(true);
    setError("");
    try {
      const res = await fetch("/api/admin/financials/refunds", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          order_id: Number(refundOrderId),
          amount: refundAmount ? Number(refundAmount) : undefined,
          reason: refundReason.trim() || "Admin initiated refund",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Refund processing failed.");
      setNotice(data.message || "Refund processed successfully.");
      setRefundOrderId("");
      setRefundAmount("");
      setRefundReason("");
      void loadOrders();
      void loadFinancialData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to process refund.");
    } finally {
      setRefundProcessing(false);
    }
  }

  const filteredOrders = orders.filter((order) => {
    const query = search.toLowerCase();
    return (
      String(order.id).includes(query) ||
      order.customer_name.toLowerCase().includes(query) ||
      order.email.toLowerCase().includes(query) ||
      order.status.toLowerCase().includes(query) ||
      (order.payment_status && order.payment_status.toLowerCase().includes(query)) ||
      (order.store_name && order.store_name.toLowerCase().includes(query))
    );
  });

  const filteredLedger = ledger.filter((l) => {
    if (ledgerTypeFilter && l.transaction_type !== ledgerTypeFilter) return false;
    if (ledgerSearch) {
      const q = ledgerSearch.toLowerCase();
      return (
        l.transaction_ref.toLowerCase().includes(q) ||
        String(l.order_id || "").includes(q) ||
        (l.store_name && l.store_name.toLowerCase().includes(q)) ||
        l.description.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const totalValue = orders.reduce((sum, order) => sum + order.total, 0);
  const deliveredOrders = orders.filter((o) => o.status === "Delivered");
  const deliveredVolume = deliveredOrders.reduce((sum, order) => sum + (Number(order.total) || 0), 0);
  const platformRevenue = deliveredOrders.reduce((sum, order) => {
    const fee = typeof order.platform_fee === "number" && !isNaN(order.platform_fee)
      ? order.platform_fee
      : Math.round((Number(order.total) || 0) * 0.03 * 100) / 100;
    return sum + fee;
  }, 0);

  const statCards = [
    { label: "Total Orders", value: String(orders.length) },
    { label: "Total Order Value", value: money(totalValue) },
    { label: "Delivered Volume", value: money(deliveredVolume) },
    { label: "Platform Revenue (3%)", value: money(platformRevenue) },
    {
      label: "Pending Orders",
      value: String(orders.filter((o) => o.status === "Pending").length),
    },
    {
      label: "Delivered Orders",
      value: String(deliveredOrders.length),
    },
  ];

  if (!adminToken) {
    return (
      <main className="admin-page">
        <section className="admin-panel" style={{ maxWidth: "420px", margin: "60px auto" }}>
          <div className="admin-brand">V E L O R A</div>
          {!forgotPasswordView ? (
            <>
              <h1>Admin Login</h1>
              <p className="muted">Enter your secure admin password to manage financial infrastructure.</p>
              <form onSubmit={(event) => {
                event.preventDefault();
                void handleAdminLogin();
              }}>
                <PasswordInput
                  variant="admin"
                  className="admin-search"
                  style={{ width: "100%", marginBottom: "14px" }}
                  placeholder="Admin password"
                  value={adminPassword}
                  onChange={(event) => setAdminPassword(event.target.value)}
                  required
                />
                <button className="admin-button gold" style={{ width: "100%" }} type="submit" disabled={loginLoading}>
                  {loginLoading ? "Signing in..." : "Sign In to Admin Console"}
                </button>
              </form>
              <div style={{ marginTop: "12px", textAlign: "right" }}>
                <button
                  type="button"
                  onClick={() => {
                    setForgotPasswordView(true);
                    setError("");
                    setForgotError("");
                    setForgotSuccess("");
                  }}
                  style={{ background: "transparent", border: 0, color: "#d4af65", fontSize: "12px", cursor: "pointer", textDecoration: "underline" }}
                >
                  Forgot Password?
                </button>
              </div>
              {error && <p className="admin-error" style={{ color: "#ef4444", marginTop: "12px" }}>{error}</p>}
              {notice && <p className="admin-success" style={{ color: "#10b981", marginTop: "12px" }}>{notice}</p>}
              <div style={{ marginTop: "16px", textAlign: "center" }}>
                <a className="admin-button secondary" href="/">Back to Store</a>
              </div>
            </>
          ) : (
            <>
              <h1>Admin Password Recovery</h1>
              {smtpConfigured === false && (
                <div style={{ padding: "12px", background: "rgba(245, 158, 11, 0.1)", border: "1px solid #f59e0b", borderRadius: "8px", color: "#f59e0b", fontSize: "12px", marginBottom: "16px", lineHeight: "1.5" }}>
                  <strong>SMTP Recovery Not Configured:</strong> Real email delivery or ADMIN_RECOVERY_EMAIL is unconfigured on the server.
                  <div style={{ marginTop: "6px" }}>
                    To reset directly from server terminal, run:
                  </div>
                  <code style={{ display: "inline-block", background: "#090a0d", padding: "4px 8px", borderRadius: "4px", color: "#d4af65", marginTop: "4px" }}>
                    node server/reset-admin-password.js
                  </code>
                </div>
              )}

              {forgotStep === "request" ? (
                <>
                  <p className="muted">Enter your verified admin recovery email to receive a single-use verification code.</p>
                  <form onSubmit={handleForgotPasswordRequest}>
                    <input
                      type="email"
                      className="admin-search"
                      style={{ width: "100%", marginBottom: "14px" }}
                      placeholder="admin-recovery@example.com"
                      value={recoveryEmail}
                      onChange={(event) => setRecoveryEmail(event.target.value)}
                      required
                    />
                    <button className="admin-button gold" style={{ width: "100%" }} type="submit" disabled={forgotLoading}>
                      {forgotLoading ? "Requesting OTP..." : "Send Verification Code"}
                    </button>
                  </form>
                  {forgotError && <p className="admin-error" style={{ color: "#ef4444", marginTop: "12px", fontSize: "13px" }}>{forgotError}</p>}
                  {forgotSuccess && <p className="admin-success" style={{ color: "#10b981", marginTop: "12px", fontSize: "13px" }}>{forgotSuccess}</p>}
                </>
              ) : (
                <>
                  <p className="muted">Enter the 6-digit verification code sent to your recovery email, and enter your new password.</p>
                  <form onSubmit={handleResetPasswordWithOtp}>
                    <div style={{ marginBottom: "12px" }}>
                      <label style={{ display: "block", fontSize: "11px", color: "#9a9ba5", marginBottom: "4px", textTransform: "uppercase", letterSpacing: "1px" }}>
                        6-Digit Verification Code
                      </label>
                      <input
                        type="text"
                        className="admin-search"
                        style={{ width: "100%", letterSpacing: "4px", fontWeight: "bold", textAlign: "center" }}
                        placeholder="123456"
                        maxLength={6}
                        value={resetOtp}
                        onChange={(event) => setResetOtp(event.target.value)}
                        required
                      />
                    </div>
                    <div style={{ marginBottom: "12px" }}>
                      <label style={{ display: "block", fontSize: "11px", color: "#9a9ba5", marginBottom: "4px", textTransform: "uppercase", letterSpacing: "1px" }}>
                        New Password (Min 12 Characters)
                      </label>
                      <PasswordInput
                        variant="admin"
                        className="admin-search"
                        style={{ width: "100%" }}
                        placeholder="Enter new strong password"
                        value={resetNewPassword}
                        onChange={(event) => setResetNewPassword(event.target.value)}
                        required
                      />
                      <div style={{ marginTop: "4px", fontSize: "11px", color: resetNewPassword.length >= 12 ? "#10b981" : "#9a9ba5" }}>
                        {resetNewPassword.length >= 12 ? "✓ Meets minimum length" : `Length: ${resetNewPassword.length}/12 minimum`}
                      </div>
                    </div>
                    <div style={{ marginBottom: "16px" }}>
                      <label style={{ display: "block", fontSize: "11px", color: "#9a9ba5", marginBottom: "4px", textTransform: "uppercase", letterSpacing: "1px" }}>
                        Confirm New Password
                      </label>
                      <PasswordInput
                        variant="admin"
                        className="admin-search"
                        style={{ width: "100%" }}
                        placeholder="Re-enter new password"
                        value={resetConfirmPassword}
                        onChange={(event) => setResetConfirmPassword(event.target.value)}
                        required
                      />
                      {resetConfirmPassword && (
                        <div style={{ marginTop: "4px", fontSize: "11px", color: resetNewPassword === resetConfirmPassword ? "#10b981" : "#ef4444" }}>
                          {resetNewPassword === resetConfirmPassword ? "✓ Passwords match" : "✗ Passwords do not match"}
                        </div>
                      )}
                    </div>
                    <button
                      className="admin-button gold"
                      style={{ width: "100%" }}
                      type="submit"
                      disabled={resetLoading || !resetOtp || resetNewPassword.length < 12 || resetNewPassword !== resetConfirmPassword}
                    >
                      {resetLoading ? "Resetting Password..." : "Reset Admin Password"}
                    </button>
                  </form>
                  {resetError && <p className="admin-error" style={{ color: "#ef4444", marginTop: "12px", fontSize: "13px" }}>{resetError}</p>}
                  {resetSuccess && <p className="admin-success" style={{ color: "#10b981", marginTop: "12px", fontSize: "13px" }}>{resetSuccess}</p>}
                </>
              )}

              <div style={{ marginTop: "16px", textAlign: "center", display: "flex", gap: "10px", justifyContent: "center" }}>
                {forgotStep === "reset" ? (
                  <button
                    type="button"
                    className="admin-button secondary"
                    onClick={() => {
                      setForgotStep("request");
                      setResetError("");
                      setResetSuccess("");
                    }}
                  >
                    ← Back to Email
                  </button>
                ) : (
                  <button
                    type="button"
                    className="admin-button secondary"
                    onClick={() => {
                      setForgotPasswordView(false);
                      setForgotStep("request");
                      setForgotError("");
                      setForgotSuccess("");
                    }}
                  >
                    ← Back to Login
                  </button>
                )}
                <a className="admin-button secondary" href="/">Back to Store</a>
              </div>
            </>
          )}
        </section>
      </main>
    );
  }

  return (
    <main className="admin-page">
      <header className="admin-header">
        <div>
          <div className="admin-brand">V E L O R A</div>
          <h1>Financial & Operational Administration</h1>
          <p className="muted">Multi-vendor marketplace financial infrastructure & order fulfillment</p>
        </div>

        <div className="header-actions">
          <button
            className="admin-button secondary"
            onClick={handleAdminLogout}
          >
            Logout
          </button>
          <a className="admin-button secondary" href="/">
            ← Storefront
          </a>
          <button
            className="admin-button gold"
            onClick={() => {
              void loadOrders();
              void loadFinancialData();
            }}
            disabled={loading || financialsLoading}
          >
            {loading || financialsLoading ? "Refreshing..." : "↻ Refresh All"}
          </button>
        </div>
      </header>

      {/* TOP TAB NAVIGATION */}
      <div style={{ display: "flex", gap: "10px", marginBottom: "24px" }}>
        <button
          className={`admin-button ${activeTab === "orders" ? "gold" : "secondary"}`}
          onClick={() => setActiveTab("orders")}
          style={{ fontSize: "14px", padding: "10px 20px" }}
        >
          📦 Orders Fulfillment ({orders.length})
        </button>
        <button
          className={`admin-button ${activeTab === "financials" ? "gold" : "secondary"}`}
          onClick={() => {
            setActiveTab("financials");
            void loadFinancialData();
          }}
          style={{ fontSize: "14px", padding: "10px 20px" }}
        >
          💰 Financial Infrastructure & Ledger
        </button>
        <button
          className={`admin-button ${activeTab === "settings" ? "gold" : "secondary"}`}
          onClick={() => setActiveTab("settings")}
          style={{ fontSize: "14px", padding: "10px 20px" }}
        >
          ⚙ Settings & Security
        </button>
      </div>

      {error && <p className="admin-error" style={{ color: "#ef4444", marginBottom: "16px", padding: "12px", background: "rgba(239,68,68,0.1)", borderRadius: "8px" }}>{error}</p>}
      {notice && <p className="admin-success" style={{ color: "#10b981", marginBottom: "16px", padding: "12px", background: "rgba(16,185,129,0.1)", borderRadius: "8px" }}>{notice}</p>}

      {/* ========================================================================= */}
      {/* TAB 1: ORDERS FULFILLMENT                                                */}
      {/* ========================================================================= */}
      {activeTab === "orders" && (
        <>
          <section className="admin-stats">
            {statCards.map((card) => (
              <article className="admin-stat" key={card.label}>
                <p className="muted">{card.label}</p>
                <strong>{card.value}</strong>
              </article>
            ))}
          </section>

          <section className="admin-panel">
            <div className="orders-toolbar">
              <div>
                <h2>All Orders</h2>
                <p className="muted">{filteredOrders.length} order(s) found</p>
              </div>

              <input
                className="admin-search"
                placeholder="Search order ID, customer, email, store, payment..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>

            {loading && <p className="muted">Loading orders...</p>}

            {!loading && filteredOrders.length === 0 && (
              <p className="muted">No matching orders found.</p>
            )}

            {!loading &&
              filteredOrders.map((order) => (
                <article className="order-card" key={order.id}>
                  <div className="order-heading">
                    <div>
                      <span className="order-id">ORDER #{order.id}</span>
                      {order.payment_status && (
                        <span
                          className={`payment-status-badge ${(order.payment_status || "").toLowerCase()}`}
                          style={{
                            background: getPaymentStatusColor(order.payment_status),
                          }}
                        >
                          {order.payment_status}
                        </span>
                      )}
                      {order.store_name ? (
                        <span style={{ marginLeft: "8px", fontSize: "11px", color: "#d4af37", background: "rgba(212,175,55,0.1)", padding: "2px 8px", borderRadius: "10px" }}>
                          Store: {order.store_name}
                        </span>
                      ) : (
                        <span style={{ marginLeft: "8px", fontSize: "11px", color: "#888", background: "rgba(255,255,255,0.06)", padding: "2px 8px", borderRadius: "10px" }}>
                          VELORA Marketplace
                        </span>
                      )}
                      <h3>{order.customer_name}</h3>
                      <p className="muted">{order.email}</p>
                    </div>

                    <div className="order-price">
                      <strong>{money(order.total)}</strong>
                      {order.status === "Delivered" && (
                        <span style={{ display: "block", fontSize: "11px", color: "#10b981", marginTop: "2px" }}>
                          Fee (3%): {money(typeof order.platform_fee === "number" ? order.platform_fee : Math.round(order.total * 0.03 * 100) / 100)}
                        </span>
                      )}
                      <p className="muted">
                        {new Date(
                          order.created_at.replace(" ", "T") + (order.created_at.includes("Z") ? "" : "Z")
                        ).toLocaleString("en-IN")}
                      </p>
                    </div>
                  </div>

                  <div className="order-items">
                    {order.items.map((item, index) => (
                      <div key={`${item.id ?? item.name}-${index}`}>
                        <span>
                          {item.name} × {item.quantity}
                        </span>
                        <span>{money(item.price * item.quantity)}</span>
                      </div>
                    ))}
                  </div>

                  <div className="order-controls">
                    <span
                      className="status-badge"
                      style={{
                        background: COLORS[order.status] ?? "#64748b",
                        padding: "4px 10px",
                        borderRadius: "12px",
                        fontSize: "12px",
                        fontWeight: "600"
                      }}
                    >
                      {order.status}
                    </span>
                    {order.payment_status && (
                      <span
                        className={`status-badge payment-status-badge ${(order.payment_status || "").toLowerCase()}`}
                        style={{
                          background: getPaymentStatusColor(order.payment_status),
                          padding: "4px 10px",
                          borderRadius: "12px",
                          fontSize: "12px",
                          fontWeight: "600"
                        }}
                      >
                        Payment: {order.payment_status}
                      </span>
                    )}
                    {order.refund_status && order.refund_status !== "none" && (
                      <span
                        className="status-badge"
                        style={{
                          background: "#9333ea",
                          padding: "4px 10px",
                          borderRadius: "12px",
                          fontSize: "12px",
                          fontWeight: "600"
                        }}
                      >
                        Refund: {order.refund_status.toUpperCase()} ({money(order.refunded_amount || 0)})
                      </span>
                    )}

                    <label className="status-control">
                      <span>Change status</span>
                      <select
                        value={order.status}
                        disabled={saving === order.id}
                        onChange={(event) =>
                          void changeStatus(
                            order.id,
                            event.target.value as OrderStatus
                          )
                        }
                      >
                        {STATUSES.map((status) => (
                          <option value={status} key={status}>
                            {status}
                          </option>
                        ))}
                      </select>
                    </label>

                    {saving === order.id && (
                      <span className="muted">Saving...</span>
                    )}

                    {order.payment_status === "Paid" && (
                      <button
                        className="admin-button secondary"
                        style={{ fontSize: "11px", padding: "6px 12px" }}
                        onClick={() => {
                          setActiveTab("financials");
                          setRefundOrderId(String(order.id));
                          setRefundAmount(String(order.total - (order.refunded_amount || 0)));
                        }}
                      >
                        Process Refund
                      </button>
                    )}
                  </div>
                </article>
              ))}
          </section>
        </>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: FINANCIAL INFRASTRUCTURE & LEDGER                                 */}
      {/* ========================================================================= */}
      {activeTab === "financials" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          {/* 1. ADMIN OVERVIEW CARDS */}
          <section className="admin-stats">
            <article className="admin-stat">
              <p className="muted">Total Marketplace GMV</p>
              <strong>{money(overview?.total_gmv ?? 0)}</strong>
            </article>

            <article className="admin-stat">
              <p className="muted">Successful Payments</p>
              <strong style={{ color: "#10b981" }}>
                {money(overview?.successful_payments_amount ?? 0)}
              </strong>
              <span className="muted" style={{ display: "block", marginTop: "4px", fontSize: "11px" }}>
                {overview?.successful_payments_count ?? 0} transactions
              </span>
            </article>

            <article className="admin-stat">
              <p className="muted">VELORA Platform Fees (3%)</p>
              <strong style={{ color: "#d4af65" }}>
                {money(overview?.total_platform_fees ?? 0)}
              </strong>
              <span className="muted" style={{ display: "block", marginTop: "4px", fontSize: "11px" }}>
                Preserved 3% fee rate
              </span>
            </article>

            <article className="admin-stat">
              <p className="muted">Net Delivered Seller Earnings</p>
              <strong>{money(overview?.total_seller_earnings ?? 0)}</strong>
            </article>

            <article className="admin-stat">
              <p className="muted">Available Seller Balances</p>
              <strong style={{ color: "#10b981" }}>{money(overview?.available_seller_balances ?? 0)}</strong>
            </article>

            <article className="admin-stat">
              <p className="muted">Pending Seller Balances</p>
              <strong style={{ color: "#f59e0b" }}>{money(overview?.pending_seller_balances ?? 0)}</strong>
              <span className="muted" style={{ display: "block", marginTop: "4px", fontSize: "11px" }}>
                Orders in fulfillment
              </span>
            </article>

            <article className="admin-stat">
              <p className="muted">Total Processed Refunds</p>
              <strong style={{ color: "#ef4444" }}>{money(overview?.total_refunds_amount ?? 0)}</strong>
              <span className="muted" style={{ display: "block", marginTop: "4px", fontSize: "11px" }}>
                {overview?.total_refunds_count ?? 0} refunds
              </span>
            </article>

            <article className="admin-stat">
              <p className="muted">Payout Requests</p>
              <strong>
                {overview?.payouts?.pending?.count ?? 0} Pending
              </strong>
              <span className="muted" style={{ display: "block", marginTop: "4px", fontSize: "11px" }}>
                {money(overview?.payouts?.pending?.amount ?? 0)} pending review
              </span>
            </article>
          </section>

          {/* 2. RECONCILIATION SUMMARY CARD */}
          <section className="admin-panel" style={{ border: reconciliation?.is_reconciled ? "1px solid #059669" : "1px solid #ef4444" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px", marginBottom: "16px" }}>
              <div>
                <h2 style={{ margin: 0, fontSize: "18px" }}>Financial Accounting Reconciliation</h2>
                <p className="muted" style={{ margin: "4px 0 0" }}>
                  Automated verification between Gateway Payments, Store Orders, Refunds, Wallets and Immutable Ledger.
                </p>
              </div>
              <span
                style={{
                  background: reconciliation?.is_reconciled ? "rgba(16, 185, 129, 0.2)" : "rgba(239, 68, 68, 0.2)",
                  color: reconciliation?.is_reconciled ? "#10b981" : "#ef4444",
                  padding: "6px 14px",
                  borderRadius: "20px",
                  fontWeight: "700",
                  fontSize: "12px",
                  letterSpacing: "1px"
                }}
              >
                {reconciliation?.is_reconciled ? "✓ RECONCILED (100% BALANCED)" : "⚠ RECONCILIATION DISCREPANCY"}
              </span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "16px", fontSize: "13px" }}>
              <div style={{ padding: "12px", background: "#1a1b22", borderRadius: "8px" }}>
                <div className="muted">Payments vs Orders:</div>
                <div style={{ marginTop: "4px" }}>Paid Payments: <strong>{money(reconciliation?.payments_to_orders?.paid_payments_total ?? 0)}</strong></div>
                <div>Paid Orders: <strong>{money(reconciliation?.payments_to_orders?.paid_orders_total ?? 0)}</strong></div>
                <div style={{ color: reconciliation?.payments_to_orders?.matches ? "#10b981" : "#ef4444", marginTop: "4px" }}>
                  Diff: {money(reconciliation?.payments_to_orders?.difference ?? 0)} (Match: {String(reconciliation?.payments_to_orders?.matches)})
                </div>
              </div>

              <div style={{ padding: "12px", background: "#1a1b22", borderRadius: "8px" }}>
                <div className="muted">Refunds Reconciliation:</div>
                <div style={{ marginTop: "4px" }}>Refunds Table: <strong>{money(reconciliation?.refunds_reconciliation?.refunds_recorded_total ?? 0)}</strong></div>
                <div>Payments Refunded: <strong>{money(reconciliation?.refunds_reconciliation?.payments_refunded_total ?? 0)}</strong></div>
                <div style={{ color: reconciliation?.refunds_reconciliation?.matches ? "#10b981" : "#ef4444", marginTop: "4px" }}>
                  Diff: {money(reconciliation?.refunds_reconciliation?.difference ?? 0)} (Match: {String(reconciliation?.refunds_reconciliation?.matches)})
                </div>
              </div>

              <div style={{ padding: "12px", background: "#1a1b22", borderRadius: "8px" }}>
                <div className="muted">Payouts vs Ledger:</div>
                <div style={{ marginTop: "4px" }}>Completed Payouts: <strong>{money(reconciliation?.payouts_reconciliation?.completed_payouts_total ?? 0)}</strong></div>
                <div>Ledger Debits: <strong>{money(reconciliation?.payouts_reconciliation?.ledger_payout_debits ?? 0)}</strong></div>
                <div style={{ color: reconciliation?.payouts_reconciliation?.matches ? "#10b981" : "#ef4444", marginTop: "4px" }}>
                  Diff: {money(reconciliation?.payouts_reconciliation?.difference ?? 0)} (Match: {String(reconciliation?.payouts_reconciliation?.matches)})
                </div>
              </div>

              <div style={{ padding: "12px", background: "#1a1b22", borderRadius: "8px" }}>
                <div className="muted">Ledger Totals:</div>
                <div style={{ marginTop: "4px" }}>Total Credits: <strong>{money(reconciliation?.ledger_totals?.total_credits ?? 0)}</strong></div>
                <div>Total Debits: <strong>{money(reconciliation?.ledger_totals?.total_debits ?? 0)}</strong></div>
                <div style={{ marginTop: "4px", color: "#d4af65" }}>Net: {money(reconciliation?.ledger_totals?.net ?? 0)}</div>
              </div>
            </div>
          </section>

          {/* 3. SELLER PAYOUT REQUESTS APPROVAL SECTION */}
          <section className="admin-panel">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", flexWrap: "wrap", gap: "10px" }}>
              <div>
                <h2 style={{ margin: 0, fontSize: "18px" }}>Seller Payout Requests</h2>
                <p className="muted" style={{ margin: "4px 0 0" }}>Review, approve with UTR reference, or reject withdrawal requests.</p>
              </div>
              <span className="muted">{payouts.length} payout request(s)</span>
            </div>

            {payouts.length === 0 ? (
              <p className="muted">No payout requests found.</p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid #292a31", textAlign: "left" }}>
                      <th style={{ padding: "10px 8px" }}>Ref</th>
                      <th style={{ padding: "10px 8px" }}>Store / Seller</th>
                      <th style={{ padding: "10px 8px" }}>Amount</th>
                      <th style={{ padding: "10px 8px" }}>Bank Details</th>
                      <th style={{ padding: "10px 8px" }}>UTR / Reference</th>
                      <th style={{ padding: "10px 8px" }}>Status</th>
                      <th style={{ padding: "10px 8px", textAlign: "right" }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payouts.map((p) => {
                      const isPending = p.status === "pending" || p.status === "processing";
                      return (
                        <tr key={p.id} style={{ borderBottom: "1px solid #1a1b22" }}>
                          <td style={{ padding: "12px 8px", fontFamily: "monospace" }}>{p.payout_ref}</td>
                          <td style={{ padding: "12px 8px" }}>
                            <strong>{p.store_name}</strong>
                            <div className="muted" style={{ fontSize: "11px" }}>{p.seller_email}</div>
                          </td>
                          <td style={{ padding: "12px 8px" }}>
                            <strong>{money(p.amount)}</strong>
                          </td>
                          <td style={{ padding: "12px 8px" }}>
                            <div>{p.bank_name} - {p.bank_account_holder}</div>
                            <div className="muted" style={{ fontSize: "11px" }}>
                              Acc: {p.bank_account_number} | IFSC: {p.bank_ifsc}
                            </div>
                          </td>
                          <td style={{ padding: "12px 8px" }}>
                            {p.utr_reference ? (
                              <span style={{ fontFamily: "monospace", color: "#10b981" }}>{p.utr_reference}</span>
                            ) : (
                              <span className="muted">None</span>
                            )}
                          </td>
                          <td style={{ padding: "12px 8px" }}>
                            <span
                              style={{
                                padding: "3px 8px",
                                borderRadius: "10px",
                                fontSize: "11px",
                                fontWeight: "600",
                                background:
                                  p.status === "completed"
                                    ? "rgba(16, 185, 129, 0.2)"
                                    : p.status === "rejected"
                                    ? "rgba(239, 68, 68, 0.2)"
                                    : "rgba(245, 158, 11, 0.2)",
                                color:
                                  p.status === "completed"
                                    ? "#10b981"
                                    : p.status === "rejected"
                                    ? "#ef4444"
                                    : "#f59e0b"
                              }}
                            >
                              {p.status.toUpperCase()}
                            </span>
                          </td>
                          <td style={{ padding: "12px 8px", textAlign: "right" }}>
                            {isPending && (
                              <div style={{ display: "inline-flex", gap: "6px" }}>
                                <button
                                  className="admin-button gold"
                                  style={{ padding: "4px 10px", fontSize: "11px" }}
                                  onClick={() => {
                                    setApprovingPayoutId(p.id);
                                    setUtrInput("");
                                  }}
                                >
                                  Approve & Pay
                                </button>
                                <button
                                  className="admin-button secondary"
                                  style={{ padding: "4px 10px", fontSize: "11px", color: "#ef4444" }}
                                  onClick={() => {
                                    setRejectingPayoutId(p.id);
                                    setRejectReasonInput("");
                                  }}
                                >
                                  Reject
                                </button>
                              </div>
                            )}
                            {!isPending && <span className="muted">Processed</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Modal/Prompt for Approving Payout with UTR */}
            {approvingPayoutId !== null && (
              <div style={{ marginTop: "16px", padding: "16px", background: "#1c1d24", borderRadius: "8px", border: "1px solid #d4af65" }}>
                <h4 style={{ margin: "0 0 8px 0" }}>Confirm Bank Payout Transfer (Payout #{approvingPayoutId})</h4>
                <p className="muted" style={{ margin: "0 0 12px 0" }}>
                  Enter the genuine Bank UTR / NEFT / IMPS reference number to record the settlement in the immutable ledger.
                </p>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <input
                    type="text"
                    className="admin-search"
                    style={{ flex: 1 }}
                    placeholder="Enter Bank UTR / Reference (e.g. UTR1234567890)"
                    value={utrInput}
                    onChange={(e) => setUtrInput(e.target.value)}
                  />
                  <button
                    className="admin-button gold"
                    onClick={() => void submitApprovePayout(approvingPayoutId)}
                  >
                    Confirm Settlement
                  </button>
                  <button
                    className="admin-button secondary"
                    onClick={() => setApprovingPayoutId(null)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Modal/Prompt for Rejecting Payout */}
            {rejectingPayoutId !== null && (
              <div style={{ marginTop: "16px", padding: "16px", background: "#1c1d24", borderRadius: "8px", border: "1px solid #ef4444" }}>
                <h4 style={{ margin: "0 0 8px 0", color: "#ef4444" }}>Reject Payout Request (Payout #{rejectingPayoutId})</h4>
                <p className="muted" style={{ margin: "0 0 12px 0" }}>
                  Provide a clear rejection reason. The reserved payout amount will be automatically credited back to the seller.
                </p>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <input
                    type="text"
                    className="admin-search"
                    style={{ flex: 1 }}
                    placeholder="Enter rejection reason (e.g. Invalid bank account details)"
                    value={rejectReasonInput}
                    onChange={(e) => setRejectReasonInput(e.target.value)}
                  />
                  <button
                    className="admin-button secondary"
                    style={{ background: "#ef4444", color: "#fff", borderColor: "#ef4444" }}
                    onClick={() => void submitRejectPayout(rejectingPayoutId)}
                  >
                    Reject & Return Balance
                  </button>
                  <button
                    className="admin-button secondary"
                    onClick={() => setRejectingPayoutId(null)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </section>

          {/* 4. REFUND SYSTEM & PROCESSED REFUNDS */}
          <section className="admin-panel">
            <h2 style={{ margin: "0 0 4px 0", fontSize: "18px" }}>Refund Management & Processing</h2>
            <p className="muted" style={{ margin: "0 0 16px 0" }}>
              Execute full or partial refunds for paid orders. Automatically reverses 3% VELORA fee and debits seller.
            </p>

            <form onSubmit={submitProcessRefund} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px", alignItems: "flex-end", marginBottom: "20px" }}>
              <div>
                <label className="muted" style={{ display: "block", marginBottom: "4px" }}>Order ID *</label>
                <input
                  type="number"
                  required
                  placeholder="e.g. 25"
                  className="admin-search"
                  style={{ width: "100%" }}
                  value={refundOrderId}
                  onChange={(e) => setRefundOrderId(e.target.value)}
                />
              </div>

              <div>
                <label className="muted" style={{ display: "block", marginBottom: "4px" }}>Refund Amount (₹) (blank for full)</label>
                <input
                  type="number"
                  step="0.01"
                  placeholder="e.g. 500"
                  className="admin-search"
                  style={{ width: "100%" }}
                  value={refundAmount}
                  onChange={(e) => setRefundAmount(e.target.value)}
                />
              </div>

              <div>
                <label className="muted" style={{ display: "block", marginBottom: "4px" }}>Reason *</label>
                <input
                  type="text"
                  required
                  placeholder="Customer request, defective item..."
                  className="admin-search"
                  style={{ width: "100%" }}
                  value={refundReason}
                  onChange={(e) => setRefundReason(e.target.value)}
                />
              </div>

              <div>
                <button
                  type="submit"
                  disabled={refundProcessing || !refundOrderId}
                  className="admin-button gold"
                  style={{ width: "100%" }}
                >
                  {refundProcessing ? "Processing..." : "Execute Refund"}
                </button>
              </div>
            </form>

            <h3 style={{ fontSize: "15px", marginBottom: "10px" }}>Processed Refunds History ({refunds.length})</h3>
            {refunds.length === 0 ? (
              <p className="muted">No refunds processed yet.</p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid #292a31", textAlign: "left" }}>
                      <th style={{ padding: "8px" }}>Refund Ref</th>
                      <th style={{ padding: "8px" }}>Order</th>
                      <th style={{ padding: "8px" }}>Customer</th>
                      <th style={{ padding: "8px" }}>Store</th>
                      <th style={{ padding: "8px" }}>Amount</th>
                      <th style={{ padding: "8px" }}>3% Fee Reversed</th>
                      <th style={{ padding: "8px" }}>Seller Debited</th>
                      <th style={{ padding: "8px" }}>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {refunds.map((r) => (
                      <tr key={r.id} style={{ borderBottom: "1px solid #1a1b22" }}>
                        <td style={{ padding: "10px 8px", fontFamily: "monospace" }}>{r.refund_ref}</td>
                        <td style={{ padding: "10px 8px" }}><strong>#{r.order_id}</strong></td>
                        <td style={{ padding: "10px 8px" }}>{r.customer_name}</td>
                        <td style={{ padding: "10px 8px" }}>{r.store_name || "Marketplace"}</td>
                        <td style={{ padding: "10px 8px", color: "#ef4444", fontWeight: "700" }}>{money(r.amount)}</td>
                        <td style={{ padding: "10px 8px", color: "#d4af65" }}>{money(r.fee_reversed)}</td>
                        <td style={{ padding: "10px 8px" }}>{money(r.seller_debited)}</td>
                        <td style={{ padding: "10px 8px" }} className="muted">
                          {new Date(r.created_at.replace(" ", "T") + (r.created_at.includes("Z") ? "" : "Z")).toLocaleDateString("en-IN")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* 5. IMMUTABLE FINANCIAL LEDGER EXPLORER */}
          <section className="admin-panel">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", flexWrap: "wrap", gap: "10px" }}>
              <div>
                <h2 style={{ margin: 0, fontSize: "18px" }}>Immutable Double-Entry Financial Ledger</h2>
                <p className="muted" style={{ margin: "4px 0 0" }}>
                  Engine-level immutable audit records protected by database triggers. Deletions and updates are strictly forbidden.
                </p>
              </div>

              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <select
                  value={ledgerTypeFilter}
                  onChange={(e) => setLedgerTypeFilter(e.target.value)}
                  className="admin-search"
                  style={{ width: "auto" }}
                >
                  <option value="">All Transaction Types</option>
                  <option value="SELLER_EARNING">SELLER_EARNING</option>
                  <option value="PLATFORM_FEE">PLATFORM_FEE</option>
                  <option value="PAYOUT_DEBIT">PAYOUT_DEBIT</option>
                  <option value="PAYOUT_REVERSAL">PAYOUT_REVERSAL</option>
                  <option value="REFUND_DEBIT">REFUND_DEBIT</option>
                  <option value="REFUND_FEE_REVERSAL">REFUND_FEE_REVERSAL</option>
                </select>

                <input
                  type="text"
                  placeholder="Filter by ref, order, store..."
                  value={ledgerSearch}
                  onChange={(e) => setLedgerSearch(e.target.value)}
                  className="admin-search"
                />
              </div>
            </div>

            {filteredLedger.length === 0 ? (
              <p className="muted">No ledger records found matching query.</p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid #292a31", textAlign: "left" }}>
                      <th style={{ padding: "8px" }}>Ledger Ref</th>
                      <th style={{ padding: "8px" }}>Order</th>
                      <th style={{ padding: "8px" }}>Store</th>
                      <th style={{ padding: "8px" }}>Type</th>
                      <th style={{ padding: "8px" }}>Entry</th>
                      <th style={{ padding: "8px" }}>Amount</th>
                      <th style={{ padding: "8px" }}>Description</th>
                      <th style={{ padding: "8px" }}>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredLedger.map((l) => {
                      const isCredit = l.entry_type === "CREDIT";
                      return (
                        <tr key={l.id} style={{ borderBottom: "1px solid #1a1b22" }}>
                          <td style={{ padding: "10px 8px", fontFamily: "monospace", fontSize: "12px" }}>{l.transaction_ref}</td>
                          <td style={{ padding: "10px 8px" }}>{l.order_id ? `#${l.order_id}` : "-"}</td>
                          <td style={{ padding: "10px 8px" }}>{l.store_name || "VELORA"}</td>
                          <td style={{ padding: "10px 8px" }}>
                            <span style={{ padding: "2px 6px", borderRadius: "4px", background: "#1f2029", fontSize: "11px", fontWeight: "600" }}>
                              {l.transaction_type}
                            </span>
                          </td>
                          <td style={{ padding: "10px 8px", fontWeight: "700", color: isCredit ? "#10b981" : "#ef4444" }}>
                            {l.entry_type}
                          </td>
                          <td style={{ padding: "10px 8px", fontWeight: "700", color: isCredit ? "#10b981" : "#ef4444" }}>
                            {isCredit ? "+" : "-"}{money(l.amount)}
                          </td>
                          <td style={{ padding: "10px 8px", color: "#9ca3af", fontSize: "12px" }}>{l.description}</td>
                          <td style={{ padding: "10px 8px", fontSize: "11px" }} className="muted">
                            {new Date(l.created_at.replace(" ", "T") + (l.created_at.includes("Z") ? "" : "Z")).toLocaleString("en-IN")}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* 6. FINANCIAL AUDIT LOGS */}
          <section className="admin-panel">
            <h2 style={{ margin: "0 0 4px 0", fontSize: "18px" }}>Financial Security Audit Logs</h2>
            <p className="muted" style={{ margin: "0 0 16px 0" }}>
              Chronological log of administrative actions, payouts, refunds, and webhook events.
            </p>

            {auditLogs.length === 0 ? (
              <p className="muted">No audit logs recorded yet.</p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid #292a31", textAlign: "left" }}>
                      <th style={{ padding: "8px" }}>Action</th>
                      <th style={{ padding: "8px" }}>Actor Type</th>
                      <th style={{ padding: "8px" }}>Actor ID</th>
                      <th style={{ padding: "8px" }}>Details</th>
                      <th style={{ padding: "8px" }}>Timestamp</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditLogs.map((log) => (
                      <tr key={log.id} style={{ borderBottom: "1px solid #1a1b22" }}>
                        <td style={{ padding: "10px 8px", fontWeight: "700", color: "#d4af65" }}>{log.action}</td>
                        <td style={{ padding: "10px 8px", textTransform: "capitalize" }}>{log.actor_type}</td>
                        <td style={{ padding: "10px 8px", fontFamily: "monospace" }}>{log.actor_id}</td>
                        <td style={{ padding: "10px 8px", color: "#d1d5db" }}>{log.details}</td>
                        <td style={{ padding: "10px 8px", fontSize: "11px" }} className="muted">
                          {new Date(log.created_at.replace(" ", "T") + (log.created_at.includes("Z") ? "" : "Z")).toLocaleString("en-IN")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: SETTINGS & SECURITY                                               */}
      {/* ========================================================================= */}
      {activeTab === "settings" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          <section className="admin-panel" style={{ maxWidth: "640px" }}>
            <h2 style={{ fontSize: "20px", margin: "0 0 6px", color: "#f5f5f5" }}>
              Change Admin Password
            </h2>
            <p className="muted" style={{ margin: "0 0 20px" }}>
              Update the master administrative credentials. Changing the password automatically invalidates all active admin sessions and persists the new bcrypt hash.
            </p>

            <form onSubmit={handleChangePassword}>
              <div style={{ marginBottom: "16px" }}>
                <label style={{ display: "block", fontSize: "12px", color: "#9a9ba5", marginBottom: "6px", textTransform: "uppercase", letterSpacing: "1px" }}>
                  Current Password
                </label>
                <PasswordInput
                  variant="admin"
                  className="admin-search"
                  style={{ width: "100%" }}
                  placeholder="Enter current admin password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  required
                />
              </div>

              <div style={{ marginBottom: "16px" }}>
                <label style={{ display: "block", fontSize: "12px", color: "#9a9ba5", marginBottom: "6px", textTransform: "uppercase", letterSpacing: "1px" }}>
                  New Password (Minimum 12 characters)
                </label>
                <PasswordInput
                  variant="admin"
                  className="admin-search"
                  style={{ width: "100%" }}
                  placeholder="Enter new strong password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                />
                <div style={{ marginTop: "6px", fontSize: "12px", color: newPassword.length >= 12 ? "#10b981" : "#9a9ba5" }}>
                  {newPassword.length >= 12 ? "✓ Meets minimum length (12+ characters)" : `Length: ${newPassword.length}/12 characters minimum`}
                </div>
              </div>

              <div style={{ marginBottom: "20px" }}>
                <label style={{ display: "block", fontSize: "12px", color: "#9a9ba5", marginBottom: "6px", textTransform: "uppercase", letterSpacing: "1px" }}>
                  Confirm New Password
                </label>
                <PasswordInput
                  variant="admin"
                  className="admin-search"
                  style={{ width: "100%" }}
                  placeholder="Re-enter new password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                />
                {confirmPassword && (
                  <div style={{ marginTop: "6px", fontSize: "12px", color: newPassword === confirmPassword ? "#10b981" : "#ef4444" }}>
                    {newPassword === confirmPassword ? "✓ Passwords match" : "✗ Passwords do not match"}
                  </div>
                )}
              </div>

              {changePasswordError && (
                <div style={{ padding: "12px 14px", backgroundColor: "rgba(239, 68, 68, 0.1)", border: "1px solid #ef4444", borderRadius: "8px", color: "#ef4444", fontSize: "13px", marginBottom: "16px" }}>
                  {changePasswordError}
                </div>
              )}

              {changePasswordSuccess && (
                <div style={{ padding: "12px 14px", backgroundColor: "rgba(16, 185, 129, 0.1)", border: "1px solid #10b981", borderRadius: "8px", color: "#10b981", fontSize: "13px", marginBottom: "16px" }}>
                  {changePasswordSuccess}
                </div>
              )}

              <button
                type="submit"
                className="admin-button gold"
                disabled={changePasswordLoading || !currentPassword || newPassword.length < 12 || newPassword !== confirmPassword}
              >
                {changePasswordLoading ? "Updating Password..." : "Update Admin Password"}
              </button>
            </form>
          </section>

          <section className="admin-panel" style={{ maxWidth: "640px" }}>
            <h3 style={{ fontSize: "16px", margin: "0 0 12px", color: "#d4af65" }}>
              Authentication & Session Security Architecture
            </h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", fontSize: "13px" }}>
              <div style={{ background: "#090a0d", padding: "14px", borderRadius: "8px", border: "1px solid #292a31" }}>
                <span className="muted" style={{ display: "block", marginBottom: "4px" }}>Password Storage</span>
                <strong>Bcrypt (Cost 12) Salted Hash</strong>
              </div>
              <div style={{ background: "#090a0d", padding: "14px", borderRadius: "8px", border: "1px solid #292a31" }}>
                <span className="muted" style={{ display: "block", marginBottom: "4px" }}>Session Invalidation</span>
                <strong>Active Token Versioning</strong>
              </div>
              <div style={{ background: "#090a0d", padding: "14px", borderRadius: "8px", border: "1px solid #292a31" }}>
                <span className="muted" style={{ display: "block", marginBottom: "4px" }}>Persistence</span>
                <strong>Environment Configuration (.env)</strong>
              </div>
              <div style={{ background: "#090a0d", padding: "14px", borderRadius: "8px", border: "1px solid #292a31" }}>
                <span className="muted" style={{ display: "block", marginBottom: "4px" }}>Seller Session Isolation</span>
                <strong>Preserved & Independent</strong>
              </div>
            </div>
          </section>
        </div>
      )}

      <footer className="admin-footer" style={{ marginTop: "40px", borderTop: "1px solid #292a31", paddingTop: "20px" }}>
        VELORA · Complete Financial Infrastructure & Multi-Vendor Settlement System
      </footer>
    </main>
  );
}
