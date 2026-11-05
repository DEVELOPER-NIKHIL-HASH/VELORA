/**
 * VELORA Customer Authentication Service
 * Manages customer session, token persistence, and profile synchronization.
 */

export type CustomerUser = {
  id: number;
  name: string;
  email?: string | null;
  phone?: string | null;
  email_verified: boolean;
  phone_verified: boolean;
  avatar_url?: string | null;
  created_at?: string;
};

export type CustomerOrder = {
  id: number;
  customer_name: string;
  email: string;
  total: number;
  status: "Pending" | "Processing" | "Shipped" | "Delivered" | "Cancelled";
  payment_status?: string;
  tracking_number?: string;
  courier_name?: string;
  created_at: string;
  items: Array<{
    id: number;
    name: string;
    price: number;
    quantity: number;
  }>;
};

export type ProviderStatus = {
  email: { configured: boolean; provider: string; requiredEnv: string[] };
  sms: { configured: boolean; provider: string; requiredEnv: string[] };
  google: { configured: boolean; provider: string; requiredEnv: string[] };
};

const TOKEN_KEY = "velora_customer_token";
const USER_KEY = "velora_customer_user";
const AUTH_CHANGE_EVENT = "velora_customer_auth_change";

export function getCustomerToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function getStoredCustomer(): CustomerUser | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function setCustomerSession(token: string, customer: CustomerUser): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(customer));
  window.dispatchEvent(new CustomEvent(AUTH_CHANGE_EVENT, { detail: customer }));
}

export function clearCustomerSession(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  window.dispatchEvent(new CustomEvent(AUTH_CHANGE_EVENT, { detail: null }));
}

export function subscribeToCustomerAuth(
  callback: (customer: CustomerUser | null) => void
): () => void {
  const handler = (event: Event) => {
    const customEvent = event as CustomEvent<CustomerUser | null>;
    callback(customEvent.detail ?? null);
  };
  window.addEventListener(AUTH_CHANGE_EVENT, handler);
  return () => window.removeEventListener(AUTH_CHANGE_EVENT, handler);
}

export async function fetchCurrentCustomer(): Promise<{
  customer: CustomerUser;
  orders: CustomerOrder[];
} | null> {
  const token = getCustomerToken();
  if (!token) return null;

  try {
    const res = await fetch("/api/customer/auth/me", {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json"
      }
    });

    if (!res.ok) {
      if (res.status === 401) {
        clearCustomerSession();
      }
      return null;
    }

    const data = await res.json();
    if (data.status === "success" && data.customer) {
      localStorage.setItem(USER_KEY, JSON.stringify(data.customer));
      return {
        customer: data.customer,
        orders: data.orders || []
      };
    }
    return null;
  } catch (error) {
    console.error("Failed to fetch customer profile:", error);
    return null;
  }
}

export async function logoutCustomer(): Promise<void> {
  const token = getCustomerToken();
  if (token) {
    try {
      await fetch("/api/customer/auth/logout", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
    } catch {
      // Ignore network errors on logout
    }
  }
  clearCustomerSession();
}
