import { GoogleLogin } from "@react-oauth/google";
import { useState, useEffect, useRef, type FormEvent, type KeyboardEvent, type ClipboardEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  type CustomerUser,
  type CustomerOrder,
  type ProviderStatus,
  setCustomerSession,
  clearCustomerSession,
  fetchCurrentCustomer
} from "./services/customerAuth";

type AuthMode = "email" | "mobile" | "google";
type AuthStep = "input" | "verify" | "success" | "profile";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (customer: CustomerUser) => void;
  theme?: "light" | "dark";
  initialCustomer?: CustomerUser | null;
};

const API_BASE = "/api/customer/auth";

export default function CustomerAuthModal({
  isOpen,
  onClose,
  onSuccess,
  theme = "dark",
  initialCustomer = null
}: Props) {
  // Authentication Step & Mode
  const [mode, setMode] = useState<AuthMode>("email");
  const [step, setStep] = useState<AuthStep>(initialCustomer ? "profile" : "input");

  // Form inputs
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [otpDigits, setOtpDigits] = useState<string[]>(["", "", "", "", "", ""]);

  // Session & Verification details
  const [sessionId, setSessionId] = useState("");
  const [maskedTarget, setMaskedTarget] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const [attemptsRemaining, setAttemptsRemaining] = useState<number | null>(null);

  // Profile data when logged in
  const [currentCustomer, setCurrentCustomer] = useState<CustomerUser | null>(initialCustomer);
  const [customerOrders, setCustomerOrders] = useState<CustomerOrder[]>([]);

  // UI state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [successNotice, setSuccessNotice] = useState("");
  const [providers, setProviders] = useState<ProviderStatus | null>(null);

  const otpInputsRef = useRef<(HTMLInputElement | null)[]>([]);
  const firstInputRef = useRef<HTMLInputElement>(null);

  // Sync with initialCustomer or fetch customer details
  useEffect(() => {
    if (initialCustomer) {
      setCurrentCustomer(initialCustomer);
      setStep("profile");
      void loadOrders();
    } else {
      setStep("input");
    }
  }, [initialCustomer, isOpen]);

  // Fetch provider configuration status when modal opens
  useEffect(() => {
    if (isOpen) {
      fetch(`${API_BASE}/providers`)
        .then((res) => res.json())
        .then((data) => {
          if (data?.providers) {
            setProviders(data.providers);
          }
        })
        .catch(() => {});
    }
  }, [isOpen]);

  // Handle resend countdown timer
  useEffect(() => {
    if (cooldown <= 0) return;
    const interval = window.setInterval(() => {
      setCooldown((c) => (c <= 1 ? 0 : c - 1));
    }, 1000);
    return () => window.clearInterval(interval);
  }, [cooldown]);

  // Focus first input on open
  useEffect(() => {
    if (isOpen && step === "input") {
      setTimeout(() => firstInputRef.current?.focus(), 120);
    }
    if (isOpen && step === "verify") {
      setTimeout(() => otpInputsRef.current[0]?.focus(), 120);
    }
  }, [isOpen, step, mode]);

  async function loadOrders() {
    const profile = await fetchCurrentCustomer();
    if (profile) {
      setCurrentCustomer(profile.customer);
      setCustomerOrders(profile.orders);
    }
  }

  const handleModalClose = () => {
    if (loading) return;
    setError("");
    setSuccessNotice("");
    onClose();
  };

  // Switch tabs
  const handleTabSwitch = (newMode: AuthMode) => {
    setMode(newMode);
    setError("");
    setSuccessNotice("");
    setOtpDigits(["", "", "", "", "", ""]);
  };

  // 1. Submit Request for OTP (Email or Mobile)
  async function handleRequestOtp(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSuccessNotice("");

    if (mode === "email") {
      const cleanEmail = email.trim().toLowerCase();
      if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        setError("Please enter a valid email address.");
        return;
      }
    } else if (mode === "mobile") {
      const cleanPhone = phone.trim().replace(/[\s\-()]/g, "");
      if (!cleanPhone || !/^\+?[0-9]{10,15}$/.test(cleanPhone)) {
        setError("Please enter a valid mobile number with country code (e.g. +91 98765 43210).");
        return;
      }
    }

    setLoading(true);

    try {
      const endpoint = mode === "email" ? `${API_BASE}/email/request-otp` : `${API_BASE}/mobile/request-otp`;
      const payload = mode === "email"
        ? { email: email.trim(), name: name.trim() || undefined }
        : { phone: phone.trim(), name: name.trim() || undefined };

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        if (data.code === "SMS_NOT_CONFIGURED") {
          throw new Error("SMS delivery service is not configured. Required environment variables: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER in server/.env.");
        }
        if (data.code === "SMTP_NOT_CONFIGURED") {
          throw new Error("Email delivery service is not configured. Please check SMTP settings in server/.env.");
        }
        throw new Error(data.message || "Failed to dispatch verification code.");
      }

      setSessionId(data.sessionId);
      setMaskedTarget(data.targetMasked || (mode === "email" ? email : phone));
      setCooldown(data.resendCooldown || 60);
      setAttemptsRemaining(null);
      setOtpDigits(["", "", "", "", "", ""]);
      setSuccessNotice(data.message || `Verification code sent to your ${mode === "email" ? "email" : "mobile phone"}.`);
      setStep("verify");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  // 2. Verify OTP (Email or Mobile)
  async function handleVerifyOtp(e?: FormEvent) {
    if (e) e.preventDefault();
    setError("");
    setSuccessNotice("");

    const otpCode = otpDigits.join("");
    if (otpCode.length !== 6) {
      setError("Please enter all 6 digits of your verification code.");
      return;
    }

    setLoading(true);

    try {
      const endpoint = mode === "email" ? `${API_BASE}/email/verify-otp` : `${API_BASE}/mobile/verify-otp`;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          otp: otpCode,
          name: name.trim() || undefined
        })
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        if (typeof data.attemptsRemaining === "number") {
          setAttemptsRemaining(data.attemptsRemaining);
        }
        throw new Error(data.message || "Verification failed.");
      }

      if (data.token && data.customer) {
        setCustomerSession(data.token, data.customer);
        setCurrentCustomer(data.customer);
        onSuccess?.(data.customer);
      }

      setSuccessNotice("Authentication successful. Welcome to VELORA.");
      setStep("success");
      setTimeout(() => {
        handleModalClose();
      }, 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed.");
    } finally {
      setLoading(false);
    }
  }

  // 3. Resend OTP
  async function handleResendOtp() {
    if (cooldown > 0 || loading || !sessionId) return;
    setError("");
    setSuccessNotice("");
    setLoading(true);

    try {
      const endpoint = mode === "email" ? `${API_BASE}/email/resend-otp` : `${API_BASE}/mobile/resend-otp`;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId })
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.message || "Failed to resend code.");
      }

      setCooldown(data.resendCooldown || 60);
      setAttemptsRemaining(null);
      setOtpDigits(["", "", "", "", "", ""]);
      setSuccessNotice(data.message || "A new 6-digit code has been dispatched.");
      setTimeout(() => otpInputsRef.current[0]?.focus(), 100);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not resend code.");
    } finally {
      setLoading(false);
    }
  }

  // 4. Google OAuth Handler
  async function handleGoogleSuccess(credentialResponse: { credential?: string }) {
    const idToken = credentialResponse.credential;
    if (!idToken) {
      setError("Google sign-in did not return an identity token.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const response = await fetch(`${API_BASE}/google`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken })
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.status !== "success") {
        throw new Error(data.message || "Google sign-in failed.");
      }

      setCustomerSession(data.token, data.customer);
      setCurrentCustomer(data.customer);
      onSuccess?.(data.customer);
      setSuccessNotice("Welcome to VELORA!");
      setStep("success");
      setTimeout(() => {
        handleModalClose();
      }, 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google sign-in failed.");
    } finally {
      setLoading(false);
    }
  }

  // 5. Handle Customer Sign Out
  function handleSignOut() {
    clearCustomerSession();
    setCurrentCustomer(null);
    setCustomerOrders([]);
    setStep("input");
    handleModalClose();
  }

  // OTP Input Box Navigation & Keyboard Handler
  const handleDigitChange = (index: number, value: string) => {
    const clean = value.replace(/\D/g, "");
    if (!clean) {
      const newDigits = [...otpDigits];
      newDigits[index] = "";
      setOtpDigits(newDigits);
      return;
    }

    const lastChar = clean[clean.length - 1];
    const newDigits = [...otpDigits];
    newDigits[index] = lastChar;
    setOtpDigits(newDigits);

    // Auto-advance to next box
    if (index < 5) {
      otpInputsRef.current[index + 1]?.focus();
    } else {
      // All digits filled: automatically trigger verify if all 6 exist
      if (newDigits.every((d) => d !== "")) {
        setTimeout(() => {
          void handleVerifyOtp();
        }, 80);
      }
    }
  };

  const handleDigitKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !otpDigits[index] && index > 0) {
      otpInputsRef.current[index - 1]?.focus();
    }
  };

  const handlePasteOtp = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const paste = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (!paste) return;

    const newDigits = [...otpDigits];
    for (let i = 0; i < paste.length; i++) {
      newDigits[i] = paste[i];
    }
    setOtpDigits(newDigits);

    const targetFocus = Math.min(paste.length, 5);
    otpInputsRef.current[targetFocus]?.focus();

    if (paste.length === 6) {
      setTimeout(() => {
        void handleVerifyOtp();
      }, 80);
    }
  };

  if (!isOpen) return null;

  const isDark = theme === "dark";

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[260] flex items-center justify-center p-4 sm:p-6 overflow-y-auto">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={handleModalClose}
          className="fixed inset-0 bg-black/75 backdrop-blur-md"
        />

        {/* Modal Card */}
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 16 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          className={`relative w-full max-w-lg rounded-2xl border shadow-2xl p-6 sm:p-8 z-10 my-auto ${
            isDark
              ? "bg-[#121214] border-white/10 text-[#F5F4F0]"
              : "bg-[#FFFFFF] border-black/10 text-[#121212]"
          }`}
        >
          {/* Close Button */}
          <button
            type="button"
            onClick={handleModalClose}
            className={`absolute top-5 right-5 p-2 rounded-full transition-colors ${
              isDark ? "hover:bg-white/10 text-white/60 hover:text-white" : "hover:bg-black/5 text-black/60 hover:text-black"
            }`}
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          {/* Header Brand */}
          <div className="text-center mb-6">
            <span className="text-xl sm:text-2xl font-light tracking-[0.35em] text-[#D4AF37]">
              VELORA
            </span>
            <p className={`text-[10px] tracking-[0.25em] uppercase mt-1 ${isDark ? "text-white/50" : "text-black/50"}`}>
              {step === "profile" ? "Customer Account" : "Customer Authentication"}
            </p>
          </div>

          {/* Feedback Alerts */}
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-5 p-3.5 rounded-xl border border-red-500/30 bg-red-500/10 text-red-400 text-xs flex items-start gap-2.5"
            >
              <svg className="w-4 h-4 shrink-0 mt-0.5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <div className="flex-1 text-left leading-relaxed">{error}</div>
            </motion.div>
          )}

          {successNotice && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-5 p-3.5 rounded-xl border border-[#D4AF37]/30 bg-[#D4AF37]/10 text-[#D4AF37] text-xs flex items-start gap-2.5"
            >
              <svg className="w-4 h-4 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
              </svg>
              <div className="flex-1 text-left leading-relaxed">{successNotice}</div>
            </motion.div>
          )}

          {/* VIEW: LOGGED-IN CUSTOMER PROFILE & ORDER HISTORY */}
          {step === "profile" && currentCustomer && (
            <div className="space-y-6">
              <div className={`p-4 rounded-xl border ${isDark ? "border-white/10 bg-white/5" : "border-black/10 bg-black/5"}`}>
                <div className="flex items-center gap-3.5">
                  <div className="w-12 h-12 rounded-full bg-[#D4AF37] text-black font-semibold flex items-center justify-center text-lg shadow">
                    {currentCustomer.name ? currentCustomer.name[0].toUpperCase() : "C"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-base font-medium truncate">{currentCustomer.name || "Valued Client"}</h3>
                    <div className="flex flex-wrap items-center gap-2 mt-1">
                      {currentCustomer.email && (
                        <span className={`text-xs truncate ${isDark ? "text-white/60" : "text-black/60"}`}>
                          {currentCustomer.email}
                        </span>
                      )}
                      {currentCustomer.email_verified && (
                        <span className="px-2 py-0.5 text-[9px] uppercase tracking-wider font-semibold rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          Email Verified
                        </span>
                      )}
                      {currentCustomer.phone && (
                        <span className={`text-xs truncate ${isDark ? "text-white/60" : "text-black/60"}`}>
                          {currentCustomer.phone}
                        </span>
                      )}
                      {currentCustomer.phone_verified && (
                        <span className="px-2 py-0.5 text-[9px] uppercase tracking-wider font-semibold rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          Phone Verified
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Order History */}
              <div>
                <h4 className="text-xs uppercase tracking-[0.2em] font-medium text-[#D4AF37] mb-3">
                  Your Bespoke Orders ({customerOrders.length})
                </h4>
                {customerOrders.length === 0 ? (
                  <p className={`text-xs py-4 text-center ${isDark ? "text-white/40" : "text-black/40"}`}>
                    No orders placed yet. Curated luxury items await in the boutique.
                  </p>
                ) : (
                  <div className="space-y-2.5 max-h-56 overflow-y-auto pr-1">
                    {customerOrders.map((order) => (
                      <div
                        key={order.id}
                        className={`p-3 rounded-lg border text-xs flex items-center justify-between transition ${
                          isDark ? "border-white/10 bg-white/5 hover:border-[#D4AF37]/50" : "border-black/10 bg-black/5 hover:border-[#D4AF37]/50"
                        }`}
                      >
                        <div>
                          <div className="font-medium">Order #{order.id}</div>
                          <div className={`text-[10px] ${isDark ? "text-white/50" : "text-black/50"}`}>
                            {new Date(order.created_at).toLocaleDateString()} &middot; {order.items.length} item{order.items.length > 1 ? "s" : ""}
                          </div>
                          {order.tracking_number && (
                            <div className="text-[10px] text-[#D4AF37] mt-0.5 font-mono">
                              Tracking: {order.tracking_number}
                            </div>
                          )}
                        </div>
                        <div className="text-right">
                          <div className="font-semibold text-[#D4AF37]">
                            ₹{order.total.toLocaleString("en-IN")}
                          </div>
                          <span className={`inline-block px-2 py-0.5 text-[9px] uppercase tracking-wider rounded-full font-medium ${
                            order.status === "Delivered"
                              ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                              : order.status === "Shipped"
                              ? "bg-blue-500/15 text-blue-400 border border-blue-500/30"
                              : "bg-amber-500/15 text-amber-400 border border-amber-500/30"
                          }`}>
                            {order.status}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="pt-2 flex items-center justify-between gap-3 border-t border-white/10">
                <a
                  href="/track-order"
                  className={`text-xs hover:underline flex items-center gap-1.5 ${isDark ? "text-white/70" : "text-black/70"}`}
                >
                  <svg className="w-3.5 h-3.5 text-[#D4AF37]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                  Track an Order
                </a>
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="px-4 py-2 rounded-lg text-xs tracking-wider uppercase font-medium border border-red-500/40 text-red-400 hover:bg-red-500/10 transition"
                >
                  Sign Out
                </button>
              </div>
            </div>
          )}

          {/* VIEW: AUTHENTICATION (INPUT OR VERIFY) */}
          {step !== "profile" && step !== "success" && (
            <div>
              {/* Method Switcher Tabs (Only in input step) */}
              {step === "input" && (
                <div className="flex border-b border-white/10 mb-6 text-xs font-medium">
                  <button
                    type="button"
                    onClick={() => handleTabSwitch("email")}
                    className={`flex-1 pb-3 text-center transition-all relative ${
                      mode === "email"
                        ? "text-[#D4AF37] font-semibold"
                        : isDark ? "text-white/50 hover:text-white" : "text-black/50 hover:text-black"
                    }`}
                  >
                    <span className="flex items-center justify-center gap-1.5">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                      </svg>
                      Email OTP
                    </span>
                    {mode === "email" && (
                      <motion.div
                        layoutId="activeTabUnderline"
                        className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#D4AF37]"
                      />
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => handleTabSwitch("mobile")}
                    className={`flex-1 pb-3 text-center transition-all relative ${
                      mode === "mobile"
                        ? "text-[#D4AF37] font-semibold"
                        : isDark ? "text-white/50 hover:text-white" : "text-black/50 hover:text-black"
                    }`}
                  >
                    <span className="flex items-center justify-center gap-1.5">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                      </svg>
                      Mobile OTP
                    </span>
                    {mode === "mobile" && (
                      <motion.div
                        layoutId="activeTabUnderline"
                        className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#D4AF37]"
                      />
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => handleTabSwitch("google")}
                    className={`flex-1 pb-3 text-center transition-all relative ${
                      mode === "google"
                        ? "text-[#D4AF37] font-semibold"
                        : isDark ? "text-white/50 hover:text-white" : "text-black/50 hover:text-black"
                    }`}
                  >
                    <span className="flex items-center justify-center gap-1.5">
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24">
                        <path
                          fill="#4285F4"
                          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                        />
                        <path
                          fill="#34A853"
                          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                        />
                        <path
                          fill="#FBBC05"
                          d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                        />
                        <path
                          fill="#EA4335"
                          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                        />
                      </svg>
                      Google
                    </span>
                    {mode === "google" && (
                      <motion.div
                        layoutId="activeTabUnderline"
                        className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#D4AF37]"
                      />
                    )}
                  </button>
                </div>
              )}

              {/* STEP 1: INPUT DETAILS (EMAIL OR MOBILE) */}
              {step === "input" && (
                <div>
                  {mode === "google" ? (
                    <div className="py-6 text-center space-y-4">
                      <p className={`text-xs ${isDark ? "text-white/70" : "text-black/70"}`}>
                        Sign in instantly with your verified Google account.
                      </p>
                      <div className="flex justify-center">
                        <GoogleLogin
                          onSuccess={handleGoogleSuccess}
                          onError={() => setError("Google sign-in was unsuccessful. Please try again.")}
                          shape="pill"
                          theme={isDark ? "filled_black" : "outline"}
                          size="large"
                        />
                      </div>
                    </div>
                  ) : (
                    <form onSubmit={handleRequestOtp} className="space-y-4">
                      {mode === "email" ? (
                        <div>
                          <label className={`block text-xs uppercase tracking-wider mb-1.5 font-medium ${isDark ? "text-white/70" : "text-black/70"}`}>
                            Email Address <span className="text-[#D4AF37]">*</span>
                          </label>
                          <input
                            ref={firstInputRef}
                            type="email"
                            required
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="e.g. alexander@atelier.com"
                            className={`w-full px-4 py-3 rounded-xl border text-sm transition outline-none ${
                              isDark
                                ? "bg-white/5 border-white/15 focus:border-[#D4AF37] text-white placeholder-white/30"
                                : "bg-black/5 border-black/15 focus:border-[#D4AF37] text-black placeholder-black/30"
                            }`}
                          />
                        </div>
                      ) : (
                        <div>
                          <label className={`block text-xs uppercase tracking-wider mb-1.5 font-medium ${isDark ? "text-white/70" : "text-black/70"}`}>
                            Mobile Number <span className="text-[#D4AF37]">*</span>
                          </label>
                          <input
                            ref={firstInputRef}
                            type="tel"
                            required
                            value={phone}
                            onChange={(e) => setPhone(e.target.value)}
                            placeholder="e.g. +91 98765 43210"
                            className={`w-full px-4 py-3 rounded-xl border text-sm transition outline-none ${
                              isDark
                                ? "bg-white/5 border-white/15 focus:border-[#D4AF37] text-white placeholder-white/30"
                                : "bg-black/5 border-black/15 focus:border-[#D4AF37] text-black placeholder-black/30"
                            }`}
                          />
                          {providers && !providers.sms.configured && (
                            <div className="mt-2.5 p-3 rounded-lg border border-amber-500/25 bg-amber-500/10 text-amber-300 text-[11px] leading-relaxed flex items-start gap-2">
                              <svg className="w-4 h-4 shrink-0 text-amber-400 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              <div>
                                <strong>SMS Provider Setup Required:</strong> Twilio credentials (<code>TWILIO_ACCOUNT_SID</code>, <code>TWILIO_AUTH_TOKEN</code>, <code>TWILIO_PHONE_NUMBER</code>) must be configured in <code>server/.env</code> for live SMS delivery.
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Optional Name field */}
                      <div>
                        <label className={`block text-xs uppercase tracking-wider mb-1.5 font-medium ${isDark ? "text-white/70" : "text-black/70"}`}>
                          Full Name <span className="text-[10px] opacity-60">(Optional)</span>
                        </label>
                        <input
                          type="text"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          placeholder="e.g. Alexander Vance"
                          className={`w-full px-4 py-3 rounded-xl border text-sm transition outline-none ${
                            isDark
                              ? "bg-white/5 border-white/15 focus:border-[#D4AF37] text-white placeholder-white/30"
                              : "bg-black/5 border-black/15 focus:border-[#D4AF37] text-black placeholder-black/30"
                          }`}
                        />
                      </div>

                      <button
                        type="submit"
                        disabled={loading || (mode === "mobile" && providers ? !providers.sms.configured : false)}
                        className={`w-full py-3.5 px-6 rounded-xl text-xs font-semibold uppercase tracking-[0.2em] transition-all flex items-center justify-center gap-2 shadow-lg ${
                          loading || (mode === "mobile" && providers && !providers.sms.configured)
                            ? "bg-[#D4AF37]/50 text-black/50 cursor-not-allowed"
                            : "bg-[#D4AF37] hover:bg-[#E5C158] text-black cursor-pointer active:scale-[0.99]"
                        }`}
                      >
                        {loading ? (
                          <>
                            <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                            <span>Dispatching Code...</span>
                          </>
                        ) : (
                          <span>Send Verification Code &rarr;</span>
                        )}
                      </button>
                    </form>
                  )}
                </div>
              )}

              {/* STEP 2: VERIFY 6-DIGIT OTP SCREEN */}
              {step === "verify" && (
                <div className="space-y-6">
                  {/* Destination indicator and back link */}
                  <div className="text-center space-y-1">
                    <p className={`text-xs ${isDark ? "text-white/60" : "text-black/60"}`}>
                      Enter the 6-digit security code dispatched to
                    </p>
                    <p className="text-sm font-semibold tracking-wider text-[#D4AF37]">
                      {maskedTarget}
                    </p>
                    <button
                      type="button"
                      onClick={() => setStep("input")}
                      className={`text-[11px] underline mt-1 transition ${
                        isDark ? "text-white/50 hover:text-white" : "text-black/50 hover:text-black"
                      }`}
                    >
                      &larr; Change {mode === "email" ? "email" : "phone number"}
                    </button>
                  </div>

                  {/* 6 Digit Input Boxes */}
                  <div className="flex justify-center items-center gap-2 sm:gap-3" onPaste={handlePasteOtp}>
                    {otpDigits.map((digit, idx) => (
                      <input
                        key={idx}
                        ref={(el) => { otpInputsRef.current[idx] = el; }}
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        maxLength={1}
                        value={digit}
                        onChange={(e) => handleDigitChange(idx, e.target.value)}
                        onKeyDown={(e) => handleDigitKeyDown(idx, e)}
                        className={`w-11 h-14 sm:w-13 sm:h-16 text-center text-xl sm:text-2xl font-semibold rounded-xl border outline-none transition-all ${
                          digit
                            ? "border-[#D4AF37] bg-[#D4AF37]/10 text-[#D4AF37] shadow-[0_0_15px_rgba(212,175,55,0.2)]"
                            : isDark
                            ? "border-white/15 bg-white/5 text-white focus:border-[#D4AF37]"
                            : "border-black/15 bg-black/5 text-black focus:border-[#D4AF37]"
                        }`}
                      />
                    ))}
                  </div>

                  {/* Attempts feedback */}
                  {attemptsRemaining !== null && (
                    <p className="text-xs text-center text-amber-400 font-medium">
                      {attemptsRemaining} attempt{attemptsRemaining === 1 ? "" : "s"} remaining before code expires.
                    </p>
                  )}

                  {/* Resend Cooldown Counter */}
                  <div className="text-center text-xs">
                    {cooldown > 0 ? (
                      <p className={isDark ? "text-white/40" : "text-black/40"}>
                        Resend code in{" "}
                        <span className="text-[#D4AF37] font-semibold font-mono">
                          {Math.floor(cooldown / 60)}:{(cooldown % 60).toString().padStart(2, "0")}
                        </span>
                      </p>
                    ) : (
                      <button
                        type="button"
                        onClick={handleResendOtp}
                        disabled={loading}
                        className="text-[#D4AF37] hover:underline font-medium cursor-pointer"
                      >
                        Didn't receive the code? Resend OTP
                      </button>
                    )}
                  </div>

                  {/* Submit Button */}
                  <button
                    type="button"
                    onClick={() => handleVerifyOtp()}
                    disabled={loading || otpDigits.some((d) => d === "")}
                    className={`w-full py-3.5 px-6 rounded-xl text-xs font-semibold uppercase tracking-[0.2em] transition-all flex items-center justify-center gap-2 shadow-lg ${
                      loading || otpDigits.some((d) => d === "")
                        ? "bg-[#D4AF37]/50 text-black/50 cursor-not-allowed"
                        : "bg-[#D4AF37] hover:bg-[#E5C158] text-black cursor-pointer active:scale-[0.99]"
                    }`}
                  >
                    {loading ? (
                      <>
                        <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                        <span>Verifying Security Code...</span>
                      </>
                    ) : (
                      <span>Verify &amp; Continue &rarr;</span>
                    )}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* VIEW: AUTHENTICATION SUCCESS */}
          {step === "success" && (
            <div className="py-8 text-center space-y-4">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 300, damping: 20 }}
                className="w-16 h-16 mx-auto rounded-full bg-[#D4AF37]/15 border border-[#D4AF37] flex items-center justify-center text-[#D4AF37]"
              >
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
                </svg>
              </motion.div>
              <h3 className="text-lg font-medium tracking-wide">Authentication Confirmed</h3>
              <p className={`text-xs ${isDark ? "text-white/60" : "text-black/60"}`}>
                Welcome to VELORA. Your session is now securely authenticated.
              </p>
            </div>
          )}
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
