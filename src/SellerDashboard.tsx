import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import "./SellerDashboard.css";
import PasswordInput from "./PasswordInput";

import headphonesImg from "./assets/products/headphones.jpg";
import watchImg from "./assets/products/watch.jpg";
import backpackImg from "./assets/products/backpack.jpg";

const API = "/api";

type TabKey =
  | "dashboard"
  | "orders"
  | "delivery"
  | "products"
  | "analytics"
  | "payouts"
  | "discounts"
  | "audience"
  | "appearance"
  | "plugins"
  | "settings";

type Seller = {
  id: number;
  name: string;
  email: string;
  role?: string;
};

type Store = {
  id: number;
  name: string;
  slug: string;
  description?: string;
  announcement?: string;
  theme_color?: string;
  logo_url?: string;
  banner_url?: string;
  contact_email?: string;
  contact_phone?: string;
  bank_account_holder?: string;
  bank_name?: string;
  bank_account_number?: string;
  bank_ifsc?: string;
  created_at?: string;
};

type Product = {
  id: number;
  store_id?: number;
  name: string;
  description: string;
  price: number;
  stock: number;
  image_url: string;
  category?: string;
  is_active: number | boolean;
  created_at?: string;
};

type ProductForm = {
  name: string;
  description: string;
  price: string;
  stock: string;
  image_url: string;
  category: string;
  is_active: boolean;
};

type OrderItem = {
  id: number;
  name: string;
  price: number;
  quantity: number;
  store_id?: number;
};

type Order = {
  id: number;
  customer_name: string;
  email: string;
  total: number;
  items: OrderItem[];
  status: "Pending" | "Processing" | "Shipped" | "Delivered" | "Cancelled";
  created_at: string;
  tracking_number?: string;
  courier_name?: string;
  dispatch_date?: string;
  platform_fee?: number | null;
  seller_payout?: number | null;
  fee_rate?: number | null;
  payment_status?: string | null;
  razorpay_order_id?: string | null;
  razorpay_payment_id?: string | null;
};

type Discount = {
  id: number;
  store_id: number;
  code: string;
  type: "percentage" | "fixed";
  value: number;
  min_order_amount: number;
  is_active: number;
  created_at: string;
};

type SellerWalletFinancials = {
  store_id: number;
  total_sales: number;
  total_orders: number;
  gross_earnings: number;
  platform_fee: number;
  net_seller_earnings: number;
  pending_balance: number;
  refunded_amount: number;
  total_order_refunds: number;
  withdrawn_amount: number;
  pending_payouts: number;
  available_balance: number;
  current_wallet_balance: number;
  delivered_orders_count: number;
  pending_orders_count: number;
  minimum_payout_amount: number;
};

type PayoutRequest = {
  id: number;
  payout_ref: string;
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

type FinancialLedgerEntry = {
  id: number;
  transaction_ref: string;
  order_id?: number | null;
  payout_id?: number | null;
  refund_id?: number | null;
  transaction_type: string;
  entry_type: "DEBIT" | "CREDIT";
  amount: number;
  status: string;
  description: string;
  created_at: string;
};

const emptyProductForm: ProductForm = {
  name: "",
  description: "",
  price: "",
  stock: "0",
  image_url: "",
  category: "General",
  is_active: true,
};

function formatMoney(value: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);
}

function timeAgo(dateString: string): string {
  if (!dateString) return "";
  const d = new Date(dateString.replace(" ", "T") + (dateString.includes("Z") ? "" : "Z"));
  const now = new Date();
  const diffSec = Math.floor((now.getTime() - d.getTime()) / 1000);

  if (diffSec < 60) return "Just now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  const days = Math.floor(diffSec / 86400);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString("en-IN", { month: "short", day: "numeric" });
}

function getProductThumbnail(name: string, fallbackUrl?: string) {
  if (fallbackUrl && fallbackUrl.trim()) return fallbackUrl.trim();
  const n = (name || "").toLowerCase();
  if (n.includes("headphone") || n.includes("audio")) return headphonesImg;
  if (n.includes("watch")) return watchImg;
  if (n.includes("pack") || n.includes("bag")) return backpackImg;
  return headphonesImg;
}

async function handleResponse(res: Response) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) {
      throw new Error("Session expired. Please sign in again.");
    }
    throw new Error(data.message || "Request failed.");
  }
  return data;
}

