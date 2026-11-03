import { GoogleLogin } from '@react-oauth/google';
import { useState, useEffect, useRef, type FormEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import PasswordInput from "./PasswordInput";

type Step = "ACCOUNT" | "EMAIL" | "MOBILE" | "COMPLETE";

type ProviderStatus = {
  email: { configured: boolean; provider: string; requiredEnv: string[] };
  sms: { configured: boolean; provider: string; requiredEnv: string[] };
  google: { configured: boolean; provider: string; requiredEnv: string[] };
};

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (token: string, seller: unknown) => void;
  theme?: "light" | "dark";
};

const API_BASE = "http://localhost:5000/api";

export default function SellerRegistrationModal({
  isOpen,
  onClose,
  onSuccess,
  theme = "dark"
}: Props) {
  // Wizard Step
  const [step, setStep] = useState<Step>("ACCOUNT");

  // Form Fields
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [storeName, setStoreName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [agreedToTerms, setAgreedToTerms] = useState(false);

  // OTP Verification States
  const [sessionToken, setSessionToken] = useState("");
  const [emailOtp, setEmailOtp] = useState("");
  const [phoneOtp, setPhoneOtp] = useState("");
  const [maskedEmail, setMaskedEmail] = useState("");
  const [maskedPhone, setMaskedPhone] = useState("");

  // Timers and Cooldowns
  const [cooldown, setCooldown] = useState(0);

  // UI / Network States
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [providerStatus, setProviderStatus] = useState<ProviderStatus | null>(null);

  const otpInputRef = useRef<HTMLInputElement>(null);

  // Fetch provider status once when modal opens
  useEffect(() => {
    if (isOpen) {
      fetch(`${API_BASE}/auth/seller/provider-status`)
        .then((res) => res.json())
        .then((data) => {
          if (data?.providers) {
            setProviderStatus(data.providers);
          }
        })
        .catch(() => {});
    }
  }, [isOpen]);

  // Handle countdown timer
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setInterval(() => {
      setCooldown((current) => (current <= 1 ? 0 : current - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  // Focus OTP input on step change
  useEffect(() => {
    if (step === "EMAIL" || step === "MOBILE") {
      setTimeout(() => otpInputRef.current?.focus(), 150);
    }
  }, [step]);

  // Reset modal on close
  const handleClose = () => {
    if (loading) return;
    setError("");
    setNotice("");
    onClose();
  };

  // Step 1: Submit Account Details & Request Real Email OTP
  async function handleAccountSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setNotice("");

    if (!name.trim()) {
      setError("Please enter your full name.");
      return;
    }

    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("Please enter a valid email address.");
      return;
    }

    const cleanPhone = phone.trim().replace(/[\s\-()]/g, "");
    if (!cleanPhone || !/^\+?[0-9]{10,15}$/.test(cleanPhone)) {
      setError("Please enter a valid mobile number (e.g. +91 98765 43210).");
      return;
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters long.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    if (!agreedToTerms) {
      setError("Please accept the VELORA Atelier Terms & Privacy Policy to continue.");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(`${API_BASE}/auth/seller/initiate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          phone: cleanPhone,
          storeName: storeName.trim(),
          password
        })
      });

      const data = await response.json();

      if (!response.ok) {
        if (data.code === "SMTP_NOT_CONFIGURED") {
          throw new Error(
            "REAL Email Delivery Not Configured: Please set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and EMAIL_FROM in server/.env."
          );
        }
        throw new Error(data.message || "Failed to initiate registration.");
      }

      setSessionToken(data.sessionToken);
      setMaskedEmail(data.emailMasked || email.trim());
      setMaskedPhone(data.phoneMasked || cleanPhone);
      setCooldown(data.resendCooldown || 60);
      setNotice(data.message || "Verification code dispatched to your email.");
      setStep("EMAIL");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration request failed.");
    } finally {
      setLoading(false);
    }
  }

  // Step 2: Verify Real Email OTP
  async function handleVerifyEmailOtp(e: FormEvent) {
    e.preventDefault();
    setError("");
    setNotice("");

    if (!emailOtp.trim() || emailOtp.trim().length !== 6) {
      setError("Please enter the complete 6-digit verification code.");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(`${API_BASE}/auth/seller/verify-email-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionToken,
          otp: emailOtp.trim()
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Email verification failed.");
      }

      setCooldown(data.resendCooldown || 60);
      setNotice(data.message || "Email verified. Proceeding to mobile verification.");
      setStep("MOBILE");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed.");
    } finally {
      setLoading(false);
    }
  }

  // Step 3: Verify Real Mobile OTP & Create Account
  async function handleVerifyMobileOtp(e: FormEvent) {
    e.preventDefault();
    setError("");
    setNotice("");

    if (!phoneOtp.trim() || phoneOtp.trim().length !== 6) {
      setError("Please enter the complete 6-digit mobile code.");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(`${API_BASE}/auth/seller/verify-mobile-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionToken,
          otp: phoneOtp.trim()
        })
      });

      const data = await response.json();

      if (!response.ok) {
        if (data.code === "SMS_NOT_CONFIGURED") {
          throw new Error(
            "REAL SMS Delivery Not Configured: Please set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER in server/.env."
          );
        }
        throw new Error(data.message || "Mobile verification failed.");
      }

      // Store seller session token for instant authenticated redirect
      if (data.token) {
        sessionStorage.setItem("velora_seller_token", data.token);
      }

      if (onSuccess && data.token) {
        onSuccess(data.token, data.seller);
      }

      setNotice("Account verified & created successfully. Welcome email dispatched.");
      setStep("COMPLETE");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Mobile verification failed.");
    } finally {
      setLoading(false);
    }
  }

  // Resend Email OTP
  async function handleResendEmailOtp() {
    if (cooldown > 0 || loading) return;
    setError("");
    setNotice("");
    setLoading(true);

    try {
      const response = await fetch(`${API_BASE}/auth/seller/resend-email-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionToken })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Failed to resend code.");

      setCooldown(data.resendCooldown || 60);
      setNotice(data.message || "A new 6-digit code has been dispatched.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not resend email code.");
    } finally {
      setLoading(false);
    }
  }

  // Resend Mobile OTP
  async function handleResendMobileOtp() {
    if (cooldown > 0 || loading) return;
    setError("");
    setNotice("");
    setLoading(true);

    try {
      const response = await fetch(`${API_BASE}/auth/seller/resend-mobile-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionToken })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Failed to resend SMS code.");

      setCooldown(data.resendCooldown || 60);
      setNotice(data.message || "A new SMS code has been dispatched.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not resend mobile code.");
    } finally {
      setLoading(false);
    }
  }

  // Google Login Handler
async function handleGoogleLoginSuccess(credentialResponse: { credential?: string }) {
  const idToken = credentialResponse.credential;

  if (!idToken) {
    setError("Google sign-in did not return an ID token.");
    return;
  }

  setLoading(true);
  setError("");

  try {
    const response = await fetch(`${API_BASE}/auth/seller/google`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
    });

    const data = await response.json();

    if (!response.ok || data.status !== "success") {
      throw new Error(data.message || "Google sign-in failed.");
    }

    sessionStorage.setItem("velora_seller_token", data.token);
    onSuccess?.(data.token, data.seller);
    onClose();
  } catch (err) {
    setError(err instanceof Error ? err.message : "Google sign-in failed.");
  } finally {
    setLoading(false);
  }
}

  if (!isOpen) return null;

  const isDark = theme === "dark";

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[250] flex items-center justify-center p-4 sm:p-6 overflow-y-auto">
        
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={handleClose}
          className="fixed inset-0 bg-black/75 backdrop-blur-md"
        />

        {/* Modal Window */}
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 15 }}
          transition={{ type: "spring", stiffness: 280, damping: 26 }}
          className={`relative my-auto w-full max-w-xl max-h-[92vh] overflow-y-auto rounded-3xl p-6 sm:p-10 shadow-2xl border transition-colors ${
            isDark
              ? "bg-[#141416] text-[#F5F4F0] border-white/15"
              : "bg-[#F9F7F2] text-[#121212] border-black/10"
          }`}
        >
          {/* Top Bar: Brand, Progress, Close */}
          <div className="flex items-start justify-between border-b border-white/10 dark:border-white/10 pb-5">
            <div>
              <span className="text-[10px] uppercase tracking-[0.35em] text-[#D4AF37]">
                VELORA ATELIER &middot; ONBOARDING
              </span>
              <h2 className="mt-1 text-2xl sm:text-3xl font-normal font-editorial-serif tracking-tight">
                {step === "ACCOUNT" && "Create Seller Account"}
                {step === "EMAIL" && "Verify Your Email"}
                {step === "MOBILE" && "Verify Mobile Number"}
                {step === "COMPLETE" && "Atelier Activated"}
              </h2>
            </div>
            <button
              type="button"
              onClick={handleClose}
              disabled={loading}
              className="h-9 w-9 rounded-full border border-current/20 flex items-center justify-center text-lg hover:opacity-60 transition"
              aria-label="Close"
            >
              &times;
            </button>
          </div>

          {/* Luxury 4-Step Progress Indicator */}
          <div className="my-6 flex items-center justify-between text-[11px] tracking-[0.2em] uppercase">
            {[
              { id: "ACCOUNT", label: "Account" },
              { id: "EMAIL", label: "Email" },
              { id: "MOBILE", label: "Mobile" },
              { id: "COMPLETE", label: "Done" }
            ].map((s, index) => {
              const stepIndex = ["ACCOUNT", "EMAIL", "MOBILE", "COMPLETE"].indexOf(step);
              const isActive = s.id === step;
              const isPast = index < stepIndex;

              return (
                <div key={s.id} className="flex-1 flex flex-col items-center">
                  <div className="flex items-center w-full">
                    <span
                      className={`h-px flex-1 ${
                        index === 0
                          ? "bg-transparent"
                          : isPast
                          ? "bg-[#D4AF37]"
                          : "bg-current/15"
                      }`}
                    />
                    <span
                      className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold border transition ${
                        isActive
                          ? "border-[#D4AF37] bg-[#D4AF37] text-black ring-2 ring-[#D4AF37]/30"
                          : isPast
                          ? "border-[#D4AF37] bg-transparent text-[#D4AF37]"
                          : "border-current/20 text-current/40"
                      }`}
                    >
                      {isPast ? "âœ“" : index + 1}
                    </span>
                    <span
                      className={`h-px flex-1 ${
                        index === 3
                          ? "bg-transparent"
                          : isPast
                          ? "bg-[#D4AF37]"
                          : "bg-current/15"
                      }`}
                    />
                  </div>
                  <span
                    className={`mt-2 text-[9px] tracking-[0.18em] ${
                      isActive ? "text-[#D4AF37] font-semibold" : "opacity-40"
                    }`}
                  >
                    {s.label}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Notifications / Errors */}
          {error && (
            <div className="mb-5 rounded-xl border border-red-500/30 bg-red-500/10 p-3.5 text-xs text-red-500">
              {error}
            </div>
          )}

          {notice && (
            <div className="mb-5 rounded-xl border border-[#D4AF37]/40 bg-[#D4AF37]/10 p-3.5 text-xs text-[#D4AF37]">
              {notice}
            </div>
          )}

          {/* =========================================================================
              STEP 1: ACCOUNT DETAILS
             ========================================================================= */}
          {step === "ACCOUNT" && (
            <form onSubmit={handleAccountSubmit} className="space-y-4">
              <div>
                <label className="block text-xs uppercase tracking-wider opacity-60 mb-1">
                  Full Name *
                </label>
                <input
                  required
                  type="text"
                  maxLength={100}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Gabriel Vane"
                  className="w-full rounded-xl border border-current/15 bg-current/[0.03] px-4 py-3 text-xs outline-none focus:border-[#D4AF37] transition"
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs uppercase tracking-wider opacity-60 mb-1">
                    Email Address *
                  </label>
                  <input
                    required
                    type="email"
                    maxLength={254}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@domain.com"
                    className="w-full rounded-xl border border-current/15 bg-current/[0.03] px-4 py-3 text-xs outline-none focus:border-[#D4AF37] transition"
                  />
                </div>
                <div>
                  <label className="block text-xs uppercase tracking-wider opacity-60 mb-1">
                    Mobile Number *
                  </label>
                  <input
                    required
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+91 98765 43210"
                    className="w-full rounded-xl border border-current/15 bg-current/[0.03] px-4 py-3 text-xs outline-none focus:border-[#D4AF37] transition"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs uppercase tracking-wider opacity-60 mb-1">
                  Store / Atelier Name (Optional)
                </label>
                <input
                  type="text"
                  maxLength={100}
                  value={storeName}
                  onChange={(e) => setStoreName(e.target.value)}
                  placeholder="e.g. Vane Fine Horology"
                  className="w-full rounded-xl border border-current/15 bg-current/[0.03] px-4 py-3 text-xs outline-none focus:border-[#D4AF37] transition"
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs uppercase tracking-wider opacity-60 mb-1">
                    Password *
                  </label>
                  <PasswordInput
                    variant="tailwind"
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Min. 8 characters"
                    inputClassName="w-full rounded-xl border border-current/15 bg-current/[0.03] px-4 py-3 text-xs outline-none focus:border-[#D4AF37] transition"
                  />
                </div>
                <div>
                  <label className="block text-xs uppercase tracking-wider opacity-60 mb-1">
                    Confirm Password *
                  </label>
                  <PasswordInput
                    variant="tailwind"
                    required
                    minLength={8}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter password"
                    inputClassName="w-full rounded-xl border border-current/15 bg-current/[0.03] px-4 py-3 text-xs outline-none focus:border-[#D4AF37] transition"
                  />
                </div>
              </div>

              <div className="pt-1">
                <label className="flex items-start gap-3 cursor-pointer text-xs opacity-75">
                  <input
                    required
                    type="checkbox"
                    checked={agreedToTerms}
                    onChange={(e) => setAgreedToTerms(e.target.checked)}
                    className="mt-0.5 rounded border-current/30 text-[#D4AF37] focus:ring-[#D4AF37]"
                  />
                  <span>
                    I accept the VELORA Atelier Partner Agreement and Privacy Standard.
                  </span>
                </label>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-full bg-[#D4AF37] hover:bg-[#E5C365] text-black py-4 text-xs font-semibold tracking-[0.24em] uppercase transition shadow-lg disabled:opacity-50 mt-4"
              >
                {loading ? "Dispatched Code..." : "CONTINUE TO VERIFICATION"}
              </button>

              {/* Divider */}
              <div className="relative my-6 flex items-center justify-center">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-current/10" />
                </div>
                <span className={`relative px-4 text-[10px] uppercase tracking-[0.2em] opacity-40 ${isDark ? "bg-[#141416]" : "bg-[#F9F7F2]"}`}>
                  Or Continue With
                </span>
              </div>

              {/* Continue with Google */}
<div className="w-full flex justify-center">
  {providerStatus?.google.configured ? (
    <GoogleLogin
      onSuccess={handleGoogleLoginSuccess}
      onError={() => setError("Google sign-in failed. Please try again.")}
      theme={isDark ? "filled_black" : "outline"}
      shape="pill"
      text="continue_with"
      width="320"
    />
  ) : (
    <button
      type="button"
      onClick={() => setError("Google Login is not configured. Check the Google Client ID settings.")}
      className="w-full flex items-center justify-center gap-3 rounded-full border border-current/20 py-3.5 text-xs font-medium tracking-wider"
    >
      Continue with Google
    </button>
  )}
</div>

              {/* Already have an account */}
              <div className="pt-3 text-center">
                <a
                  href="/seller"
                  className="text-xs opacity-60 hover:opacity-100 transition underline underline-offset-4"
                >
                  Already have an atelier account? Sign In &rarr;
                </a>
              </div>
            </form>
          )}

          {/* =========================================================================
              STEP 2: EMAIL VERIFICATION (REAL OTP)
             ========================================================================= */}
          {step === "EMAIL" && (
            <form onSubmit={handleVerifyEmailOtp} className="space-y-6">
              <div className="rounded-2xl border border-current/10 bg-current/[0.02] p-5 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#D4AF37]/20 text-[#D4AF37] mb-3">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                </div>
                <h3 className="text-base font-medium font-editorial-serif">
                  Check Your Inbox
                </h3>
                <p className="mt-1 text-xs opacity-65 leading-relaxed">
                  We sent a 6-digit verification code to{" "}
                  <strong className="text-current font-medium">{maskedEmail}</strong>.
                </p>
              </div>

              <div>
                <label className="block text-center text-xs uppercase tracking-[0.2em] opacity-60 mb-2">
                  Enter 6-Digit Email Code
                </label>
                <input
                  ref={otpInputRef}
                  required
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  pattern="[0-9]{6}"
                  value={emailOtp}
                  onChange={(e) => setEmailOtp(e.target.value.replace(/\D/g, ""))}
                  placeholder="&bull; &bull; &bull; &bull; &bull; &bull;"
                  className="w-full text-center text-2xl tracking-[0.6em] font-semibold py-3.5 rounded-2xl border border-current/20 bg-current/[0.03] outline-none focus:border-[#D4AF37]"
                />
              </div>

              <button
                type="submit"
                disabled={loading || emailOtp.length !== 6}
                className="w-full rounded-full bg-[#D4AF37] hover:bg-[#E5C365] text-black py-4 text-xs font-semibold tracking-[0.24em] uppercase transition shadow-lg disabled:opacity-50"
              >
                {loading ? "Verifying..." : "Confirm Email Code â†’"}
              </button>

              <div className="flex items-center justify-between text-xs pt-2">
                <button
                  type="button"
                  onClick={() => { setStep("ACCOUNT"); setError(""); }}
                  className="opacity-50 hover:opacity-100 transition"
                >
                  &larr; Change Email
                </button>

                <button
                  type="button"
                  onClick={handleResendEmailOtp}
                  disabled={cooldown > 0 || loading}
                  className="text-[#D4AF37] hover:underline disabled:opacity-40 disabled:no-underline font-medium"
                >
                  {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend Code"}
                </button>
              </div>
            </form>
          )}

          {/* =========================================================================
              STEP 3: MOBILE VERIFICATION (REAL SMS OTP)
             ========================================================================= */}
          {step === "MOBILE" && (
            <form onSubmit={handleVerifyMobileOtp} className="space-y-6">
              <div className="rounded-2xl border border-current/10 bg-current/[0.02] p-5 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#D4AF37]/20 text-[#D4AF37] mb-3">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                </div>
                <h3 className="text-base font-medium font-editorial-serif">
                  Mobile Verification
                </h3>
                <p className="mt-1 text-xs opacity-65 leading-relaxed">
                  Enter the 6-digit SMS verification code sent to{" "}
                  <strong className="text-current font-medium">{maskedPhone}</strong>.
                </p>

                {!providerStatus?.sms.configured && (
                  <div className="mt-4 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-left text-xs text-amber-400">
                    <strong className="block font-semibold">SMS Provider Notice:</strong>
                    Twilio SMS credentials are not yet configured on this server. To enable real SMS delivery, add <code className="bg-black/30 px-1 py-0.5 rounded">TWILIO_ACCOUNT_SID</code>, <code className="bg-black/30 px-1 py-0.5 rounded">TWILIO_AUTH_TOKEN</code>, and <code className="bg-black/30 px-1 py-0.5 rounded">TWILIO_PHONE_NUMBER</code> in <code className="bg-black/30 px-1 py-0.5 rounded">server/.env</code>.
                  </div>
                )}
              </div>

              <div>
                <label className="block text-center text-xs uppercase tracking-[0.2em] opacity-60 mb-2">
                  Enter 6-Digit SMS Code
                </label>
                <input
                  ref={otpInputRef}
                  required
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  pattern="[0-9]{6}"
                  value={phoneOtp}
                  onChange={(e) => setPhoneOtp(e.target.value.replace(/\D/g, ""))}
                  placeholder="&bull; &bull; &bull; &bull; &bull; &bull;"
                  className="w-full text-center text-2xl tracking-[0.6em] font-semibold py-3.5 rounded-2xl border border-current/20 bg-current/[0.03] outline-none focus:border-[#D4AF37]"
                />
              </div>

              <button
                type="submit"
                disabled={loading || phoneOtp.length !== 6}
                className="w-full rounded-full bg-[#D4AF37] hover:bg-[#E5C365] text-black py-4 text-xs font-semibold tracking-[0.24em] uppercase transition shadow-lg disabled:opacity-50"
              >
                {loading ? "Activating Atelier..." : "Verify & Activate Account â†’"}
              </button>

              <div className="flex items-center justify-between text-xs pt-2">
                <button
                  type="button"
                  onClick={() => { setStep("EMAIL"); setError(""); }}
                  className="opacity-50 hover:opacity-100 transition"
                >
                  &larr; Back to Email
                </button>

                <button
                  type="button"
                  onClick={handleResendMobileOtp}
                  disabled={cooldown > 0 || loading || !providerStatus?.sms.configured}
                  className="text-[#D4AF37] hover:underline disabled:opacity-40 disabled:no-underline font-medium"
                >
                  {cooldown > 0 ? `Resend SMS in ${cooldown}s` : "Resend SMS"}
                </button>
              </div>
            </form>
          )}

          {/* =========================================================================
              STEP 4: COMPLETE & REDIRECT
             ========================================================================= */}
          {step === "COMPLETE" && (
            <div className="text-center py-6 space-y-6">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border-2 border-[#D4AF37] text-2xl text-[#D4AF37]">
                âœ“
              </div>
              <div>
                <span className="text-[10px] uppercase tracking-[0.3em] text-[#D4AF37]">
                  V E L O R A &middot; ATELIER ACTIVE
                </span>
                <h3 className="mt-2 text-3xl font-normal font-editorial-serif">
                  Welcome to the Collective
                </h3>
                <p className="mt-3 text-xs opacity-70 max-w-sm mx-auto leading-relaxed">
                  Your seller account has been verified and registered. A welcome email has been dispatched to your inbox.
                </p>
              </div>

              <div className="pt-4">
                <a
                  href="/seller"
                  className="inline-block w-full rounded-full bg-[#D4AF37] hover:bg-[#E5C365] text-black py-4 text-xs font-semibold tracking-[0.24em] uppercase transition shadow-xl"
                >
                  Enter Seller Workspace &rarr;
                </a>
              </div>
            </div>
          )}
        </motion.div>
      </div>
    </AnimatePresence>
  );
}




