/**
 * VELORA Phase 5 — Razorpay Payment Gateway Integration Service
 */

declare global {
  interface Window {
    Razorpay?: any;
  }
}

export type PaymentCustomer = {
  name: string;
  email: string;
  contact?: string;
};

export type CreatePaymentOrderResponse = {
  status: "success" | "error";
  orderId: number;
  razorpay_order_id: string;
  amount: number; // in paise
  currency: string;
  key_id: string;
  is_simulation?: boolean;
  customer?: PaymentCustomer;
  message?: string;
  code?: string;
};

export type VerifyPaymentResponse = {
  status: "success" | "error";
  message: string;
  orderId: number;
  paymentId: string;
  already_verified?: boolean;
  order?: any;
};

/**
 * Ensures Razorpay Checkout script is dynamically loaded if not already present.
 */
export async function loadRazorpayScript(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (window.Razorpay) return true;

  return new Promise((resolve) => {
    const existing = document.querySelector('script[src="https://checkout.razorpay.com/v1/checkout.js"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(true));
      existing.addEventListener("error", () => resolve(false));
      return;
    }

    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => {
      console.warn("Failed to load Razorpay checkout script from CDN (possible adblocker/offline).");
      resolve(false);
    };
    document.body.appendChild(script);
  });
}

/**
 * Initiates Razorpay payment popup, securely verifying the signature on completion.
 */
