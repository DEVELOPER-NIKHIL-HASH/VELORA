import { useState, useId } from "react";

interface PasswordInputProps {
  // Core input props
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  autoComplete?: string;
  disabled?: boolean;
  name?: string;

  // Styling variants
  variant?: "admin" | "seller" | "tailwind";

  // For admin variant: className and style on the <input>
  className?: string;
  style?: React.CSSProperties;

  // For tailwind variant: className on the <input>
  inputClassName?: string;
}

/**
 * Reusable password input with show/hide toggle.
 * Supports three design system variants:
 *   - "admin"   → wraps .admin-search inputs (AdminDashboard)
 *   - "seller"  → wraps .velora-sd-form-input inputs (SellerDashboard)
 *   - "tailwind"→ wraps Tailwind-classed inputs (SellerRegistrationModal)
 */
export default function PasswordInput({
  value,
  onChange,
  placeholder,
  required,
  minLength,
  maxLength,
  autoComplete,
  disabled,
  name,
  variant = "seller",
  className,
  style,
  inputClassName,
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  const inputId = useId();

  const toggle = () => setVisible((v) => !v);

  // Eye SVG icons (inline, no external deps)
  const EyeIcon = (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );

  const EyeOffIcon = (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );

  // ── Admin variant ──────────────────────────────────────────────────────────
  if (variant === "admin") {
    return (
      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          ...(style ?? {}),
        }}
      >
        <input
          id={inputId}
          type={visible ? "text" : "password"}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          required={required}
          minLength={minLength}
          maxLength={maxLength}
          autoComplete={autoComplete}
          disabled={disabled}
          name={name}
          className={className ?? "admin-search"}
          style={{ width: "100%", paddingRight: "42px", boxSizing: "border-box" }}
        />
        <button
          type="button"
          onClick={toggle}
          aria-label={visible ? "Hide password" : "Show password"}
          style={{
            position: "absolute",
            right: "12px",
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "#9a9ba5",
            padding: "0",
            display: "flex",
            alignItems: "center",
            lineHeight: 1,
          }}
          tabIndex={0}
        >
          {visible ? EyeOffIcon : EyeIcon}
        </button>
      </div>
    );
  }

  // ── Seller variant ─────────────────────────────────────────────────────────
  if (variant === "seller") {
    return (
      <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
        <input
          id={inputId}
          type={visible ? "text" : "password"}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          required={required}
          minLength={minLength}
          maxLength={maxLength}
          autoComplete={autoComplete}
          disabled={disabled}
          name={name}
          className={className ?? "velora-sd-form-input"}
          style={{ paddingRight: "40px", boxSizing: "border-box", ...(style ?? {}) }}
        />
        <button
          type="button"
          onClick={toggle}
          aria-label={visible ? "Hide password" : "Show password"}
          style={{
            position: "absolute",
            right: "10px",
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "#6b7280",
            padding: "0",
            display: "flex",
            alignItems: "center",
            lineHeight: 1,
          }}
          tabIndex={0}
        >
          {visible ? EyeOffIcon : EyeIcon}
        </button>
      </div>
    );
  }

  // ── Tailwind variant ───────────────────────────────────────────────────────
  return (
    <div className="relative flex items-center">
      <input
        id={inputId}
        type={visible ? "text" : "password"}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        required={required}
        minLength={minLength}
        maxLength={maxLength}
        autoComplete={autoComplete}
        disabled={disabled}
        name={name}
        className={
          inputClassName ??
          "w-full rounded-xl border border-current/15 bg-current/[0.03] px-4 py-3 text-xs outline-none focus:border-[#D4AF37] transition"
        }
        style={{ paddingRight: "2.5rem" }}
      />
      <button
        type="button"
        onClick={toggle}
        aria-label={visible ? "Hide password" : "Show password"}
        className="absolute right-3 flex items-center text-current opacity-50 hover:opacity-80 transition-opacity"
        tabIndex={0}
      >
        {visible ? EyeOffIcon : EyeIcon}
      </button>
    </div>
  );
}