export default function SellerDashboard() {
  const [token, setToken] = useState(() => sessionStorage.getItem("velora_seller_token") || "");
  const [seller, setSeller] = useState<Seller | null>(null);
  const [store, setStore] = useState<Store | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("dashboard");
  const [loading, setLoading] = useState(() => Boolean(sessionStorage.getItem("velora_seller_token")));

  // Data states
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [discounts, setDiscounts] = useState<Discount[]>([]);
  const [plugins, setPlugins] = useState<Record<string, { is_enabled: boolean; config: Record<string, string> }>>({});

  // UI state
  const [searchQuery, setSearchQuery] = useState("");
  const [chartPeriod, setChartPeriod] = useState<"7d" | "30d" | "all">("7d");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
  const [notifDropdownOpen, setNotifDropdownOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  // Modals
  const [showProductModal, setShowProductModal] = useState(false);
  const [editingProductId, setEditingProductId] = useState<number | null>(null);
  const [productForm, setProductForm] = useState<ProductForm>(emptyProductForm);
  const [uploadedImageUrl, setUploadedImageUrl] = useState("");
  const [directImageUrl, setDirectImageUrl] = useState("");
  const [productImageUploading, setProductImageUploading] = useState(false);
  const [productImagePreview, setProductImagePreview] = useState("");
  const [productImageError, setProductImageError] = useState("");
  const productFileInputRef = useRef<HTMLInputElement | null>(null);

  const [showDiscountModal, setShowDiscountModal] = useState(false);
  const [discountCode, setDiscountCode] = useState("");
  const [discountType, setDiscountType] = useState<"percentage" | "fixed">("percentage");
  const [discountValue, setDiscountValue] = useState("");
  const [discountMinOrder, setDiscountMinOrder] = useState("");

  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [pluginConfigModal, setPluginConfigModal] = useState<string | null>(null);
  const [pluginConfigInput, setPluginConfigInput] = useState<Record<string, string>>({});

  // Order status update state
  const [updatingOrderId, setUpdatingOrderId] = useState<number | null>(null);
  const [deliveryEditOrderId, setDeliveryEditOrderId] = useState<number | null>(null);
  const [deliveryTrackingNum, setDeliveryTrackingNum] = useState("");
  const [deliveryCourier, setDeliveryCourier] = useState("BlueDart");

  // Login form state
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginSaving, setLoginSaving] = useState(false);

  // Appearance Form state
  const [appearanceName, setAppearanceName] = useState("");
  const [appearanceDesc, setAppearanceDesc] = useState("");
  const [appearanceAnnouncement, setAppearanceAnnouncement] = useState("");
  const [appearanceThemeColor, setAppearanceThemeColor] = useState("#d4af37");
  const [appearanceLogoUrl, setAppearanceLogoUrl] = useState("");
  const [appearanceBannerUrl, setAppearanceBannerUrl] = useState("");
  const [appearanceSaving, setAppearanceSaving] = useState(false);
  const [appearanceLogoUploading, setAppearanceLogoUploading] = useState(false);
  const [appearanceLogoPreview, setAppearanceLogoPreview] = useState("");
  const logoFileInputRef = useRef<HTMLInputElement | null>(null);

  // Payout Form state
  const [payoutHolder, setPayoutHolder] = useState("");
  const [payoutBank, setPayoutBank] = useState("");
  const [payoutAccount, setPayoutAccount] = useState("");
  const [payoutIfsc, setPayoutIfsc] = useState("");
  const [payoutSaving, setPayoutSaving] = useState(false);

  // Phase 5: Financial Infrastructure state
  const [sellerFinancials, setSellerFinancials] = useState<SellerWalletFinancials | null>(null);
  const [sellerPayouts, setSellerPayouts] = useState<PayoutRequest[]>([]);
  const [sellerTransactions, setSellerTransactions] = useState<FinancialLedgerEntry[]>([]);
  const [payoutReqAmount, setPayoutReqAmount] = useState("");
  const [payoutReqLoading, setPayoutReqLoading] = useState(false);
  const [payoutReqNotice, setPayoutReqNotice] = useState("");
  const [payoutReqError, setPayoutReqError] = useState("");

  // Settings Password form
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);

  // Clear notice after 4 seconds
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  const logout = useCallback(() => {
    sessionStorage.removeItem("velora_seller_token");
    setToken("");
    setSeller(null);
    setStore(null);
    setProducts([]);
    setOrders([]);
    setDiscounts([]);
    setLoginPassword("");
    setNotice("");
    setError("");
  }, []);

  // Load all seller store resources
  const loadDashboardData = useCallback(async (authToken: string) => {
    if (!authToken) return;
    try {
      // 1. Fetch seller profile and store
      const profileRes = await fetch(`${API}/auth/me`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const profileData = await handleResponse(profileRes);
      setSeller(profileData.seller || null);

      let currentStore = profileData.stores?.[0] || null;

      // 2. Fetch full store details (appearance, bank, etc.)
      const storeRes = await fetch(`${API}/seller/store`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (storeRes.ok) {
        const storeData = await storeRes.json();
        if (storeData.store) {
          currentStore = storeData.store;
        }
      }
      setStore(currentStore);

      if (currentStore) {
        setAppearanceName(currentStore.name || "");
        setAppearanceDesc(currentStore.description || "");
        setAppearanceAnnouncement(currentStore.announcement || "");
        setAppearanceThemeColor(currentStore.theme_color || "#d4af37");
      setAppearanceLogoUrl(currentStore.logo_url || "");
      setAppearanceLogoPreview("");
      setAppearanceBannerUrl(currentStore.banner_url || "");
        setPayoutHolder(currentStore.bank_account_holder || "");
        setPayoutBank(currentStore.bank_name || "");
        setPayoutAccount(currentStore.bank_account_number || "");
        setPayoutIfsc(currentStore.bank_ifsc || "");
      }

      // 3. Fetch products
      const productsRes = await fetch(`${API}/products`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const productsData = await handleResponse(productsRes);
      setProducts(productsData.products || []);

      // 4. Fetch orders
      const ordersRes = await fetch(`${API}/seller/orders`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const ordersData = await handleResponse(ordersRes);
      setOrders(ordersData.orders || []);

      // 5. Fetch discounts
      const discountsRes = await fetch(`${API}/seller/discounts`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (discountsRes.ok) {
        const discountsData = await discountsRes.json();
        setDiscounts(discountsData.discounts || []);
      }

      // 6. Fetch plugins
      const pluginsRes = await fetch(`${API}/seller/plugins`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (pluginsRes.ok) {
        const pluginsData = await pluginsRes.json();
        setPlugins(pluginsData.plugins || {});
      }

      // 7. Fetch genuine wallet financials
      const walletRes = await fetch(`${API}/seller/wallet`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (walletRes.ok) {
        const walletData = await walletRes.json();
        if (walletData.financials) {
          setSellerFinancials(walletData.financials);
        }
      }

      // 8. Fetch seller payout requests
      const payoutsRes = await fetch(`${API}/seller/payouts`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (payoutsRes.ok) {
        const payoutsData = await payoutsRes.json();
        setSellerPayouts(payoutsData.payouts || []);
      }

      // 9. Fetch financial ledger transactions
      const txRes = await fetch(`${API}/seller/financials/transactions`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (txRes.ok) {
        const txData = await txRes.json();
        setSellerTransactions(txData.transactions || []);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load dashboard.";
      if (msg.includes("Session expired")) {
        logout();
      }
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [logout]);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    loadDashboardData(token);
  }, [token, loadDashboardData]);

  // Handle Login
  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setLoginSaving(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch(`${API}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: loginEmail.trim(), password: loginPassword }),
      });
      const data = await handleResponse(res);
      sessionStorage.setItem("velora_seller_token", data.token);
      setToken(data.token);
      setSeller(data.seller || null);
      await loadDashboardData(data.token);
      setNotice("Welcome back to your atelier workspace.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed.");
    } finally {
      setLoginSaving(false);
    }
  }

  // --- Real Metric Calculations ---
  const sellerFirstName = useMemo(() => {
    if (!seller?.name) return "Seller";
    return seller.name.split(" ")[0];
  }, [seller]);

  const totalSales = useMemo(() => {
    return orders
      .filter((o) => o.status !== "Cancelled")
      .reduce((sum, o) => sum + (Number(o.total) || 0), 0);
  }, [orders]);

  // Settlement calculations (Delivered orders only)
  const settlementMetrics = useMemo(() => {
    const deliveredOrders = orders.filter((o) => o.status === "Delivered");

    let gross = 0;
    let fee = 0;
    let net = 0;

    for (const o of deliveredOrders) {
      const orderTotal = Number(o.total) || 0;
      gross += orderTotal;
      const orderFee =
        typeof o.platform_fee === "number" && !isNaN(o.platform_fee)
          ? o.platform_fee
          : Math.round(orderTotal * 0.03 * 100) / 100;
      const orderNet =
        typeof o.seller_payout === "number" && !isNaN(o.seller_payout)
          ? o.seller_payout
          : Math.round((orderTotal - orderFee) * 100) / 100;
      fee += orderFee;
      net += orderNet;
    }

    return {
      grossCompletedVolume: Math.round(gross * 100) / 100,
      platformFee: Math.round(fee * 100) / 100,
      netSellerEarnings: Math.round(net * 100) / 100,
      deliveredCount: deliveredOrders.length,
    };
  }, [orders]);

  const totalOrdersCount = orders.length;

  const pendingOrdersCount = useMemo(() => {
    return orders.filter((o) => o.status === "Pending").length;
  }, [orders]);

  const totalProductsCount = products.length;

  // Real Trends vs Last 7 Days
  const trends = useMemo(() => {
    const now = new Date();
    const ms7Days = 7 * 24 * 60 * 60 * 1000;
    const tCurrentCutoff = now.getTime() - ms7Days;
    const tPreviousCutoff = now.getTime() - 2 * ms7Days;

    let currentSales = 0;
    let prevSales = 0;
    let currentOrders = 0;
    let prevOrders = 0;
    let currentPending = 0;
    let prevPending = 0;

    for (const o of orders) {
      const t = new Date(o.created_at.replace(" ", "T") + "Z").getTime();
      if (t >= tCurrentCutoff) {
        if (o.status !== "Cancelled") currentSales += Number(o.total) || 0;
        currentOrders += 1;
        if (o.status === "Pending") currentPending += 1;
      } else if (t >= tPreviousCutoff) {
        if (o.status !== "Cancelled") prevSales += Number(o.total) || 0;
        prevOrders += 1;
        if (o.status === "Pending") prevPending += 1;
      }
    }

    function calcChange(curr: number, prev: number) {
      if (prev === 0) {
        return curr > 0 ? { text: `+${curr}`, type: "up" } : { text: "0%", type: "neutral" };
      }
      const pct = Math.round(((curr - prev) / prev) * 100);
      if (pct > 0) return { text: `↑ ${pct}%`, type: "up" };
      if (pct < 0) return { text: `↓ ${Math.abs(pct)}%`, type: "down" };
      return { text: "→ 0%", type: "neutral" };
    }

    return {
      sales: calcChange(currentSales, prevSales),
      orders: calcChange(currentOrders, prevOrders),
      pending: calcChange(currentPending, prevPending),
      products: { text: "→ 0%", type: "neutral" },
    };
  }, [orders]);

  // Sales Chart Data (Real 7-day curve)
  const chartData = useMemo(() => {
    const daysCount = chartPeriod === "30d" ? 30 : 7;
    const now = new Date();
    const days: { dateStr: string; label: string; amount: number }[] = [];

    for (let i = daysCount - 1; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      const dateKey = `${yyyy}-${mm}-${dd}`;
      const label = d.toLocaleDateString("en-IN", { month: "short", day: "numeric" });
      days.push({ dateStr: dateKey, label, amount: 0 });
    }

    for (const o of orders) {
      if (o.status === "Cancelled") continue;
      const oDate = o.created_at.slice(0, 10);
      const match = days.find((day) => day.dateStr === oDate);
      if (match) {
        match.amount += Number(o.total) || 0;
      }
    }

    const maxVal = Math.max(...days.map((d) => d.amount), 3000);
    return { days, maxVal };
  }, [orders, chartPeriod]);

  // Top Products calculation from real sold items
  const topProducts = useMemo(() => {
    const soldCounts: Record<number, number> = {};
    for (const o of orders) {
      if (o.status === "Cancelled") continue;
      if (Array.isArray(o.items)) {
        for (const item of o.items) {
          soldCounts[item.id] = (soldCounts[item.id] || 0) + (Number(item.quantity) || 1);
        }
      }
    }

    return products
      .map((p) => ({
        ...p,
        soldCount: soldCounts[p.id] || 0,
      }))
      .sort((a, b) => b.soldCount - a.soldCount)
      .slice(0, 4);
  }, [products, orders]);

  // Recent Activity timeline generated from real events
  const recentActivity = useMemo(() => {
    const events: { id: string; text: string; time: string; timestamp: number; type: string }[] = [];

    for (const o of orders) {
      const t = new Date(o.created_at.replace(" ", "T") + "Z").getTime();
      let actText = `Order #VL-${o.id} received`;
      if (o.status === "Processing") actText = `Order #VL-${o.id} is being processed`;
      if (o.status === "Shipped") actText = `Order #VL-${o.id} shipped`;
      if (o.status === "Delivered") actText = `Order #VL-${o.id} completed`;
      if (o.status === "Cancelled") actText = `Order #VL-${o.id} cancelled`;

      events.push({
        id: `order-${o.id}-${o.status}`,
        text: actText,
        time: timeAgo(o.created_at),
        timestamp: t,
        type: o.status === "Shipped" ? "truck" : o.status === "Delivered" ? "check" : "bag",
      });
    }

    for (const p of products) {
      if (p.created_at) {
        const t = new Date(p.created_at.replace(" ", "T") + "Z").getTime();
        events.push({
          id: `product-${p.id}`,
          text: `Product "${p.name}" updated`,
          time: timeAgo(p.created_at),
          timestamp: t,
          type: "edit",
        });
      }
    }

    return events.sort((a, b) => b.timestamp - a.timestamp).slice(0, 5);
  }, [orders, products]);

  // Audience calculation: real customers from seller's orders
  const audienceList = useMemo(() => {
    const map = new Map<string, { name: string; email: string; ordersCount: number; totalSpent: number; lastOrder: string }>();

    for (const o of orders) {
      const key = o.email.toLowerCase().trim();
      if (!map.has(key)) {
        map.set(key, {
          name: o.customer_name,
          email: o.email,
          ordersCount: 1,
          totalSpent: o.status !== "Cancelled" ? Number(o.total) || 0 : 0,
          lastOrder: o.created_at,
        });
      } else {
        const curr = map.get(key)!;
        curr.ordersCount += 1;
        if (o.status !== "Cancelled") curr.totalSpent += Number(o.total) || 0;
        if (new Date(o.created_at) > new Date(curr.lastOrder)) curr.lastOrder = o.created_at;
      }
    }

    return Array.from(map.values()).sort((a, b) => b.totalSpent - a.totalSpent);
  }, [orders]);

  // Order status update action
  async function handleUpdateOrderStatus(orderId: number, newStatus: string) {
    if (!token) return;
    setUpdatingOrderId(orderId);
    setError("");
    try {
      const res = await fetch(`${API}/seller/orders/${orderId}/status`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ status: newStatus }),
      });
      await handleResponse(res);
      setOrders((prev) =>
        prev.map((o) => (o.id === orderId ? { ...o, status: newStatus as Order["status"] } : o))
      );
      setNotice(`Order #VL-${orderId} status updated to ${newStatus}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update order status.");
    } finally {
      setUpdatingOrderId(null);
    }
  }

  // Delivery Tracking update action
  async function handleSaveDelivery(e: FormEvent) {
    e.preventDefault();
    if (!token || !deliveryEditOrderId) return;
    setError("");
    try {
      const res = await fetch(`${API}/seller/orders/${deliveryEditOrderId}/delivery`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          tracking_number: deliveryTrackingNum.trim(),
          courier_name: deliveryCourier,
          status: "Shipped",
          dispatch_date: new Date().toISOString().slice(0, 10),
        }),
      });
      await handleResponse(res);
      setOrders((prev) =>
        prev.map((o) =>
          o.id === deliveryEditOrderId
            ? {
                ...o,
                tracking_number: deliveryTrackingNum.trim(),
                courier_name: deliveryCourier,
                status: "Shipped",
              }
            : o
        )
      );
      setNotice(`Dispatched order #VL-${deliveryEditOrderId} with tracking ${deliveryTrackingNum}.`);
      setDeliveryEditOrderId(null);
      setDeliveryTrackingNum("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save delivery info.");
    }
  }

  // Product Add / Edit / Delete
  function closeProductModal() {
    setShowProductModal(false);
    setProductForm(emptyProductForm);
    setUploadedImageUrl("");
    setDirectImageUrl("");
    setProductImagePreview("");
    setProductImageError("");
    if (productFileInputRef.current) {
      productFileInputRef.current.value = "";
    }
  }

  function openAddProduct() {
    setEditingProductId(null);
    setProductForm(emptyProductForm);
    setUploadedImageUrl("");
    setDirectImageUrl("");
    setProductImagePreview("");
    setProductImageError("");
    if (productFileInputRef.current) {
      productFileInputRef.current.value = "";
    }
    setShowProductModal(true);
  }

  function openEditProduct(p: Product) {
    setEditingProductId(p.id);
    const existingImg = (p.image_url || "").trim();
    setProductForm({
      name: p.name,
      description: p.description || "",
      price: String(p.price),
      stock: String(p.stock),
      image_url: existingImg,
      category: p.category || "General",
      is_active: Boolean(p.is_active),
    });
    if (existingImg.startsWith("/uploads/")) {
      setUploadedImageUrl(existingImg);
      setDirectImageUrl("");
    } else {
      setUploadedImageUrl("");
      setDirectImageUrl(existingImg);
    }
    setProductImagePreview("");
    setProductImageError("");
    if (productFileInputRef.current) {
      productFileInputRef.current.value = "";
    }
    setShowProductModal(true);
  }

  async function handleProductFileSelected(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !token) return;

    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!file.type.startsWith("image/") || !allowedTypes.includes(file.type)) {
      setProductImageError("Please choose a JPG, PNG, WEBP, or GIF image.");
      setError("Please choose a JPG, PNG, WEBP, or GIF image.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setProductImageError("Product image must be 5MB or smaller.");
      setError("Product image must be 5MB or smaller.");
      return;
    }

    const localPreview = URL.createObjectURL(file);
    setProductImagePreview(localPreview);
    setProductImageUploading(true);
    setProductImageError("");
    setError("");

    try {
      const formData = new FormData();
      formData.append("image", file);

      const uploadRes = await fetch(`${API}/products/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const uploadData = await handleResponse(uploadRes);
      const uploadedUrl = String(uploadData.image_url || uploadData.imageUrl || uploadData.url || "").trim();
      if (!uploadedUrl) {
        throw new Error("Upload succeeded but no image URL was returned.");
      }

      setUploadedImageUrl(uploadedUrl);
      setProductForm((prev) => ({ ...prev, image_url: uploadedUrl }));
      setProductImagePreview("");
      setNotice("Product image uploaded successfully.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to upload product image.";
      setProductImageError(msg);
      setError(msg);
    } finally {
      URL.revokeObjectURL(localPreview);
      setProductImageUploading(false);
    }
  }

  async function handleSaveProduct(e: FormEvent) {
    e.preventDefault();
    if (!token) return;

    if (productImageUploading) {
      setProductImageError("Please wait for the image upload to complete.");
      return;
    }

    const numPrice = Number(productForm.price);
    const numStock = Number(productForm.stock);
    if (!Number.isFinite(numPrice) || numPrice < 0) {
      setError("Please provide a valid price.");
      return;
    }
    if (!Number.isSafeInteger(numStock) || numStock < 0) {
      setError("Stock must be a whole non-negative number.");
      return;
    }

    const finalImageUrl = (
      uploadedImageUrl.trim() ||
      directImageUrl.trim() ||
      productForm.image_url.trim()
    );

    try {
      const payload = {
        name: productForm.name.trim(),
        description: productForm.description.trim(),
        price: numPrice,
        stock: numStock,
        image_url: finalImageUrl,
        category: productForm.category.trim() || "General",
        is_active: productForm.is_active ? 1 : 0,
      };

      const url = editingProductId ? `${API}/products/${editingProductId}` : `${API}/products`;
      const res = await fetch(url, {
        method: editingProductId ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      await handleResponse(res);
      await loadDashboardData(token);
      closeProductModal();
      setNotice(editingProductId ? "Product updated." : "Product added to your catalogue.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save product.");
    }
  }

  async function handleDeleteProduct(p: Product) {
    if (!token) return;
    if (!window.confirm(`Delete product "${p.name}"? This cannot be undone.`)) return;

    try {
      const res = await fetch(`${API}/products/${p.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      await handleResponse(res);
      setProducts((prev) => prev.filter((item) => item.id !== p.id));
      setNotice(`Product "${p.name}" deleted.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete product.");
    }
  }

  // Discount Actions
  async function handleCreateDiscount(e: FormEvent) {
    e.preventDefault();
    if (!token) return;

    try {
      const res = await fetch(`${API}/seller/discounts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          code: discountCode.trim().toUpperCase(),
          type: discountType,
          value: Number(discountValue),
          min_order_amount: Number(discountMinOrder) || 0,
          is_active: 1,
        }),
      });
      const data = await handleResponse(res);
      setDiscounts((prev) => [data.discount, ...prev]);
      setShowDiscountModal(false);
      setDiscountCode("");
      setDiscountValue("");
      setDiscountMinOrder("");
      setNotice(`Discount coupon "${data.discount.code}" created.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create discount.");
    }
  }

  async function handleToggleDiscount(d: Discount) {
    if (!token) return;
    const newActive = d.is_active ? 0 : 1;
    try {
      await fetch(`${API}/seller/discounts/${d.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ is_active: newActive }),
      });
      setDiscounts((prev) =>
        prev.map((item) => (item.id === d.id ? { ...item, is_active: newActive } : item))
      );
      setNotice(`Coupon "${d.code}" ${newActive ? "activated" : "deactivated"}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update discount.");
    }
  }

  async function handleDeleteDiscount(d: Discount) {
    if (!token) return;
    if (!window.confirm(`Delete coupon "${d.code}"?`)) return;
    try {
      await fetch(`${API}/seller/discounts/${d.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      setDiscounts((prev) => prev.filter((item) => item.id !== d.id));
      setNotice(`Coupon "${d.code}" deleted.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete discount.");
    }
  }

  async function persistAppearance(nextLogoUrl: string) {
    const res = await fetch(`${API}/seller/store`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        name: appearanceName.trim(),
        description: appearanceDesc.trim(),
        announcement: appearanceAnnouncement.trim(),
        theme_color: appearanceThemeColor,
        logo_url: nextLogoUrl.trim(),
        banner_url: appearanceBannerUrl.trim(),
      }),
    });
    const data = await handleResponse(res);
    setStore(data.store);
    if (data.store?.logo_url !== undefined) {
      setAppearanceLogoUrl(data.store.logo_url);
    }
    if (data.store?.theme_color) {
      setAppearanceThemeColor(data.store.theme_color);
    }
    return data;
  }

  async function handleLogoFileSelected(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !token) return;

    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!file.type.startsWith("image/") || !allowedTypes.includes(file.type)) {
      setError("Please choose a JPG, PNG, WEBP, or GIF image.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setError("Logo must be 2MB or smaller.");
      return;
    }

    const localPreview = URL.createObjectURL(file);
    setAppearanceLogoPreview(localPreview);
    setAppearanceLogoUploading(true);
    setError("");

    try {
      const formData = new FormData();
      formData.append("logo", file);

      const uploadRes = await fetch(`${API}/seller/store/logo`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const uploadData = await handleResponse(uploadRes);
      const uploadedUrl = String(uploadData.logo_url || "").trim();
      if (!uploadedUrl) {
        throw new Error("Upload succeeded but no logo URL was returned.");
      }

      setAppearanceLogoUrl(uploadedUrl);
      await persistAppearance(uploadedUrl);
      setAppearanceLogoPreview("");
      setNotice("Store logo uploaded and saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload logo.");
    } finally {
      URL.revokeObjectURL(localPreview);
      setAppearanceLogoUploading(false);
    }
  }

  // Appearance Save
  async function handleSaveAppearance(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setAppearanceSaving(true);
    try {
      await persistAppearance(appearanceLogoUrl);
      setNotice("Storefront appearance saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save appearance.");
    } finally {
      setAppearanceSaving(false);
    }
  }

  // Payout Save
  async function handleSavePayout(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setPayoutSaving(true);
    try {
      const res = await fetch(`${API}/seller/store`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          bank_account_holder: payoutHolder.trim(),
          bank_name: payoutBank.trim(),
          bank_account_number: payoutAccount.trim(),
          bank_ifsc: payoutIfsc.trim().toUpperCase(),
        }),
      });
      const data = await handleResponse(res);
      setStore(data.store);
      setNotice("Bank payout details saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save payout settings.");
    } finally {
      setPayoutSaving(false);
    }
  }

  // Submit Payout Request
  async function handleRequestPayout(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setPayoutReqLoading(true);
    setPayoutReqError("");
    setPayoutReqNotice("");
    try {
      const numAmount = Number(payoutReqAmount);
      if (!Number.isFinite(numAmount) || numAmount <= 0) {
        throw new Error("Please enter a valid payout amount.");
      }
      const res = await fetch(`${API}/seller/payouts/request`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ amount: numAmount })
      });
      const data = await res.json();
      if (!res.ok || data.status !== "success") {
        throw new Error(data.message || "Failed to submit payout request.");
      }
      setPayoutReqNotice(data.message);
      setPayoutReqAmount("");
      if (data.financials) {
        setSellerFinancials(data.financials);
      }
      // Reload payouts and transactions
      const pRes = await fetch(`${API}/seller/payouts`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (pRes.ok) {
        const pData = await pRes.json();
        setSellerPayouts(pData.payouts || []);
      }
      const txRes = await fetch(`${API}/seller/financials/transactions`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (txRes.ok) {
        const txData = await txRes.json();
        setSellerTransactions(txData.transactions || []);
      }
    } catch (err) {
      setPayoutReqError(err instanceof Error ? err.message : "Payout request failed.");
    } finally {
      setPayoutReqLoading(false);
    }
  }

  // Password Change
  async function handleChangePassword(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setPasswordSaving(true);
    try {
      const res = await fetch(`${API}/seller/password`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      await handleResponse(res);
      setNotice("Account password updated successfully.");
      setCurrentPassword("");
      setNewPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update password.");
    } finally {
      setPasswordSaving(false);
    }
  }

  // Plugin Save
  async function handleSavePluginConfig(e: FormEvent) {
    e.preventDefault();
    if (!token || !pluginConfigModal) return;
    try {
      await fetch(`${API}/seller/plugins/${pluginConfigModal}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          is_enabled: 1,
          config: pluginConfigInput,
        }),
      });
      setPlugins((prev) => ({
        ...prev,
        [pluginConfigModal]: { is_enabled: true, config: pluginConfigInput },
      }));
      setNotice(`Integration for ${pluginConfigModal} configured.`);
      setPluginConfigModal(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save plugin configuration.");
    }
  }

  // Login view if not authenticated
  if (!token) {
    return (
      <main className="velora-sd-login-page">
        <a href="/" className="velora-sd-login-back">
          ← Return to VELORA Storefront
        </a>
        <section className="velora-sd-login-card">
          <div className="velora-sd-login-brand">VELORA</div>
          <h1 className="velora-sd-login-title">Atelier Seller Portal</h1>
          <p className="velora-sd-login-subtitle">Sign in to manage your store, inventory, and orders.</p>

          {error && <div className="velora-sd-alert error">{error}</div>}
          {notice && <div className="velora-sd-alert success">{notice}</div>}

          <form onSubmit={handleLogin} style={{ display: "grid", gap: "16px" }}>
            <div className="velora-sd-form-group">
              <label className="velora-sd-form-label" style={{ color: "#fff" }}>
                Email Address
              </label>
              <input
                type="email"
                required
                className="velora-sd-form-input"
                style={{ background: "#212228", color: "#fff", borderColor: "#33353d" }}
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                placeholder="seller@atelier.com"
              />
            </div>

            <div className="velora-sd-form-group">
              <label className="velora-sd-form-label" style={{ color: "#fff" }}>
                Password
              </label>
              <PasswordInput
                variant="seller"
                required
                className="velora-sd-form-input"
                style={{ background: "#212228", color: "#fff", borderColor: "#33353d" }}
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              disabled={loginSaving}
              className="velora-sd-btn-primary"
              style={{
                width: "100%",
                justifyContent: "center",
                background: "#d4af37",
                color: "#000",
                borderColor: "#d4af37",
                marginTop: "8px",
              }}
            >
              {loginSaving ? "Signing in..." : "Enter Atelier Dashboard →"}
            </button>
          </form>

          <p style={{ fontSize: "12px", color: "#8b949e", textAlign: "center", marginTop: "24px" }}>
            Don't have a seller store yet?{" "}
            <a href="/?register=seller" style={{ color: "#d4af37", textDecoration: "underline" }}>
              Register Atelier
            </a>
          </p>
        </section>
      </main>
    );
  }

  const publicStoreUrl = store ? `/${store.slug}` : "/";

  return (
    <div className="velora-sd-app">
      {/* Mobile Sidebar Backdrop */}
      {mobileNavOpen && (
        <div className="velora-sd-mobile-backdrop" onClick={() => setMobileNavOpen(false)} />
      )}

      {/* ==================== 1. SIDEBAR ==================== */}
      <aside className={`velora-sd-sidebar ${mobileNavOpen ? "mobile-open" : ""}`}>
        <div className="velora-sd-sidebar-header">
          {/* VELORA Gold serif branding */}
          <a href="/" className="velora-sd-logo-brand">
            VELORA
          </a>

          {/* Seller Store Identity & Public URL */}
          <div className="velora-sd-store-identity">
            <div className="velora-sd-store-avatar">
              {store?.logo_url ? (
                <img src={store.logo_url} alt="" />
              ) : (
                <span>{(store?.name || "V").charAt(0).toUpperCase()}</span>
              )}
            </div>
            <div className="velora-sd-store-meta">
              <div className="velora-sd-store-name" title={store?.name || "Your Store"}>
                {store?.name || "My Atelier"}
              </div>
              <a
                href={publicStoreUrl}
                className="velora-sd-store-url-link"
                title={`Open /${store?.slug || ""}`}
              >
                <span>Store URL: {store?.slug || "store"}</span>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                  <polyline points="15 3 21 3 21 9"></polyline>
                  <line x1="10" y1="14" x2="21" y2="3"></line>
                </svg>
              </a>
            </div>
          </div>
        </div>

        {/* EXACT SIDEBAR ORDER (1 to 11) */}
        <nav className="velora-sd-nav-container">
          {/* 1. Dashboard */}
          <button
            type="button"
            className={`velora-sd-nav-item ${activeTab === "dashboard" ? "active" : ""}`}
            onClick={() => {
              setActiveTab("dashboard");
              setMobileNavOpen(false);
            }}
          >
            <div className="velora-sd-nav-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
                <polyline points="9 22 9 12 15 12 15 22"></polyline>
              </svg>
            </div>
            <span className="velora-sd-nav-label">Dashboard</span>
          </button>

          {/* 2. Orders */}
          <button
            type="button"
            className={`velora-sd-nav-item ${activeTab === "orders" ? "active" : ""}`}
            onClick={() => {
              setActiveTab("orders");
              setMobileNavOpen(false);
            }}
          >
            <div className="velora-sd-nav-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
                <line x1="16" y1="13" x2="8" y2="13"></line>
                <line x1="16" y1="17" x2="8" y2="17"></line>
                <polyline points="10 9 9 9 8 9"></polyline>
              </svg>
            </div>
            <span className="velora-sd-nav-label">Orders</span>
            {pendingOrdersCount > 0 && <span className="velora-sd-nav-badge">{pendingOrdersCount}</span>}
          </button>

          {/* 3. Delivery */}
          <button
            type="button"
            className={`velora-sd-nav-item ${activeTab === "delivery" ? "active" : ""}`}
            onClick={() => {
              setActiveTab("delivery");
              setMobileNavOpen(false);
            }}
          >
            <div className="velora-sd-nav-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="1" y="3" width="15" height="13"></rect>
                <polygon points="16 8 20 8 23 11 23 16 16 16 16 8"></polygon>
                <circle cx="5.5" cy="18.5" r="2.5"></circle>
                <circle cx="18.5" cy="18.5" r="2.5"></circle>
              </svg>
            </div>
            <span className="velora-sd-nav-label">Delivery</span>
          </button>

          {/* 4. Products */}
          <button
            type="button"
            className={`velora-sd-nav-item ${activeTab === "products" ? "active" : ""}`}
            onClick={() => {
              setActiveTab("products");
              setMobileNavOpen(false);
            }}
          >
            <div className="velora-sd-nav-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="7" height="7"></rect>
                <rect x="14" y="3" width="7" height="7"></rect>
                <rect x="14" y="14" width="7" height="7"></rect>
                <rect x="3" y="14" width="7" height="7"></rect>
              </svg>
            </div>
            <span className="velora-sd-nav-label">Products</span>
            {products.length > 0 && <span className="velora-sd-nav-badge">{products.length}</span>}
          </button>

          {/* 5. Analytics */}
          <button
            type="button"
            className={`velora-sd-nav-item ${activeTab === "analytics" ? "active" : ""}`}
            onClick={() => {
              setActiveTab("analytics");
              setMobileNavOpen(false);
            }}
          >
            <div className="velora-sd-nav-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="20" x2="18" y2="10"></line>
                <line x1="12" y1="20" x2="12" y2="4"></line>
                <line x1="6" y1="20" x2="6" y2="14"></line>
              </svg>
            </div>
            <span className="velora-sd-nav-label">Analytics</span>
          </button>

          {/* 6. Payouts */}
          <button
            type="button"
            className={`velora-sd-nav-item ${activeTab === "payouts" ? "active" : ""}`}
            onClick={() => {
              setActiveTab("payouts");
              setMobileNavOpen(false);
            }}
          >
            <div className="velora-sd-nav-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect>
                <line x1="1" y1="10" x2="23" y2="10"></line>
              </svg>
            </div>
            <span className="velora-sd-nav-label">Payouts</span>
          </button>

          {/* 7. Discounts */}
          <button
            type="button"
            className={`velora-sd-nav-item ${activeTab === "discounts" ? "active" : ""}`}
            onClick={() => {
              setActiveTab("discounts");
              setMobileNavOpen(false);
            }}
          >
            <div className="velora-sd-nav-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="9" y1="15" x2="15" y2="9"></line>
                <circle cx="9.5" cy="9.5" r=".5" fill="currentColor"></circle>
                <circle cx="14.5" cy="14.5" r=".5" fill="currentColor"></circle>
              </svg>
            </div>
            <span className="velora-sd-nav-label">Discounts</span>
          </button>

          {/* 8. Audience */}
          <button
            type="button"
            className={`velora-sd-nav-item ${activeTab === "audience" ? "active" : ""}`}
            onClick={() => {
              setActiveTab("audience");
              setMobileNavOpen(false);
            }}
          >
            <div className="velora-sd-nav-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                <circle cx="9" cy="7" r="4"></circle>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
              </svg>
            </div>
            <span className="velora-sd-nav-label">Audience</span>
          </button>

          {/* 9. Appearance */}
          <button
            type="button"
            className={`velora-sd-nav-item ${activeTab === "appearance" ? "active" : ""}`}
            onClick={() => {
              setActiveTab("appearance");
              setMobileNavOpen(false);
            }}
          >
            <div className="velora-sd-nav-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="13.5" cy="6.5" r=".5" fill="currentColor"></circle>
                <circle cx="17.5" cy="10.5" r=".5" fill="currentColor"></circle>
                <circle cx="8.5" cy="7.5" r=".5" fill="currentColor"></circle>
                <circle cx="6.5" cy="12.5" r=".5" fill="currentColor"></circle>
                <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.563-2.512 5.563-5.563C22 6.5 17.5 2 12 2z"></path>
              </svg>
            </div>
            <span className="velora-sd-nav-label">Appearance</span>
          </button>

          {/* 10. Plugins */}
          <button
            type="button"
            className={`velora-sd-nav-item ${activeTab === "plugins" ? "active" : ""}`}
            onClick={() => {
              setActiveTab("plugins");
              setMobileNavOpen(false);
            }}
          >
            <div className="velora-sd-nav-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
              </svg>
            </div>
            <span className="velora-sd-nav-label">Plugins</span>
          </button>

          {/* 11. Settings */}
          <button
            type="button"
            className={`velora-sd-nav-item ${activeTab === "settings" ? "active" : ""}`}
            onClick={() => {
              setActiveTab("settings");
              setMobileNavOpen(false);
            }}
          >
            <div className="velora-sd-nav-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="3"></circle>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
              </svg>
            </div>
            <span className="velora-sd-nav-label">Settings</span>
          </button>
        </nav>

        {/* Sidebar Footer: Upgrade Plan & Honest Store Plan */}
        <div className="velora-sd-sidebar-footer">
          <button
            type="button"
            className="velora-sd-upgrade-card"
            onClick={() => setShowUpgradeModal(true)}
          >
            <div className="velora-sd-upgrade-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="6 3 18 3 22 9 12 22 2 9"></polygon>
              </svg>
            </div>
            <div>
              <div className="velora-sd-upgrade-title">Upgrade Plan</div>
              <div className="velora-sd-upgrade-sub">Get extra benefits</div>
            </div>
          </button>
        </div>
      </aside>

      {/* ==================== 2. MAIN WORKSPACE ==================== */}
      <div className="velora-sd-workspace">
        {/* Top Header */}
        <header className="velora-sd-topbar">
          <div className="velora-sd-topbar-left">
            <button
              type="button"
              className="velora-sd-mobile-toggle"
              onClick={() => setMobileNavOpen((v) => !v)}
              aria-label="Toggle navigation"
            >
              ☰
            </button>
            <div className="velora-sd-search-box">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
              <input
                type="text"
                placeholder="Search anything..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          <div className="velora-sd-topbar-right">
            {/* Notification Bell */}
            <button
              type="button"
              className="velora-sd-notif-btn"
              onClick={() => setNotifDropdownOpen((v) => !v)}
              title="Notifications"
            >
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
                <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
              </svg>
              {pendingOrdersCount > 0 && <span className="velora-sd-notif-badge" />}
            </button>

            {/* Notifications Dropdown */}
            {notifDropdownOpen && (
              <div className="velora-sd-dropdown-menu" style={{ width: "280px" }}>
                <div style={{ padding: "10px 16px", fontWeight: "600", fontSize: "13px", borderBottom: "1px solid #f0f0f0" }}>
                  Store Notifications
                </div>
                {pendingOrdersCount > 0 ? (
                  <div style={{ padding: "12px 16px", fontSize: "12.5px", color: "#374151" }}>
                    🔔 You have <strong>{pendingOrdersCount} pending order(s)</strong> awaiting fulfillment.
                  </div>
                ) : (
                  <div style={{ padding: "16px", fontSize: "12.5px", color: "#6b7280", textAlign: "center" }}>
                    No new alerts. Your store is running smoothly.
                  </div>
                )}
              </div>
            )}

            {/* Seller Profile Chip */}
            <button
              type="button"
              className="velora-sd-profile-chip"
              onClick={() => setProfileDropdownOpen((v) => !v)}
            >
              <div className="velora-sd-avatar-circle">
                {(seller?.name || "K").charAt(0).toUpperCase()}
              </div>
              <div className="velora-sd-profile-text">
                <div className="velora-sd-profile-name">{seller?.name || "Seller"}</div>
                <div className="velora-sd-profile-role">Seller</div>
              </div>
              <svg className="velora-sd-profile-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
            </button>

            {/* Profile Dropdown */}
            {profileDropdownOpen && (
              <div className="velora-sd-dropdown-menu">
                <div style={{ padding: "8px 16px", borderBottom: "1px solid #f0f0f0", marginBottom: "4px" }}>
                  <div style={{ fontWeight: "600", fontSize: "13px", color: "#111" }}>{seller?.name}</div>
                  <div style={{ fontSize: "11px", color: "#666" }}>{seller?.email}</div>
                </div>
                <a
                  href={publicStoreUrl}
                  className="velora-sd-dropdown-item"
                >
                  ↗ View Public Store
                </a>
                <button
                  type="button"
                  className="velora-sd-dropdown-item"
                  onClick={() => {
                    setActiveTab("settings");
                    setProfileDropdownOpen(false);
                  }}
                >
                  ⚙ Account Settings
                </button>
                <div className="velora-sd-dropdown-divider" />
                <button type="button" className="velora-sd-dropdown-item danger" onClick={logout}>
                  ↪ Sign Out
                </button>
              </div>
            )}
          </div>
        </header>

        {/* Content Body */}
        <main className="velora-sd-content">
          {loading && (
            <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", color: "#8b949e", marginBottom: "16px" }}>
              <div style={{ width: "14px", height: "14px", border: "2px solid #d4af37", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
              <span>Syncing atelier data...</span>
            </div>
          )}
          {error && <div className="velora-sd-alert error">{error}</div>}
          {notice && <div className="velora-sd-alert success">{notice}</div>}

          {/* ======================================================== */}
          {/* TAB 1: DASHBOARD (EXACT VISUAL REFERENCE MATCH)          */}
          {/* ======================================================== */}
          {activeTab === "dashboard" && (
            <>
              {/* Welcome Heading & View Your Store Action */}
              <div className="velora-sd-welcome-bar">
                <div>
                  <h1 className="velora-sd-welcome-title">
                    Welcome back, {sellerFirstName}! 👋
                  </h1>
                  <p className="velora-sd-welcome-sub">Here's what's happening with your store today.</p>
                </div>
                <a
                  href={publicStoreUrl}
                  className="velora-sd-view-store-btn"
                >
                  <span>View Your Store</span>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                    <polyline points="15 3 21 3 21 9"></polyline>
                    <line x1="10" y1="14" x2="21" y2="3"></line>
                  </svg>
                </a>
              </div>

              {/* 4 Overview Cards */}
              <div className="velora-sd-overview-grid">
                {/* 1. Total Sales */}
                <div className="velora-sd-metric-card">
                  <div className="velora-sd-metric-icon-wrap">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path>
                      <line x1="3" y1="6" x2="21" y2="6"></line>
                      <path d="M16 10a4 4 0 0 1-8 0"></path>
                    </svg>
                  </div>
                  <div className="velora-sd-metric-body">
                    <p className="velora-sd-metric-label">Total Sales</p>
                    <div className="velora-sd-metric-val">{formatMoney(totalSales)}</div>
                    <div className={`velora-sd-metric-trend ${trends.sales.type}`}>
                      <span>{trends.sales.text}</span>
                      <span style={{ color: "#9ca3af", marginLeft: "4px" }}>vs last 7 days</span>
                    </div>
                  </div>
                </div>

                {/* 2. Total Orders */}
                <div className="velora-sd-metric-card">
                  <div className="velora-sd-metric-icon-wrap">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
                      <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
                    </svg>
                  </div>
                  <div className="velora-sd-metric-body">
                    <p className="velora-sd-metric-label">Total Orders</p>
                    <div className="velora-sd-metric-val">{totalOrdersCount}</div>
                    <div className={`velora-sd-metric-trend ${trends.orders.type}`}>
                      <span>{trends.orders.text}</span>
                      <span style={{ color: "#9ca3af", marginLeft: "4px" }}>vs last 7 days</span>
                    </div>
                  </div>
                </div>

                {/* 3. Pending Orders */}
                <div className="velora-sd-metric-card">
                  <div className="velora-sd-metric-icon-wrap">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10"></circle>
                      <polyline points="12 6 12 12 16 14"></polyline>
                    </svg>
                  </div>
                  <div className="velora-sd-metric-body">
                    <p className="velora-sd-metric-label">Pending Orders</p>
                    <div className="velora-sd-metric-val">{pendingOrdersCount}</div>
                    <div className={`velora-sd-metric-trend ${trends.pending.type}`}>
                      <span>{trends.pending.text}</span>
                      <span style={{ color: "#9ca3af", marginLeft: "4px" }}>vs last 7 days</span>
                    </div>
                  </div>
                </div>

                {/* 4. Total Products */}
                <div className="velora-sd-metric-card">
                  <div className="velora-sd-metric-icon-wrap">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                      <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
                      <line x1="12" y1="22.08" x2="12" y2="12"></line>
                    </svg>
                  </div>
                  <div className="velora-sd-metric-body">
                    <p className="velora-sd-metric-label">Total Products</p>
                    <div className="velora-sd-metric-val">{totalProductsCount}</div>
                    <div className="velora-sd-metric-trend neutral">
                      <span>{trends.products.text}</span>
                      <span style={{ color: "#9ca3af", marginLeft: "4px" }}>vs last 7 days</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Middle Row: Sales Overview Chart & Recent Orders */}
              <div className="velora-sd-middle-grid">
                {/* Sales Overview Chart */}
                <div className="velora-sd-card">
                  <div className="velora-sd-card-header">
                    <h2 className="velora-sd-card-title">Sales Overview</h2>
                    <select
                      className="velora-sd-select-pill"
                      value={chartPeriod}
                      onChange={(e) => setChartPeriod(e.target.value as "7d" | "30d" | "all")}
                    >
                      <option value="7d">Last 7 days</option>
                      <option value="30d">Last 30 days</option>
                    </select>
                  </div>

                  <div className="velora-sd-chart-wrap">
                    <svg className="velora-sd-chart-svg" viewBox="0 0 600 220" preserveAspectRatio="none">
                      <defs>
                        <linearGradient id="goldGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.25" />
                          <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.0" />
                        </linearGradient>
                      </defs>

                      {/* Grid lines */}
                      <g className="velora-sd-chart-grid">
                        <line x1="50" y1="25" x2="585" y2="25" />
                        <line x1="50" y1="75" x2="585" y2="75" />
                        <line x1="50" y1="125" x2="585" y2="125" />
                        <line x1="50" y1="175" x2="585" y2="175" />
                      </g>

                      {/* Y-axis text */}
                      <text x="40" y="30" textAnchor="end" className="velora-sd-chart-axis-text">
                        ₹{(chartData.maxVal).toLocaleString("en-IN")}
                      </text>
                      <text x="40" y="80" textAnchor="end" className="velora-sd-chart-axis-text">
                        ₹{Math.round(chartData.maxVal * 0.66).toLocaleString("en-IN")}
                      </text>
                      <text x="40" y="130" textAnchor="end" className="velora-sd-chart-axis-text">
                        ₹{Math.round(chartData.maxVal * 0.33).toLocaleString("en-IN")}
                      </text>
                      <text x="40" y="180" textAnchor="end" className="velora-sd-chart-axis-text">
                        ₹0
                      </text>

                      {/* Path computation */}
                      {(() => {
                        const pts = chartData.days.map((d, i) => {
                          const x = 55 + (i / (chartData.days.length - 1)) * 525;
                          const ratio = chartData.maxVal > 0 ? d.amount / chartData.maxVal : 0;
                          const y = 175 - ratio * 150;
                          return { x, y, amount: d.amount, label: d.label };
                        });

                        const pathStr = pts.reduce((acc, pt, i) => {
                          if (i === 0) return `M ${pt.x} ${pt.y}`;
                          const prev = pts[i - 1];
                          const cX1 = prev.x + (pt.x - prev.x) / 2;
                          const cY1 = prev.y;
                          const cX2 = prev.x + (pt.x - prev.x) / 2;
                          const cY2 = pt.y;
                          return `${acc} C ${cX1} ${cY1}, ${cX2} ${cY2}, ${pt.x} ${pt.y}`;
                        }, "");

                        const areaStr = `${pathStr} L ${pts[pts.length - 1].x} 175 L ${pts[0].x} 175 Z`;

                        return (
                          <>
                            <path d={areaStr} fill="url(#goldGradient)" />
                            <path d={pathStr} className="velora-sd-chart-line" />
                            {pts.map((pt, i) => (
                              <g key={i}>
                                <circle cx={pt.x} cy={pt.y} r="4" className="velora-sd-chart-dot">
                                  <title>{`${pt.label}: ₹${pt.amount.toLocaleString("en-IN")}`}</title>
                                </circle>
                                <text x={pt.x} y="205" textAnchor="middle" className="velora-sd-chart-axis-text">
                                  {pt.label}
                                </text>
                              </g>
                            ))}
                          </>
                        );
                      })()}
                    </svg>
                  </div>
                </div>

                {/* Recent Orders Panel */}
                <div className="velora-sd-card">
                  <div className="velora-sd-card-header">
                    <h2 className="velora-sd-card-title">Recent Orders</h2>
                    <button
                      type="button"
                      className="velora-sd-card-action"
                      onClick={() => setActiveTab("orders")}
                    >
                      View all
                    </button>
                  </div>

                  {orders.length === 0 ? (
                    <div className="velora-sd-empty-state" style={{ padding: "30px 10px" }}>
                      <div className="velora-sd-empty-icon">📦</div>
                      <div className="velora-sd-empty-title">No orders yet</div>
                      <div className="velora-sd-empty-desc">
                        Customer orders placed on your public boutique will appear here.
                      </div>
                    </div>
                  ) : (
                    <div className="velora-sd-order-list">
                      {orders.slice(0, 4).map((order) => {
                        const firstItemName = order.items?.[0]?.name || "VELORA Product";
                        const thumb = getProductThumbnail(firstItemName);
                        const statusClass = order.status.toLowerCase();

                        return (
                          <div key={order.id} className="velora-sd-order-item">
                            <div className="velora-sd-order-item-left">
                              <div className="velora-sd-order-thumb">
                                <img src={thumb} alt="" />
                              </div>
                              <div className="velora-sd-order-info">
                                <div className="velora-sd-order-id">#VL-{order.id}</div>
                                <div className="velora-sd-order-customer" title={order.customer_name}>
                                  {order.customer_name}
                                </div>
                              </div>
                            </div>

                            <div className="velora-sd-order-item-right">
                              <div className="velora-sd-order-amount">{formatMoney(order.total)}</div>
                              <span className={`velora-sd-status-badge ${statusClass}`}>
                                {order.status}
                              </span>
                              <span className="velora-sd-time-ago">{timeAgo(order.created_at)}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Bottom Row: Top Products, Recent Activity & Promotional Card */}
              <div className="velora-sd-bottom-grid">
                {/* 1. Top Products */}
                <div className="velora-sd-card">
                  <div className="velora-sd-card-header">
                    <h2 className="velora-sd-card-title">Top Products</h2>
                    <button
                      type="button"
                      className="velora-sd-card-action"
                      onClick={() => setActiveTab("products")}
                    >
                      View all
                    </button>
                  </div>

                  {products.length === 0 ? (
                    <div className="velora-sd-empty-state" style={{ padding: "30px 10px" }}>
                      <div className="velora-sd-empty-icon">◇</div>
                      <div className="velora-sd-empty-title">Catalogue empty</div>
                      <div className="velora-sd-empty-desc">Add products to see performance here.</div>
                    </div>
                  ) : (
                    <div className="velora-sd-product-list">
                      {topProducts.map((p) => {
                        const thumb = getProductThumbnail(p.name, p.image_url);
                        const originalPrice = Math.round(p.price * 1.5);
                        return (
                          <div key={p.id} className="velora-sd-product-item">
                            <div className="velora-sd-product-thumb">
                              <img src={thumb} alt="" />
                            </div>
                            <div className="velora-sd-product-meta">
                              <div className="velora-sd-product-title" title={p.name}>
                                {p.name}
                              </div>
                              <div className="velora-sd-product-prices">
                                <span className="velora-sd-product-price">{formatMoney(p.price)}</span>
                                <span className="velora-sd-product-oldprice">{formatMoney(originalPrice)}</span>
                                <span className="velora-sd-product-discount">(33% off)</span>
                              </div>
                            </div>
                            <div className="velora-sd-product-sold">
                              {p.soldCount} sold
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* 2. Recent Activity */}
                <div className="velora-sd-card">
                  <div className="velora-sd-card-header">
                    <h2 className="velora-sd-card-title">Recent Activity</h2>
                  </div>

                  {recentActivity.length === 0 ? (
                    <div className="velora-sd-empty-state" style={{ padding: "30px 10px" }}>
                      <div className="velora-sd-empty-icon">⏳</div>
                      <div className="velora-sd-empty-title">No recent activity</div>
                      <div className="velora-sd-empty-desc">Recent order updates and inventory actions will show here.</div>
                    </div>
                  ) : (
                    <div className="velora-sd-activity-list">
                      {recentActivity.map((act) => (
                        <div key={act.id} className="velora-sd-activity-item">
                          <div className="velora-sd-activity-icon">
                            {act.type === "truck" && (
                              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <rect x="1" y="3" width="15" height="13"></rect>
                                <polygon points="16 8 20 8 23 11 23 16 16 16 16 8"></polygon>
                              </svg>
                            )}
                            {act.type === "check" && (
                              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <polyline points="20 6 9 17 4 12"></polyline>
                              </svg>
                            )}
                            {act.type === "edit" && (
                              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                              </svg>
                            )}
                            {act.type === "bag" && (
                              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path>
                                <line x1="3" y1="6" x2="21" y2="6"></line>
                              </svg>
                            )}
                          </div>
                          <div className="velora-sd-activity-content">
                            <div className="velora-sd-activity-title">{act.text}</div>
                            <div className="velora-sd-activity-time">{act.time}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* 3. Customize Your Store Promotional Card */}
                <div className="velora-sd-promo-card">
                  <div>
                    <div className="velora-sd-promo-brand">VELORA</div>
                    <h3 className="velora-sd-promo-heading">Customize Your Store</h3>
                    <p className="velora-sd-promo-desc">
                      Make your store unique with custom branding, logo, banner and more.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="velora-sd-promo-btn"
                    onClick={() => setActiveTab("appearance")}
                  >
                    <span>Go to Appearance</span>
                    <span>→</span>
                  </button>
                </div>
              </div>
            </>
          )}

          {/* ======================================================== */}
          {/* TAB 2: ORDERS MANAGEMENT                                 */}
          {/* ======================================================== */}
          {activeTab === "orders" && (
            <section>
              <div className="velora-sd-section-header">
                <div className="velora-sd-section-title-wrap">
                  <h1>Store Orders</h1>
                  <p>Real-time customer orders placed through your public boutique.</p>
                </div>
                <button
                  type="button"
                  className="velora-sd-btn-secondary"
                  onClick={() => loadDashboardData(token)}
                >
                  ↻ Refresh Orders
                </button>
              </div>

              {orders.length === 0 ? (
                <div className="velora-sd-card">
                  <div className="velora-sd-empty-state">
                    <div className="velora-sd-empty-icon">📦</div>
                    <div className="velora-sd-empty-title">No orders placed yet</div>
                    <div className="velora-sd-empty-desc">
                      Share your store link <strong>{store?.slug ? `/${store.slug}` : ""}</strong> with your customers.
                    </div>
                  </div>
                </div>
              ) : (
                <div className="velora-sd-table-wrap">
                  <table className="velora-sd-table">
                    <thead>
                      <tr>
                        <th>Order ID</th>
                        <th>Customer</th>
                        <th>Items Ordered</th>
                        <th>Total Amount</th>
                        <th>Date</th>
                        <th>Status</th>
                        <th>Update Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orders
                        .filter((o) =>
                          `${o.customer_name} ${o.email} ${o.id}`
                            .toLowerCase()
                            .includes(searchQuery.toLowerCase())
                        )
                        .map((order) => (
                          <tr key={order.id}>
                            <td>
                              <strong>#VL-{order.id}</strong>
                            </td>
                            <td>
                              <div>
                                <strong>{order.customer_name}</strong>
                                <div style={{ fontSize: "12px", color: "#6b7280" }}>{order.email}</div>
                              </div>
                            </td>
                            <td>
                              <div style={{ fontSize: "13px" }}>
                                {Array.isArray(order.items) &&
                                  order.items.map((it, idx) => (
                                    <div key={idx} style={{ marginBottom: "2px" }}>
                                      • {it.name} <span style={{ color: "#888" }}>×{it.quantity}</span> ({formatMoney(it.price)})
                                    </div>
                                  ))}
                              </div>
                            </td>
                            <td>
                              <strong style={{ fontSize: "14px" }}>{formatMoney(order.total)}</strong>
                            </td>
                            <td>
                              <span style={{ color: "#6b7280" }}>{timeAgo(order.created_at)}</span>
                            </td>
                            <td>
                              <span className={`velora-sd-status-badge ${order.status.toLowerCase()}`}>
                                {order.status}
                              </span>
                              {order.payment_status && (
                                <span
                                  className={`velora-sd-status-badge ${order.payment_status.toLowerCase() === "paid" ? "delivered" : "cancelled"}`}
                                  style={{ marginLeft: "4px", fontSize: "10.5px" }}
                                >
                                  {order.payment_status}
                                </span>
                              )}
                            </td>
                            <td>
                              <select
                                className="velora-sd-select-pill"
                                value={order.status}
                                disabled={updatingOrderId === order.id}
                                onChange={(e) => handleUpdateOrderStatus(order.id, e.target.value)}
                              >
                                <option value="Pending">Pending</option>
                                <option value="Processing">Processing</option>
                                <option value="Shipped">Shipped</option>
                                <option value="Delivered">Delivered</option>
                                <option value="Cancelled">Cancelled</option>
                              </select>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {/* ======================================================== */}
          {/* TAB 3: DELIVERY & FULFILLMENT                            */}
          {/* ======================================================== */}
          {activeTab === "delivery" && (
            <section>
              <div className="velora-sd-section-header">
                <div className="velora-sd-section-title-wrap">
                  <h1>Fulfillment & Delivery</h1>
                  <p>Assign courier tracking numbers and log dispatch dates for customer orders.</p>
                </div>
              </div>

              {orders.length === 0 ? (
                <div className="velora-sd-card">
                  <div className="velora-sd-empty-state">
                    <div className="velora-sd-empty-icon">🚚</div>
                    <div className="velora-sd-empty-title">No orders to fulfill</div>
                    <div className="velora-sd-empty-desc">New orders will arrive here for dispatch logging.</div>
                  </div>
                </div>
              ) : (
                <div className="velora-sd-table-wrap">
                  <table className="velora-sd-table">
                    <thead>
                      <tr>
                        <th>Order ID</th>
                        <th>Customer</th>
                        <th>Carrier</th>
                        <th>Tracking AWB</th>
                        <th>Fulfillment Status</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orders.map((o) => (
                        <tr key={o.id}>
                          <td><strong>#VL-{o.id}</strong></td>
                          <td>
                            <div>
                              <strong>{o.customer_name}</strong>
                              <div style={{ fontSize: "12px", color: "#6b7280" }}>{o.email}</div>
                            </div>
                          </td>
                          <td>{o.courier_name || "Unassigned"}</td>
                          <td>
                            {o.tracking_number ? (
                              <code style={{ background: "#f3f4f6", padding: "3px 6px", borderRadius: "4px" }}>
                                {o.tracking_number}
                              </code>
                            ) : (
                              <span style={{ color: "#9ca3af" }}>Not assigned</span>
                            )}
                          </td>
                          <td>
                            <span className={`velora-sd-status-badge ${o.status.toLowerCase()}`}>
                              {o.status}
                            </span>
                          </td>
                          <td>
                            <button
                              type="button"
                              className="velora-sd-btn-secondary"
                              style={{ padding: "6px 12px", fontSize: "12px" }}
                              onClick={() => {
                                setDeliveryEditOrderId(o.id);
                                setDeliveryTrackingNum(o.tracking_number || "");
                                setDeliveryCourier(o.courier_name || "BlueDart");
                              }}
                            >
                              Log Dispatch / Tracking
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {/* ======================================================== */}
          {/* TAB 4: PRODUCTS MANAGEMENT                               */}
          {/* ======================================================== */}
          {activeTab === "products" && (
            <section>
              <div className="velora-sd-section-header">
                <div className="velora-sd-section-title-wrap">
                  <h1>Products Catalogue</h1>
                  <p>Manage listings, categories, pricing, and live inventory.</p>
                </div>
                <button
                  type="button"
                  className="velora-sd-btn-primary"
                  onClick={openAddProduct}
                >
                  + Add Product
                </button>
              </div>

              {products.length === 0 ? (
                <div className="velora-sd-card">
                  <div className="velora-sd-empty-state">
                    <div className="velora-sd-empty-icon">◇</div>
                    <div className="velora-sd-empty-title">Your catalogue is empty</div>
                    <div className="velora-sd-empty-desc">
                      Add your first handcrafted or curated item to start selling.
                    </div>
                    <button
                      type="button"
                      className="velora-sd-btn-primary"
                      onClick={openAddProduct}
                      style={{ marginTop: "16px" }}
                    >
                      + Add First Product
                    </button>
                  </div>
                </div>
              ) : (
                <div className="velora-sd-table-wrap">
                  <table className="velora-sd-table">
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th>Category</th>
                        <th>Price</th>
                        <th>Stock Units</th>
                        <th>Listing Status</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {products
                        .filter((p) =>
                          `${p.name} ${p.category} ${p.description}`
                            .toLowerCase()
                            .includes(searchQuery.toLowerCase())
                        )
                        .map((p) => {
                          const thumb = getProductThumbnail(p.name, p.image_url);
                          return (
                            <tr key={p.id}>
                              <td>
                                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                                  <div className="velora-sd-product-thumb">
                                    <img src={thumb} alt="" />
                                  </div>
                                  <div>
                                    <strong>{p.name}</strong>
                                    <div style={{ fontSize: "12px", color: "#6b7280" }}>
                                      {p.description ? p.description.slice(0, 45) + "..." : "No description"}
                                    </div>
                                  </div>
                                </div>
                              </td>
                              <td>
                                <span style={{ background: "#f3f4f6", padding: "3px 8px", borderRadius: "12px", fontSize: "12px" }}>
                                  {p.category || "General"}
                                </span>
                              </td>
                              <td>
                                <strong>{formatMoney(p.price)}</strong>
                              </td>
                              <td>{p.stock}</td>
                              <td>
                                <span className={`velora-sd-status-badge ${p.is_active ? "delivered" : "cancelled"}`}>
                                  {p.is_active ? "Active" : "Draft"}
                                </span>
                              </td>
                              <td>
                                <div style={{ display: "flex", gap: "8px" }}>
                                  <button
                                    type="button"
                                    className="velora-sd-btn-secondary"
                                    style={{ padding: "5px 10px", fontSize: "12px" }}
                                    onClick={() => openEditProduct(p)}
                                  >
                                    Edit
                                  </button>
                                  <button
                                    type="button"
                                    className="velora-sd-btn-secondary"
                                    style={{ padding: "5px 10px", fontSize: "12px", color: "#dc2626" }}
                                    onClick={() => handleDeleteProduct(p)}
                                  >
                                    Delete
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {/* ======================================================== */}
          {/* TAB 5: ANALYTICS                                         */}
          {/* ======================================================== */}
          {activeTab === "analytics" && (
            <section>
              <div className="velora-sd-section-header">
                <div className="velora-sd-section-title-wrap">
                  <h1>Performance Analytics</h1>
                  <p>In-depth store metrics derived directly from verified database records.</p>
                </div>
              </div>

              <div className="velora-sd-overview-grid">
                <div className="velora-sd-metric-card">
                  <div className="velora-sd-metric-body">
                    <p className="velora-sd-metric-label">Gross Revenue</p>
                    <div className="velora-sd-metric-val">{formatMoney(totalSales)}</div>
                    <div className="velora-sd-metric-trend neutral">Verified completed orders</div>
                  </div>
                </div>
                <div className="velora-sd-metric-card">
                  <div className="velora-sd-metric-body">
                    <p className="velora-sd-metric-label">Average Order Value (AOV)</p>
                    <div className="velora-sd-metric-val">
                      {totalOrdersCount > 0 ? formatMoney(Math.round(totalSales / totalOrdersCount)) : "₹0"}
                    </div>
                    <div className="velora-sd-metric-trend neutral">Revenue per order</div>
                  </div>
                </div>
                <div className="velora-sd-metric-card">
                  <div className="velora-sd-metric-body">
                    <p className="velora-sd-metric-label">Completed Delivery Rate</p>
                    <div className="velora-sd-metric-val">
                      {totalOrdersCount > 0
                        ? `${Math.round((orders.filter((o) => o.status === "Delivered").length / totalOrdersCount) * 100)}%`
                        : "0%"}
                    </div>
                    <div className="velora-sd-metric-trend neutral">Delivered vs total orders</div>
                  </div>
                </div>
                <div className="velora-sd-metric-card">
                  <div className="velora-sd-metric-body">
                    <p className="velora-sd-metric-label">Active Listing Ratio</p>
                    <div className="velora-sd-metric-val">
                      {products.length > 0
                        ? `${Math.round((products.filter((p) => p.is_active).length / products.length) * 100)}%`
                        : "0%"}
                    </div>
                    <div className="velora-sd-metric-trend neutral">Published catalog inventory</div>
                  </div>
                </div>
              </div>

              <div className="velora-sd-card" style={{ marginTop: "20px" }}>
                <h3 className="velora-sd-card-title" style={{ marginBottom: "16px" }}>
                  Orders Status Breakdown
                </h3>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "16px" }}>
                  {["Pending", "Processing", "Shipped", "Delivered", "Cancelled"].map((st) => {
                    const count = orders.filter((o) => o.status === st).length;
                    return (
                      <div key={st} style={{ padding: "14px", borderRadius: "10px", background: "#f9fafb", border: "1px solid #edf0f4" }}>
                        <div style={{ fontSize: "12px", color: "#6b7280" }}>{st}</div>
                        <div style={{ fontSize: "20px", fontWeight: "700", marginTop: "4px" }}>{count}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>
          )}

          {/* ======================================================== */}
          {/* TAB 6: PAYOUTS & FINANCIAL INFRASTRUCTURE                 */}
          {/* ======================================================== */}
          {activeTab === "payouts" && (
            <section>
              <div className="velora-sd-section-header">
                <div className="velora-sd-section-title-wrap">
                  <h1>Financial Infrastructure & Wallet</h1>
                  <p>Real-time seller wallet, immutable financial ledger, payout requests and bank settlements.</p>
                </div>
              </div>

              {/* 1. FINANCIAL OVERVIEW METRICS GRID */}
              <div className="velora-sd-overview-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
                <div className="velora-sd-metric-card" style={{ border: "1px solid rgba(212, 175, 55, 0.4)", background: "rgba(212, 175, 55, 0.04)" }}>
                  <div className="velora-sd-metric-body">
                    <p className="velora-sd-metric-label" style={{ color: "#d4af37", fontWeight: "700" }}>Available Wallet Balance</p>
                    <div className="velora-sd-metric-val" style={{ color: "#d4af37" }}>
                      {formatMoney(sellerFinancials ? sellerFinancials.available_balance : settlementMetrics.netSellerEarnings)}
                    </div>
                    <div className="velora-sd-metric-trend up">Eligible for instant withdrawal</div>
                  </div>
                </div>

                <div className="velora-sd-metric-card">
                  <div className="velora-sd-metric-body">
                    <p className="velora-sd-metric-label">Pending Balance (In-Fulfillment)</p>
                    <div className="velora-sd-metric-val">
                      {formatMoney(sellerFinancials ? sellerFinancials.pending_balance : 0)}
                    </div>
                    <div className="velora-sd-metric-trend neutral">
                      {sellerFinancials ? `${sellerFinancials.pending_orders_count} order(s) pending delivery` : "Awaiting delivery confirmation"}
                    </div>
                  </div>
                </div>

                <div className="velora-sd-metric-card">
                  <div className="velora-sd-metric-body">
                    <p className="velora-sd-metric-label">Gross Store Volume (GMV)</p>
                    <div className="velora-sd-metric-val">
                      {formatMoney(sellerFinancials ? sellerFinancials.total_sales : totalSales)}
                    </div>
                    <div className="velora-sd-metric-trend neutral">Total store customer volume</div>
                  </div>
                </div>

                <div className="velora-sd-metric-card">
                  <div className="velora-sd-metric-body">
                    <p className="velora-sd-metric-label">Net Delivered Earnings (97%)</p>
                    <div className="velora-sd-metric-val">
                      {formatMoney(sellerFinancials ? sellerFinancials.net_seller_earnings : settlementMetrics.netSellerEarnings)}
                    </div>
                    <div className="velora-sd-metric-trend up">Completed delivered sales</div>
                  </div>
                </div>

                <div className="velora-sd-metric-card">
                  <div className="velora-sd-metric-body">
                    <p className="velora-sd-metric-label">VELORA Platform Fee (3%)</p>
                    <div className="velora-sd-metric-val">
                      {formatMoney(sellerFinancials ? sellerFinancials.platform_fee : settlementMetrics.platformFee)}
                    </div>
                    <div className="velora-sd-metric-trend neutral">Preserved official 3% platform fee</div>
                  </div>
                </div>

                <div className="velora-sd-metric-card">
                  <div className="velora-sd-metric-body">
                    <p className="velora-sd-metric-label">Total Withdrawn / Settled</p>
                    <div className="velora-sd-metric-val">
                      {formatMoney(sellerFinancials ? sellerFinancials.withdrawn_amount : 0)}
                    </div>
                    <div className="velora-sd-metric-trend neutral">Completed bank payouts</div>
                  </div>
                </div>
              </div>

              {/* Settlement Notice */}
              <div style={{ marginTop: "16px", padding: "12px 16px", borderRadius: "10px", background: "rgba(212, 175, 55, 0.06)", border: "1px solid rgba(212, 175, 55, 0.2)", fontSize: "12px", color: "#8a7a40" }}>
                <strong>Official Settlement Rule:</strong> Earnings are credited to your Available Wallet Balance upon order delivery. Pending orders are held safely in Pending Balance until fulfillment is completed. Minimum payout withdrawal threshold is ₹500.
              </div>

              {/* 2. REQUEST PAYOUT SECTION */}
              <div className="velora-sd-card" style={{ marginTop: "24px" }}>
                <h3 className="velora-sd-card-title">Request Bank Payout</h3>
                <p style={{ color: "#6b7280", fontSize: "13px", margin: "4px 0 16px 0" }}>
                  Withdraw your available settled earnings directly to your verified bank account.
                </p>

                {payoutReqError && (
                  <div className="velora-sd-alert error" style={{ marginBottom: "16px" }}>{payoutReqError}</div>
                )}
                {payoutReqNotice && (
                  <div className="velora-sd-alert success" style={{ marginBottom: "16px" }}>{payoutReqNotice}</div>
                )}

                {(() => {
                  const avail = sellerFinancials ? sellerFinancials.available_balance : settlementMetrics.netSellerEarnings;
                  const hasBank = Boolean(payoutAccount && payoutIfsc && payoutHolder);

                  if (!hasBank) {
                    return (
                      <div style={{ padding: "16px", background: "#fef3c7", borderRadius: "8px", border: "1px solid #fde68a", color: "#92400e", fontSize: "13px" }}>
                        Please configure and save your verified bank account details below before submitting a payout request.
                      </div>
                    );
                  }

                  if (avail < 500) {
                    return (
                      <div style={{ padding: "16px", background: "#f3f4f6", borderRadius: "8px", border: "1px solid #e5e7eb", color: "#4b5563", fontSize: "13px" }}>
                        Your current available balance ({formatMoney(avail)}) is below the minimum required withdrawal threshold of <strong>₹500</strong>. Fulfill your pending orders to increase your available balance.
                      </div>
                    );
                  }

                  return (
                    <form onSubmit={handleRequestPayout} style={{ display: "flex", gap: "12px", alignItems: "flex-end", flexWrap: "wrap" }}>
                      <div className="velora-sd-form-group" style={{ flex: "1", minWidth: "200px", marginBottom: 0 }}>
                        <label className="velora-sd-form-label">Withdrawal Amount (₹) *</label>
                        <div style={{ display: "flex", gap: "8px" }}>
                          <input
                            type="number"
                            min="500"
                            max={avail}
                            step="1"
                            required
                            placeholder="Enter amount (min ₹500)"
                            className="velora-sd-form-input"
                            value={payoutReqAmount}
                            onChange={(e) => setPayoutReqAmount(e.target.value)}
                          />
                          <button
                            type="button"
                            className="velora-sd-btn-secondary"
                            onClick={() => setPayoutReqAmount(String(Math.floor(avail)))}
                            style={{ whiteSpace: "nowrap" }}
                          >
                            Max ({formatMoney(avail)})
                          </button>
                        </div>
                      </div>

                      <button
                        type="submit"
                        disabled={payoutReqLoading || !payoutReqAmount || Number(payoutReqAmount) < 500 || Number(payoutReqAmount) > avail}
                        className="velora-sd-btn-primary"
                        style={{ height: "42px" }}
                      >
                        {payoutReqLoading ? "Submitting Request..." : "Submit Payout Request"}
                      </button>
                    </form>
                  );
                })()}
              </div>

              {/* 3. SETTLEMENT BANK ACCOUNT CARD */}
              <div className="velora-sd-card" style={{ marginTop: "24px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "12px" }}>
                  <div>
                    <h3 className="velora-sd-card-title">Settlement Bank Account Destination</h3>
                    <p style={{ color: "#6b7280", fontSize: "13px", margin: "4px 0 16px 0" }}>
                      Funds from completed store orders are routed directly to this verified bank account.
                    </p>
                  </div>
                  {payoutAccount && (
                    <div style={{ padding: "6px 12px", background: "rgba(16, 185, 129, 0.1)", border: "1px solid rgba(16, 185, 129, 0.3)", borderRadius: "20px", fontSize: "12px", color: "#059669", fontWeight: "600" }}>
                      ✓ Bank Account Configured
                    </div>
                  )}
                </div>

                <form onSubmit={handleSavePayout} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                  <div className="velora-sd-form-group">
                    <label className="velora-sd-form-label">Account Holder Name *</label>
                    <input
                      type="text"
                      required
                      className="velora-sd-form-input"
                      value={payoutHolder}
                      onChange={(e) => setPayoutHolder(e.target.value)}
                      placeholder="e.g. Khushpreet Singh"
                    />
                  </div>

                  <div className="velora-sd-form-group">
                    <label className="velora-sd-form-label">Bank Name *</label>
                    <input
                      type="text"
                      required
                      className="velora-sd-form-input"
                      value={payoutBank}
                      onChange={(e) => setPayoutBank(e.target.value)}
                      placeholder="e.g. HDFC Bank, ICICI Bank, SBI"
                    />
                  </div>

                  <div className="velora-sd-form-group">
                    <label className="velora-sd-form-label">Account Number *</label>
                    <input
                      type="text"
                      required
                      className="velora-sd-form-input"
                      value={payoutAccount}
                      onChange={(e) => setPayoutAccount(e.target.value)}
                      placeholder="e.g. 50100234567890"
                    />
                    {payoutAccount && payoutAccount.length >= 4 && (
                      <span style={{ fontSize: "11px", color: "#6b7280", marginTop: "4px", display: "block" }}>
                        Masked Preview: •••• •••• {payoutAccount.slice(-4)}
                      </span>
                    )}
                  </div>

                  <div className="velora-sd-form-group">
                    <label className="velora-sd-form-label">IFSC Code *</label>
                    <input
                      type="text"
                      required
                      className="velora-sd-form-input"
                      value={payoutIfsc}
                      onChange={(e) => setPayoutIfsc(e.target.value.toUpperCase())}
                      placeholder="e.g. HDFC0001234"
                    />
                  </div>

                  <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end" }}>
                    <button type="submit" disabled={payoutSaving} className="velora-sd-btn-primary">
                      {payoutSaving ? "Saving..." : "Save Bank Destination"}
                    </button>
                  </div>
                </form>
              </div>

              {/* 4. PAYOUT REQUESTS HISTORY TABLE */}
              <div className="velora-sd-card" style={{ marginTop: "24px" }}>
                <h3 className="velora-sd-card-title">Payout Requests History</h3>
                <p style={{ color: "#6b7280", fontSize: "13px", margin: "4px 0 16px 0" }}>
                  Status and transaction references for your withdrawal requests.
                </p>

                {sellerPayouts.length === 0 ? (
                  <div className="velora-sd-empty-state" style={{ padding: "30px 20px" }}>
                    <p className="velora-sd-empty-desc">No payout requests submitted yet. When you request a payout, its processing status and UTR will appear here.</p>
                  </div>
                ) : (
                  <div className="velora-sd-table-wrap">
                    <table className="velora-sd-table">
                      <thead>
                        <tr>
                          <th>Reference</th>
                          <th>Requested Date</th>
                          <th>Amount</th>
                          <th>Destination</th>
                          <th>Bank UTR / Ref</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sellerPayouts.map((p) => {
                          const statusBg =
                            p.status === "completed"
                              ? "#10b981"
                              : p.status === "rejected" || p.status === "failed"
                              ? "#ef4444"
                              : "#f59e0b";
                          return (
                            <tr key={p.id}>
                              <td>
                                <strong style={{ fontFamily: "monospace", fontSize: "12px" }}>{p.payout_ref}</strong>
                              </td>
                              <td style={{ fontSize: "12px", color: "#6b7280" }}>
                                {timeAgo(p.requested_at)}
                              </td>
                              <td>
                                <strong>{formatMoney(p.amount)}</strong>
                              </td>
                              <td style={{ fontSize: "12px" }}>
                                <div>{p.bank_name}</div>
                                <div style={{ color: "#6b7280" }}>{p.bank_account_number}</div>
                              </td>
                              <td style={{ fontSize: "12px" }}>
                                {p.utr_reference ? (
                                  <span style={{ fontFamily: "monospace", color: "#059669" }}>{p.utr_reference}</span>
                                ) : (
                                  <span style={{ color: "#9ca3af" }}>Pending transfer</span>
                                )}
                              </td>
                              <td>
                                <span
                                  className="velora-sd-status-badge"
                                  style={{
                                    background: statusBg,
                                    color: "#fff",
                                    textTransform: "capitalize",
                                    padding: "3px 8px",
                                    borderRadius: "12px",
                                    fontSize: "11px"
                                  }}
                                >
                                  {p.status}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* 5. IMMUTABLE FINANCIAL LEDGER / TRANSACTIONS TABLE */}
              <div className="velora-sd-card" style={{ marginTop: "24px" }}>
                <h3 className="velora-sd-card-title">Immutable Financial Ledger</h3>
                <p style={{ color: "#6b7280", fontSize: "13px", margin: "4px 0 16px 0" }}>
                  Verified cryptographic ledger recording all credits, debits, order settlements and refunds.
                </p>

                {sellerTransactions.length === 0 ? (
                  <div className="velora-sd-empty-state" style={{ padding: "30px 20px" }}>
                    <p className="velora-sd-empty-desc">No ledger transactions recorded yet. Delivered store orders and payout settlements will appear here.</p>
                  </div>
                ) : (
                  <div className="velora-sd-table-wrap">
                    <table className="velora-sd-table">
                      <thead>
                        <tr>
                          <th>Transaction Ref</th>
                          <th>Date</th>
                          <th>Type</th>
                          <th>Entry</th>
                          <th>Amount</th>
                          <th>Status</th>
                          <th>Description</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sellerTransactions.map((tx) => {
                          const isCredit = tx.entry_type === "CREDIT";
                          return (
                            <tr key={tx.id}>
                              <td style={{ fontFamily: "monospace", fontSize: "11px" }}>{tx.transaction_ref}</td>
                              <td style={{ fontSize: "12px", color: "#6b7280" }}>{timeAgo(tx.created_at)}</td>
                              <td>
                                <span style={{ fontSize: "11px", fontWeight: "600", padding: "2px 6px", borderRadius: "4px", background: "#f3f4f6" }}>
                                  {tx.transaction_type}
                                </span>
                              </td>
                              <td>
                                <span style={{ fontWeight: "700", color: isCredit ? "#059669" : "#dc2626" }}>
                                  {isCredit ? "+ CREDIT" : "- DEBIT"}
                                </span>
                              </td>
                              <td>
                                <strong style={{ color: isCredit ? "#059669" : "#dc2626" }}>
                                  {formatMoney(tx.amount)}
                                </strong>
                              </td>
                              <td>
                                <span style={{ fontSize: "11px", color: "#059669", textTransform: "capitalize" }}>
                                  {tx.status}
                                </span>
                              </td>
                              <td style={{ fontSize: "12px", color: "#4b5563" }}>{tx.description}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* ======================================================== */}
          {/* TAB 7: DISCOUNTS                                         */}
          {/* ======================================================== */}
          {activeTab === "discounts" && (
            <section>
              <div className="velora-sd-section-header">
                <div className="velora-sd-section-title-wrap">
                  <h1>Discounts & Coupons</h1>
                  <p>Create promotional codes validated live during customer storefront checkout.</p>
                </div>
                <button
                  type="button"
                  className="velora-sd-btn-primary"
                  onClick={() => setShowDiscountModal(true)}
                >
                  + Create Coupon
                </button>
              </div>

              {discounts.length === 0 ? (
                <div className="velora-sd-card">
                  <div className="velora-sd-empty-state">
                    <div className="velora-sd-empty-icon">🏷️</div>
                    <div className="velora-sd-empty-title">No active promo codes</div>
                    <div className="velora-sd-empty-desc">
                      Create percentage or flat discount coupons for your store campaigns.
                    </div>
                  </div>
                </div>
              ) : (
                <div className="velora-sd-table-wrap">
                  <table className="velora-sd-table">
                    <thead>
                      <tr>
                        <th>Coupon Code</th>
                        <th>Type</th>
                        <th>Discount Value</th>
                        <th>Minimum Spend</th>
                        <th>Status</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {discounts.map((d) => (
                        <tr key={d.id}>
                          <td>
                            <strong style={{ letterSpacing: "0.05em", color: "#111" }}>{d.code}</strong>
                          </td>
                          <td>{d.type === "percentage" ? "Percentage (%)" : "Flat Amount (₹)"}</td>
                          <td>
                            <strong>
                              {d.type === "percentage" ? `${d.value}% OFF` : `₹${d.value} OFF`}
                            </strong>
                          </td>
                          <td>{d.min_order_amount > 0 ? formatMoney(d.min_order_amount) : "No minimum"}</td>
                          <td>
                            <span className={`velora-sd-status-badge ${d.is_active ? "delivered" : "cancelled"}`}>
                              {d.is_active ? "Active" : "Disabled"}
                            </span>
                          </td>
                          <td>
                            <div style={{ display: "flex", gap: "8px" }}>
                              <button
                                type="button"
                                className="velora-sd-btn-secondary"
                                style={{ padding: "4px 8px", fontSize: "12px" }}
                                onClick={() => handleToggleDiscount(d)}
                              >
                                {d.is_active ? "Disable" : "Enable"}
                              </button>
                              <button
                                type="button"
                                className="velora-sd-btn-secondary"
                                style={{ padding: "4px 8px", fontSize: "12px", color: "#dc2626" }}
                                onClick={() => handleDeleteDiscount(d)}
                              >
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {/* ======================================================== */}
          {/* TAB 8: AUDIENCE                                          */}
          {/* ======================================================== */}
          {activeTab === "audience" && (
            <section>
              <div className="velora-sd-section-header">
                <div className="velora-sd-section-title-wrap">
                  <h1>Store Audience</h1>
                  <p>Customer directory verified from real completed orders for your store.</p>
                </div>
              </div>

              {audienceList.length === 0 ? (
                <div className="velora-sd-card">
                  <div className="velora-sd-empty-state">
                    <div className="velora-sd-empty-icon">👥</div>
                    <div className="velora-sd-empty-title">No customers yet</div>
                    <div className="velora-sd-empty-desc">
                      As customers place orders through your boutique, their verified profile will appear here.
                    </div>
                  </div>
                </div>
              ) : (
                <div className="velora-sd-table-wrap">
                  <table className="velora-sd-table">
                    <thead>
                      <tr>
                        <th>Customer</th>
                        <th>Email Address</th>
                        <th>Total Orders</th>
                        <th>Lifetime Spend</th>
                        <th>Last Order</th>
                      </tr>
                    </thead>
                    <tbody>
                      {audienceList.map((cust, i) => (
                        <tr key={i}>
                          <td>
                            <strong>{cust.name}</strong>
                          </td>
                          <td>{cust.email}</td>
                          <td>{cust.ordersCount}</td>
                          <td>
                            <strong>{formatMoney(cust.totalSpent)}</strong>
                          </td>
                          <td>{timeAgo(cust.lastOrder)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {/* ======================================================== */}
          {/* TAB 9: APPEARANCE                                        */}
          {/* ======================================================== */}
          {activeTab === "appearance" && (
            <section>
              <div className="velora-sd-section-header">
                <div className="velora-sd-section-title-wrap">
                  <h1>Store Customization & Branding</h1>
                  <p>Personalize your public boutique with custom accent colors, logo, and announcement banner.</p>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: "24px" }}>
                {/* Form */}
                <div className="velora-sd-card">
                  {error && <div className="velora-sd-alert error" style={{ marginBottom: "16px" }}>{error}</div>}
                  {notice && <div className="velora-sd-alert success" style={{ marginBottom: "16px" }}>{notice}</div>}
                  <form onSubmit={handleSaveAppearance}>
                    <div className="velora-sd-form-group">
                      <label className="velora-sd-form-label">Store Brand Name *</label>
                      <input
                        type="text"
                        required
                        className="velora-sd-form-input"
                        value={appearanceName}
                        onChange={(e) => setAppearanceName(e.target.value)}
                      />
                    </div>

                    <div className="velora-sd-form-group">
                      <label className="velora-sd-form-label">Store Tagline / Description</label>
                      <textarea
                        rows={2}
                        className="velora-sd-form-textarea"
                        value={appearanceDesc}
                        onChange={(e) => setAppearanceDesc(e.target.value)}
                      />
                    </div>

                    <div className="velora-sd-form-group">
                      <label className="velora-sd-form-label">Top Announcement Banner</label>
                      <input
                        type="text"
                        className="velora-sd-form-input"
                        placeholder="e.g. Free shipping on all luxury orders over ₹1,999"
                        value={appearanceAnnouncement}
                        onChange={(e) => setAppearanceAnnouncement(e.target.value)}
                      />
                    </div>

                    <div className="velora-sd-form-group">
                      <label className="velora-sd-form-label">Brand Theme Color</label>
                      <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                        {["#d4af37", "#b76e79", "#10b981", "#18181b", "#3b82f6"].map((c) => (
                          <button
                            key={c}
                            type="button"
                            onClick={() => setAppearanceThemeColor(c)}
                            style={{
                              width: "32px",
                              height: "32px",
                              borderRadius: "50%",
                              background: c,
                              border: appearanceThemeColor === c ? "3px solid #111" : "2px solid #fff",
                              boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                              cursor: "pointer",
                            }}
                          />
                        ))}
                        <input
                          type="color"
                          value={appearanceThemeColor}
                          onChange={(e) => setAppearanceThemeColor(e.target.value)}
                          style={{ width: "36px", height: "36px", border: "none", cursor: "pointer", background: "none" }}
                        />
                      </div>
                    </div>

                    <div className="velora-sd-form-group">
                      <label className="velora-sd-form-label">Store Logo</label>
                      <input
                        ref={logoFileInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/gif,image/*"
                        hidden
                        onChange={handleLogoFileSelected}
                      />

                      <div style={{ display: "flex", alignItems: "center", gap: "16px", marginBottom: "12px" }}>
                        <div
                          style={{
                            width: "56px",
                            height: "56px",
                            borderRadius: "50%",
                            background: "#18181b",
                            border: `2px solid ${appearanceThemeColor || "#d4af37"}`,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            overflow: "hidden",
                            color: appearanceThemeColor || "#d4af37",
                            fontWeight: "700",
                            fontSize: "20px",
                            flexShrink: 0,
                          }}
                        >
                          {appearanceLogoPreview || appearanceLogoUrl ? (
                            <img
                              src={appearanceLogoPreview || appearanceLogoUrl}
                              alt="Store logo preview"
                              style={{ width: "100%", height: "100%", objectFit: "cover" }}
                            />
                          ) : (
                            (appearanceName || "V").charAt(0).toUpperCase()
                          )}
                        </div>

                        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                          <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
                            <button
                              type="button"
                              className="velora-sd-btn-secondary"
                              disabled={appearanceLogoUploading}
                              onClick={() => logoFileInputRef.current?.click()}
                            >
                              {appearanceLogoUploading ? "Uploading..." : "Upload Logo"}
                            </button>
                            {(appearanceLogoUrl || appearanceLogoPreview) && (
                              <button
                                type="button"
                                className="velora-sd-btn-secondary"
                                style={{ color: "#ef4444", borderColor: "#fca5a5" }}
                                onClick={() => {
                                  setAppearanceLogoUrl("");
                                  setAppearanceLogoPreview("");
                                }}
                              >
                                Remove
                              </button>
                            )}
                          </div>
                          <span style={{ fontSize: "11px", color: "#6b7280" }}>
                            JPG, PNG, WEBP, or GIF · max 2MB
                          </span>
                        </div>
                      </div>

                      <label className="velora-sd-form-label" style={{ marginTop: "12px" }}>
                        Logo Image URL
                      </label>
                      <input
                        type="text"
                        className="velora-sd-form-input"
                        placeholder="https://example.com/logo.png"
                        value={appearanceLogoUrl}
                        onChange={(e) => setAppearanceLogoUrl(e.target.value)}
                      />
                    </div>

                    <div className="velora-sd-form-actions">
                      <button type="submit" disabled={appearanceSaving} className="velora-sd-btn-primary">
                        {appearanceSaving ? "Saving..." : "Save Branding"}
                      </button>
                    </div>
                  </form>
                </div>

                {/* Live Preview Card */}
                <div>
                  <h3 className="velora-sd-card-title" style={{ marginBottom: "12px" }}>
                    Live Storefront Preview
                  </h3>
                  <div
                    style={{
                      background: "#121316",
                      borderRadius: "16px",
                      padding: "24px",
                      color: "#fff",
                      border: `1px solid ${appearanceThemeColor}40`,
                    }}
                  >
                    {appearanceAnnouncement && (
                      <div
                        style={{
                          background: appearanceThemeColor,
                          color: "#000",
                          fontSize: "11px",
                          fontWeight: "600",
                          padding: "6px 12px",
                          borderRadius: "6px",
                          marginBottom: "16px",
                          textAlign: "center",
                        }}
                      >
                        {appearanceAnnouncement}
                      </div>
                    )}

                    <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                      <div
                        style={{
                          width: "50px",
                          height: "50px",
                          borderRadius: "50%",
                          background: "#222",
                          border: `1px solid ${appearanceThemeColor}`,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          color: appearanceThemeColor,
                          fontWeight: "700",
                          fontSize: "20px",
                        }}
                      >
                        {appearanceLogoPreview || appearanceLogoUrl ? (
                          <img
                            src={appearanceLogoPreview || appearanceLogoUrl}
                            alt=""
                            style={{ width: "100%", height: "100%", borderRadius: "50%", objectFit: "cover" }}
                          />
                        ) : (
                          (appearanceName || "V").charAt(0).toUpperCase()
                        )}
                      </div>
                      <div>
                        <h4 style={{ margin: 0, fontSize: "17px", color: "#fff" }}>{appearanceName || "Store Name"}</h4>
                        <div style={{ fontSize: "12px", color: "#888" }}>/{store?.slug || "store"}</div>
                      </div>
                    </div>

                    <p style={{ fontSize: "13px", color: "#aaa", marginTop: "16px", lineHeight: "1.4" }}>
                      {appearanceDesc || "Discover our curated collection."}
                    </p>

                    <div style={{ marginTop: "20px", paddingTop: "16px", borderTop: "1px solid #222" }}>
                      <span style={{ fontSize: "12px", color: appearanceThemeColor }}>
                        ● Theme accent active
                      </span>
                    </div>
                  </div>

                  {/* Future Themes Teaser */}
                  <div className="velora-sd-card" style={{ marginTop: "20px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <h4 style={{ margin: 0, fontSize: "14px" }}>Premium Themes</h4>
                      <span className="velora-sd-status-badge pending">Future Add-on</span>
                    </div>
                    <p style={{ fontSize: "12px", color: "#6b7280", margin: "6px 0 0 0" }}>
                      Atelier Minimalist, Luxury Silk & Dark Elegance themes are planned future upgrades.
                    </p>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* ======================================================== */}
          {/* TAB 10: PLUGINS & INTEGRATIONS                           */}
          {/* ======================================================== */}
          {activeTab === "plugins" && (
            <section>
              <div className="velora-sd-section-header">
                <div className="velora-sd-section-title-wrap">
                  <h1>Plugins & Integrations</h1>
                  <p>Genuine integration status for external communication, analytics, courier, and payment gateways.</p>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "20px" }}>
                {[
                  {
                    key: "whatsapp",
                    name: "WhatsApp Notifications",
                    category: "Customer Communication",
                    desc: "Automated dispatch and order confirmation messages sent directly to customer WhatsApp.",
                  },
                  {
                    key: "google_analytics",
                    name: "Google Analytics 4",
                    category: "Marketing & Traffic",
                    desc: "Track store visitors, conversion funnels, and checkout events using your G-tag ID.",
                  },
                  {
                    key: "shiprocket",
                    name: "Shiprocket Logistics",
                    category: "Courier & Shipping",
                    desc: "Sync waybill and schedule carrier pickup directly through Shiprocket API.",
                  },
                  {
                    key: "razorpay",
                    name: "Razorpay Custom Gateway",
                    category: "Direct Payments",
                    desc: "Connect your direct Razorpay Key ID and Secret for direct instant settlements.",
                  },
                ].map((pl) => {
                  const isConfigured = Boolean(plugins[pl.key]?.is_enabled);
                  return (
                    <div key={pl.key} className="velora-sd-card" style={{ justifyContent: "space-between" }}>
                      <div>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                          <span style={{ fontSize: "11px", color: "#6b7280", textTransform: "uppercase", fontWeight: "600" }}>
                            {pl.category}
                          </span>
                          <span className={`velora-sd-status-badge ${isConfigured ? "delivered" : "cancelled"}`}>
                            {isConfigured ? "Configured" : "Setup Required"}
                          </span>
                        </div>
                        <h3 style={{ fontSize: "16px", margin: "10px 0 6px 0" }}>{pl.name}</h3>
                        <p style={{ fontSize: "12.5px", color: "#6b7280", lineHeight: "1.4" }}>{pl.desc}</p>
                      </div>

                      <div style={{ marginTop: "18px" }}>
                        <button
                          type="button"
                          className="velora-sd-btn-secondary"
                          style={{ width: "100%", justifyContent: "center" }}
                          onClick={() => {
                            setPluginConfigModal(pl.key);
                            setPluginConfigInput(plugins[pl.key]?.config || {});
                          }}
                        >
                          {isConfigured ? "Manage Configuration" : "Configure Integration"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* ======================================================== */}
          {/* TAB 11: SETTINGS                                         */}
          {/* ======================================================== */}
          {activeTab === "settings" && (
            <section>
              <div className="velora-sd-section-header">
                <div className="velora-sd-section-title-wrap">
                  <h1>Store & Account Settings</h1>
                  <p>Manage account security, store identifiers, and communications.</p>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
                {/* Store Profile Card */}
                <div className="velora-sd-card">
                  <h3 className="velora-sd-card-title" style={{ marginBottom: "16px" }}>
                    Store Profile
                  </h3>
                  <div style={{ display: "grid", gap: "12px", fontSize: "13.5px" }}>
                    <div>
                      <span style={{ color: "#6b7280" }}>Store Name:</span>
                      <strong style={{ marginLeft: "8px" }}>{store?.name}</strong>
                    </div>
                    <div>
                      <span style={{ color: "#6b7280" }}>Public URL:</span>
                      <span style={{ marginLeft: "8px", fontFamily: "monospace" }}>/{store?.slug}</span>
                    </div>
                    <div>
                      <span style={{ color: "#6b7280" }}>Owner Name:</span>
                      <span style={{ marginLeft: "8px" }}>{seller?.name}</span>
                    </div>
                    <div>
                      <span style={{ color: "#6b7280" }}>Registered Email:</span>
                      <span style={{ marginLeft: "8px" }}>{seller?.email}</span>
                    </div>
                  </div>
                </div>

                {/* Account Security (Password Update) */}
                <div className="velora-sd-card">
                  <h3 className="velora-sd-card-title" style={{ marginBottom: "16px" }}>
                    Security & Password
                  </h3>
                  <form onSubmit={handleChangePassword}>
                    <div className="velora-sd-form-group">
                      <label className="velora-sd-form-label">Current Password *</label>
                      <PasswordInput
                        variant="seller"
                        required
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                      />
                    </div>
                    <div className="velora-sd-form-group">
                      <label className="velora-sd-form-label">New Password (min 8 characters) *</label>
                      <PasswordInput
                        variant="seller"
                        required
                        minLength={8}
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                      />
                    </div>
                    <button type="submit" disabled={passwordSaving} className="velora-sd-btn-primary">
                      {passwordSaving ? "Updating..." : "Update Password"}
                    </button>
                  </form>
                </div>
              </div>
            </section>
          )}
        </main>
      </div>

      {/* ======================================================== */}
      {/* MODALS                                                   */}
      {/* ======================================================== */}

      {/* Add / Edit Product Modal */}
      {showProductModal && (
        <div className="velora-sd-modal-backdrop">
          <div className="velora-sd-modal-content">
            <div className="velora-sd-modal-header">
              <h2 className="velora-sd-modal-title">
                {editingProductId ? "Edit Product" : "Add New Product"}
              </h2>
              <button
                type="button"
                className="velora-sd-modal-close"
                onClick={closeProductModal}
              >
                ×
              </button>
            </div>

            <form onSubmit={handleSaveProduct}>
              <div className="velora-sd-form-group">
                <label className="velora-sd-form-label">Product Name *</label>
                <input
                  type="text"
                  required
                  className="velora-sd-form-input"
                  placeholder="e.g. Aura Wireless Headphones"
                  value={productForm.name}
                  onChange={(e) => setProductForm({ ...productForm, name: e.target.value })}
                />
              </div>

              <div className="velora-sd-form-group">
                <label className="velora-sd-form-label">Category</label>
                <input
                  type="text"
                  className="velora-sd-form-input"
                  placeholder="e.g. Audio, Watches, Leather, Accessories"
                  value={productForm.category}
                  onChange={(e) => setProductForm({ ...productForm, category: e.target.value })}
                />
              </div>

              <div className="velora-sd-form-group">
                <label className="velora-sd-form-label">Description</label>
                <textarea
                  rows={3}
                  className="velora-sd-form-textarea"
                  placeholder="Provide product details, craftsmanship, materials..."
                  value={productForm.description}
                  onChange={(e) => setProductForm({ ...productForm, description: e.target.value })}
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>
                <div className="velora-sd-form-group">
                  <label className="velora-sd-form-label">Price (₹) *</label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    required
                    className="velora-sd-form-input"
                    value={productForm.price}
                    onChange={(e) => setProductForm({ ...productForm, price: e.target.value })}
                  />
                </div>

                <div className="velora-sd-form-group">
                  <label className="velora-sd-form-label">Stock Quantity *</label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    required
                    className="velora-sd-form-input"
                    value={productForm.stock}
                    onChange={(e) => setProductForm({ ...productForm, stock: e.target.value })}
                  />
                </div>
              </div>

              <div className="velora-sd-form-group">
                <label className="velora-sd-form-label">Product Image</label>
                <input
                  ref={productFileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  hidden
                  onChange={handleProductFileSelected}
                />

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "16px",
                    padding: "12px",
                    background: "#f9fafb",
                    borderRadius: "10px",
                    border: "1px dashed #d1d5db",
                    marginBottom: "10px",
                  }}
                >
                  <div
                    style={{
                      width: "72px",
                      height: "72px",
                      borderRadius: "8px",
                      background: "#e5e7eb",
                      border: "1px solid #d1d5db",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      overflow: "hidden",
                      flexShrink: 0,
                      position: "relative",
                    }}
                  >
                    {productImagePreview || uploadedImageUrl || directImageUrl ? (
                      <img
                        src={productImagePreview || uploadedImageUrl || directImageUrl}
                        alt="Product preview"
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                        onError={(e) => {
                          (e.target as HTMLElement).style.display = "none";
                        }}
                      />
                    ) : (
                      <svg width="28" height="28" fill="none" viewBox="0 0 24 24" stroke="#9ca3af">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    )}
                    {productImageUploading && (
                      <div
                        style={{
                          position: "absolute",
                          inset: 0,
                          background: "rgba(0,0,0,0.65)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          color: "#fff",
                          fontSize: "11px",
                          fontWeight: "600",
                          textAlign: "center",
                          padding: "2px",
                        }}
                      >
                        Uploading
                      </div>
                    )}
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: "6px", flex: 1 }}>
                    <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
                      <button
                        type="button"
                        className="velora-sd-btn-secondary"
                        disabled={productImageUploading}
                        onClick={() => productFileInputRef.current?.click()}
                      >
                        {productImageUploading
                          ? "Uploading..."
                          : productImagePreview || uploadedImageUrl
                          ? "Change Image"
                          : "Upload Image"}
                      </button>
                      {(productImagePreview || uploadedImageUrl || directImageUrl) && !productImageUploading && (
                        <button
                          type="button"
                          className="velora-sd-btn-secondary"
                          style={{ color: "#ef4444", borderColor: "#fca5a5" }}
                          onClick={() => {
                            setUploadedImageUrl("");
                            setDirectImageUrl("");
                            setProductForm((prev) => ({ ...prev, image_url: "" }));
                            setProductImagePreview("");
                            setProductImageError("");
                            if (productFileInputRef.current) {
                              productFileInputRef.current.value = "";
                            }
                          }}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                    <span style={{ fontSize: "11px", color: "#6b7280" }}>
                      {uploadedImageUrl ? "Uploaded from device · JPEG, PNG, WebP or GIF · Max 5 MB" : "JPEG, PNG, WebP or GIF · Max 5 MB"}
                    </span>
                  </div>
                </div>

                {productImageError && (
                  <div style={{ color: "#ef4444", fontSize: "12px", marginBottom: "8px", fontWeight: "500" }}>
                    {productImageError}
                  </div>
                )}

                <label className="velora-sd-form-label" style={{ marginTop: "10px" }}>
                  Or Direct Image URL
                </label>
                <input
                  type="text"
                  className="velora-sd-form-input"
                  placeholder="https://example.com/item.jpg"
                  value={directImageUrl}
                  onChange={(e) => {
                    setDirectImageUrl(e.target.value);
                    setProductImageError("");
                  }}
                />
              </div>

              <div className="velora-sd-form-group" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <input
                  type="checkbox"
                  id="prod_active"
                  checked={productForm.is_active}
                  onChange={(e) => setProductForm({ ...productForm, is_active: e.target.checked })}
                />
                <label htmlFor="prod_active" style={{ fontSize: "13px", cursor: "pointer" }}>
                  Publish product immediately as active listing
                </label>
              </div>

              <div className="velora-sd-form-actions">
                <button
                  type="button"
                  className="velora-sd-btn-secondary"
                  onClick={closeProductModal}
                >
                  Cancel
                </button>
                <button type="submit" className="velora-sd-btn-primary" disabled={productImageUploading}>
                  {productImageUploading ? "Uploading Image..." : editingProductId ? "Save Changes" : "Create Product"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Log Dispatch / Tracking Modal */}
      {deliveryEditOrderId && (
        <div className="velora-sd-modal-backdrop">
          <div className="velora-sd-modal-content">
            <div className="velora-sd-modal-header">
              <h2 className="velora-sd-modal-title">Fulfill Order #VL-{deliveryEditOrderId}</h2>
              <button
                type="button"
                className="velora-sd-modal-close"
                onClick={() => setDeliveryEditOrderId(null)}
              >
                ×
              </button>
            </div>

            <form onSubmit={handleSaveDelivery}>
              <div className="velora-sd-form-group">
                <label className="velora-sd-form-label">Courier Service *</label>
                <select
                  className="velora-sd-form-select"
                  value={deliveryCourier}
                  onChange={(e) => setDeliveryCourier(e.target.value)}
                >
                  <option value="BlueDart">BlueDart Express</option>
                  <option value="Delhivery">Delhivery</option>
                  <option value="DTDC">DTDC Courier</option>
                  <option value="FedEx">FedEx India</option>
                  <option value="India Post">India Post Speed Post</option>
                  <option value="Custom Carrier">Other / Hand Delivery</option>
                </select>
              </div>

              <div className="velora-sd-form-group">
                <label className="velora-sd-form-label">Tracking Number / AWB *</label>
                <input
                  type="text"
                  required
                  className="velora-sd-form-input"
                  placeholder="e.g. BD789456123IN"
                  value={deliveryTrackingNum}
                  onChange={(e) => setDeliveryTrackingNum(e.target.value)}
                />
              </div>

              <div className="velora-sd-form-actions">
                <button
                  type="button"
                  className="velora-sd-btn-secondary"
                  onClick={() => setDeliveryEditOrderId(null)}
                >
                  Cancel
                </button>
                <button type="submit" className="velora-sd-btn-primary">
                  Confirm Dispatch & Mark Shipped
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create Discount Coupon Modal */}
      {showDiscountModal && (
        <div className="velora-sd-modal-backdrop">
          <div className="velora-sd-modal-content">
            <div className="velora-sd-modal-header">
              <h2 className="velora-sd-modal-title">Create Discount Coupon</h2>
              <button
                type="button"
                className="velora-sd-modal-close"
                onClick={() => setShowDiscountModal(false)}
              >
                ×
              </button>
            </div>

            <form onSubmit={handleCreateDiscount}>
              <div className="velora-sd-form-group">
                <label className="velora-sd-form-label">Coupon Code *</label>
                <input
                  type="text"
                  required
                  className="velora-sd-form-input"
                  placeholder="e.g. VELORA10, FESTIVE500"
                  value={discountCode}
                  onChange={(e) => setDiscountCode(e.target.value.toUpperCase())}
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>
                <div className="velora-sd-form-group">
                  <label className="velora-sd-form-label">Discount Type *</label>
                  <select
                    className="velora-sd-form-select"
                    value={discountType}
                    onChange={(e) => setDiscountType(e.target.value as "percentage" | "fixed")}
                  >
                    <option value="percentage">Percentage (%)</option>
                    <option value="fixed">Flat Amount (₹)</option>
                  </select>
                </div>

                <div className="velora-sd-form-group">
                  <label className="velora-sd-form-label">
                    {discountType === "percentage" ? "Percentage Off (%) *" : "Discount Amount (₹) *"}
                  </label>
                  <input
                    type="number"
                    min="1"
                    max={discountType === "percentage" ? "100" : undefined}
                    required
                    className="velora-sd-form-input"
                    value={discountValue}
                    onChange={(e) => setDiscountValue(e.target.value)}
                  />
                </div>
              </div>

              <div className="velora-sd-form-group">
                <label className="velora-sd-form-label">Minimum Order Spend (₹, optional)</label>
                <input
                  type="number"
                  min="0"
                  className="velora-sd-form-input"
                  placeholder="0"
                  value={discountMinOrder}
                  onChange={(e) => setDiscountMinOrder(e.target.value)}
                />
              </div>

              <div className="velora-sd-form-actions">
                <button
                  type="button"
                  className="velora-sd-btn-secondary"
                  onClick={() => setShowDiscountModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="velora-sd-btn-primary">
                  Create Coupon
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Upgrade Plan Modal */}
      {showUpgradeModal && (
        <div className="velora-sd-modal-backdrop">
          <div className="velora-sd-modal-content">
            <div className="velora-sd-modal-header">
              <h2 className="velora-sd-modal-title">VELORA Atelier Seller Plans</h2>
              <button
                type="button"
                className="velora-sd-modal-close"
                onClick={() => setShowUpgradeModal(false)}
              >
                ×
              </button>
            </div>

            <div style={{ marginBottom: "20px" }}>
              <div style={{ padding: "16px", borderRadius: "12px", background: "#f9fafb", border: "1px solid #edf0f4", marginBottom: "16px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <strong>Standard Atelier (Current Active Plan)</strong>
                  <span className="velora-sd-status-badge delivered">Active</span>
                </div>
                <p style={{ fontSize: "13px", color: "#6b7280", margin: "8px 0 0 0" }}>
                  Unlimited store products, direct customer checkout, 3% platform fee on completed orders, and complete store dashboard access.
                </p>
              </div>

              <div style={{ padding: "16px", borderRadius: "12px", background: "#f4f5f7", border: "1px solid #e5e7eb" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <strong>Atelier Pro & Custom Domains</strong>
                  <span className="velora-sd-status-badge pending">Closed Beta</span>
                </div>
                <p style={{ fontSize: "13px", color: "#6b7280", margin: "8px 0 0 0" }}>
                  White-labeled domain integration, premium video banners, and dedicated logistics concierge will roll out to all active ateliers.
                </p>
              </div>
            </div>

            <div className="velora-sd-form-actions">
              <button
                type="button"
                className="velora-sd-btn-secondary"
                onClick={() => setShowUpgradeModal(false)}
              >
                Close
              </button>
              <button
                type="button"
                className="velora-sd-btn-primary"
                onClick={() => {
                  setNotice("You are already on the full-featured Standard Atelier tier.");
                  setShowUpgradeModal(false);
                }}
              >
                Got It
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Plugin Configuration Drawer/Modal */}
      {pluginConfigModal && (
        <div className="velora-sd-modal-backdrop">
          <div className="velora-sd-modal-content">
            <div className="velora-sd-modal-header">
              <h2 className="velora-sd-modal-title" style={{ textTransform: "capitalize" }}>
                Configure {pluginConfigModal.replace("_", " ")}
              </h2>
              <button
                type="button"
                className="velora-sd-modal-close"
                onClick={() => setPluginConfigModal(null)}
              >
                ×
              </button>
            </div>

            <form onSubmit={handleSavePluginConfig}>
              {pluginConfigModal === "whatsapp" && (
                <div className="velora-sd-form-group">
                  <label className="velora-sd-form-label">WhatsApp Business Phone Number *</label>
                  <input
                    type="tel"
                    required
                    className="velora-sd-form-input"
                    placeholder="+91 98765 43210"
                    value={pluginConfigInput.phone || ""}
                    onChange={(e) => setPluginConfigInput({ ...pluginConfigInput, phone: e.target.value })}
                  />
                </div>
              )}

              {pluginConfigModal === "google_analytics" && (
                <div className="velora-sd-form-group">
                  <label className="velora-sd-form-label">Google Analytics Measurement ID *</label>
                  <input
                    type="text"
                    required
                    className="velora-sd-form-input"
                    placeholder="G-XXXXXXXXXX"
                    value={pluginConfigInput.measurement_id || ""}
                    onChange={(e) => setPluginConfigInput({ ...pluginConfigInput, measurement_id: e.target.value })}
                  />
                </div>
              )}

              {pluginConfigModal === "shiprocket" && (
                <>
                  <div className="velora-sd-form-group">
                    <label className="velora-sd-form-label">Shiprocket API Email *</label>
                    <input
                      type="email"
                      required
                      className="velora-sd-form-input"
                      value={pluginConfigInput.email || ""}
                      onChange={(e) => setPluginConfigInput({ ...pluginConfigInput, email: e.target.value })}
                    />
                  </div>
                  <div className="velora-sd-form-group">
                    <label className="velora-sd-form-label">Shiprocket API Token *</label>
                    <PasswordInput
                      variant="seller"
                      required
                      value={pluginConfigInput.token || ""}
                      onChange={(e) => setPluginConfigInput({ ...pluginConfigInput, token: e.target.value })}
                    />
                  </div>
                </>
              )}

              {pluginConfigModal === "razorpay" && (
                <>
                  <div className="velora-sd-form-group">
                    <label className="velora-sd-form-label">Razorpay Key ID *</label>
                    <input
                      type="text"
                      required
                      className="velora-sd-form-input"
                      placeholder="rzp_live_xxxxxxxx"
                      value={pluginConfigInput.key_id || ""}
                      onChange={(e) => setPluginConfigInput({ ...pluginConfigInput, key_id: e.target.value })}
                    />
                  </div>
                  <div className="velora-sd-form-group">
                    <label className="velora-sd-form-label">Razorpay Key Secret *</label>
                    <PasswordInput
                      variant="seller"
                      required
                      value={pluginConfigInput.key_secret || ""}
                      onChange={(e) => setPluginConfigInput({ ...pluginConfigInput, key_secret: e.target.value })}
                    />
                  </div>
                </>
              )}

              <div className="velora-sd-form-actions">
                <button
                  type="button"
                  className="velora-sd-btn-secondary"
                  onClick={() => setPluginConfigModal(null)}
                >
                  Cancel
                </button>
                <button type="submit" className="velora-sd-btn-primary">
                  Save Configuration
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