export async function launchRazorpayPayment({
  paymentOrder,
  storeName = "VELORA",
  themeColor = "#D4AF37",
  onSuccess,
  onFailure,
  onDismiss,
  onShowSandboxSimulation
}: {
  paymentOrder: CreatePaymentOrderResponse;
  storeName?: string;
  themeColor?: string;
  onSuccess: (result: VerifyPaymentResponse) => void;
  onFailure: (error: { message: string; code?: string }) => void;
  onDismiss?: () => void;
  onShowSandboxSimulation?: (simDetails: {
    orderId: number;
    razorpay_order_id: string;
    amount: number;
    confirmSuccess: () => Promise<void>;
    simulateFailure: () => Promise<void>;
    simulateCancel: () => Promise<void>;
  }) => void;
}) {
  const isSim =
    Boolean(paymentOrder.is_simulation) ||
    !paymentOrder.key_id ||
    paymentOrder.key_id.includes("sandbox") ||
    paymentOrder.key_id.includes("placeholder");

  // If in sandbox test mode and onShowSandboxSimulation is provided, trigger test sheet
  if (isSim && onShowSandboxSimulation) {
    onShowSandboxSimulation({
      orderId: paymentOrder.orderId,
      razorpay_order_id: paymentOrder.razorpay_order_id,
      amount: paymentOrder.amount,
      confirmSuccess: async () => {
        try {
          const simPaymentId = `pay_sim_${Date.now()}`;
          // Fetch valid HMAC signature from backend sandbox generator
          const sigRes = await fetch("/api/payments/sandbox-signature", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              razorpay_order_id: paymentOrder.razorpay_order_id,
              razorpay_payment_id: simPaymentId
            })
          });
          const sigData = await sigRes.json();
          if (!sigRes.ok || !sigData.signature) {
            throw new Error(sigData.message || "Failed to generate sandbox test signature.");
          }

          // Call backend verification
          const verifyRes = await fetch("/api/payments/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              velora_order_id: paymentOrder.orderId,
              razorpay_order_id: paymentOrder.razorpay_order_id,
              razorpay_payment_id: simPaymentId,
              razorpay_signature: sigData.signature
            })
          });
          const verifyData = await verifyRes.json();
          if (!verifyRes.ok || verifyData.status !== "success") {
            throw new Error(verifyData.message || "Payment verification failed.");
          }
          onSuccess(verifyData);
        } catch (err) {
          onFailure({
            message: err instanceof Error ? err.message : "Sandbox payment simulation failed.",
            code: "SIMULATION_FAILED"
          });
        }
      },
      simulateFailure: async () => {
        try {
          await fetch("/api/payments/fail", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              velora_order_id: paymentOrder.orderId,
              razorpay_order_id: paymentOrder.razorpay_order_id,
              error_code: "SANDBOX_SIMULATED_FAILURE",
              error_description: "Transaction simulated as failed by user in sandbox test."
            })
          });
          onFailure({
            message: "Payment declined by issuing bank (Simulated Test).",
            code: "PAYMENT_FAILED"
          });
        } catch (err) {
          onFailure({
            message: err instanceof Error ? err.message : "Failed to record payment failure.",
            code: "FAIL_RECORD_ERROR"
          });
        }
      },
      simulateCancel: async () => {
        try {
          await fetch("/api/payments/cancel", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              velora_order_id: paymentOrder.orderId,
              razorpay_order_id: paymentOrder.razorpay_order_id,
              reason: "Payment cancelled by user in sandbox sheet"
            })
          });
        } catch {}
        if (onDismiss) onDismiss();
      }
    });
    return;
  }

  // Load genuine Razorpay Checkout
  await loadRazorpayScript();

  if (!window.Razorpay) {
    onFailure({
      message: "Razorpay Checkout script could not be loaded. Please disable ad-blockers and retry.",
      code: "SCRIPT_LOAD_ERROR"
    });
    return;
  }

  try {
    const options = {
      key: paymentOrder.key_id,
      amount: paymentOrder.amount,
      currency: paymentOrder.currency || "INR",
      name: storeName,
      description: `Order #${paymentOrder.orderId} Payment`,
      image: "/favicon.svg",
      order_id: paymentOrder.razorpay_order_id,
      handler: async function (response: any) {
        try {
          // Send payment response to backend for cryptographic signature verification
          const verifyRes = await fetch("/api/payments/verify", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json"
            },
            body: JSON.stringify({
              velora_order_id: paymentOrder.orderId,
              razorpay_order_id: response.razorpay_order_id || paymentOrder.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature
            })
          });

          const verifyData = await verifyRes.json().catch(() => ({}));

          if (!verifyRes.ok || verifyData.status !== "success") {
            throw new Error(
              verifyData.message ||
                `Signature verification failed (HTTP ${verifyRes.status}). Untrusted transaction.`
            );
          }

          onSuccess(verifyData);
        } catch (verifyErr) {
          console.error("Verification error:", verifyErr);
          onFailure({
            message:
              verifyErr instanceof Error
                ? verifyErr.message
                : "Payment verification failed on server.",
            code: "VERIFICATION_ERROR"
          });
        }
      },
      prefill: {
        name: paymentOrder.customer?.name || "",
        email: paymentOrder.customer?.email || "",
        contact: paymentOrder.customer?.contact || ""
      },
      theme: {
        color: themeColor || "#D4AF37"
      },
      modal: {
        ondismiss: async function () {
          try {
            await fetch("/api/payments/cancel", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                velora_order_id: paymentOrder.orderId,
                razorpay_order_id: paymentOrder.razorpay_order_id,
                reason: "Customer closed Razorpay checkout window"
              })
            });
          } catch (cancelErr) {
            console.error("Cancel notify error:", cancelErr);
          }

          if (onDismiss) onDismiss();
        }
      }
    };

    const rzpInstance = new window.Razorpay(options);

    rzpInstance.on("payment.failed", async function (response: any) {
      console.warn("Razorpay payment failed:", response.error);

      try {
        await fetch("/api/payments/fail", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            velora_order_id: paymentOrder.orderId,
            razorpay_order_id: paymentOrder.razorpay_order_id,
            error_code: response.error?.code || "PAYMENT_FAILED",
            error_description:
              response.error?.description || response.error?.reason || "Payment failed at gateway"
          })
        });
      } catch (err) {
        console.error("Fail notify error:", err);
      }

      onFailure({
        message:
          response.error?.description ||
          "Payment failed or declined by bank. Please try another payment method.",
        code: response.error?.code || "GATEWAY_PAYMENT_FAILED"
      });
    });

    rzpInstance.open();
  } catch (error) {
    console.error("Razorpay open error:", error);
    onFailure({
      message:
        error instanceof Error
          ? error.message
          : "Failed to open Razorpay payment gateway interface.",
      code: "POPUP_ERROR"
    });
  }
}
