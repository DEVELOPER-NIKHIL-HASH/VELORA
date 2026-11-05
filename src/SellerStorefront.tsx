import { useState, useEffect, type CSSProperties, type FormEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import { launchRazorpayPayment, type CreatePaymentOrderResponse } from "./services/razorpay";

export type StoreProduct = {
  id: number;
  store_id: number;
  name: string;
  description: string;
  price: number;
  stock: number;
  image_url: string;
  category?: string;
  is_active: number;
  created_at?: string;
};

export type StoreInfo = {
  id: number;
  name: string;
  slug: string;
  description: string;
  ownerName: string;
  createdAt: string;
  announcement?: string;
  logoUrl?: string;
  logo_url?: string;
  bannerUrl?: string;
  banner_url?: string;
  themeColor?: string;
  theme_color?: string;
};

export type StoreCartItem = StoreProduct & {
  quantity: number;
};

const formatPrice = (price: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(price);

const DEFAULT_THEME_COLOR = "#D4AF37";

function resolveThemeColor(value?: string): string {
  let color = String(value || "").trim();
  if (/^#[0-9a-fA-F]{3}$/.test(color)) {
    color = `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`;
  }
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : DEFAULT_THEME_COLOR;
}

function storefrontAccentStyle(themeColor?: string): CSSProperties {
  return {
    ["--store-accent" as string]: resolveThemeColor(themeColor),
  };
}

export default function SellerStorefront({ slug }: { slug: string }) {
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [store, setStore] = useState<StoreInfo | null>(null);
  const [products, setProducts] = useState<StoreProduct[]>([]);
  const [categories, setCategories] = useState<string[]>(["All"]);
  const [selectedCategory, setSelectedCategory] = useState<string>("All");
  const [searchQuery, setSearchQuery] = useState("");

  const cartStorageKey = `velora_cart_${slug}`;
  const [cart, setCart] = useState<StoreCartItem[]>(() => {
    try {
      const saved = localStorage.getItem(cartStorageKey);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [cartOpen, setCartOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [checkoutError, setCheckoutError] = useState("");
  const [orderSuccess, setOrderSuccess] = useState(false);
  const [placedOrderId, setPlacedOrderId] = useState<number | null>(null);
  const [sandboxSim, setSandboxSim] = useState<{
    orderId: number;
    razorpay_order_id: string;
    amount: number;
    confirmSuccess: () => Promise<void>;
    simulateFailure: () => Promise<void>;
    simulateCancel: () => Promise<void>;
  } | null>(null);

  const [couponInput, setCouponInput] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState<{ code: string; amount: number } | null>(null);
  const [couponError, setCouponError] = useState("");
  const [validatingCoupon, setValidatingCoupon] = useState(false);
  const [copied, setCopied] = useState(false);

  // Sync cart to local storage
  useEffect(() => {
    try {
      localStorage.setItem(cartStorageKey, JSON.stringify(cart));
    } catch {
      // ignore storage write errors
    }
  }, [cart, cartStorageKey]);

  // Fetch store data
  useEffect(() => {
    let active = true;

    async function loadStore() {
      setLoading(true);
      setNotFound(false);
      try {
        const response = await fetch(`/api/stores/${encodeURIComponent(slug)}`);
        if (!response.ok) {
          if (response.status === 404) {
            if (active) setNotFound(true);
            return;
          }
          throw new Error("Failed to load store.");
        }

        const data = await response.json();
        if (active) {
          if (data.status === "success" && data.store) {
            setStore(data.store);
            setProducts(data.products || []);
            setCategories(data.categories || ["All"]);
          } else {
            setNotFound(true);
          }
        }
      } catch {
        if (active) setNotFound(true);
      } finally {
        if (active) setLoading(false);
      }
    }

    loadStore();
    return () => {
      active = false;
    };
  }, [slug]);

  // Cart operations
  const addToCart = (product: StoreProduct) => {
    if (product.stock <= 0) return;
    setCart((current) => {
      const existing = current.find((item) => item.id === product.id);
      if (existing) {
        if (existing.quantity >= product.stock) return current;
        return current.map((item) =>
          item.id === product.id
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
      }
      return [...current, { ...product, quantity: 1 }];
    });
  };

  const updateQuantity = (productId: number, delta: number) => {
    setCart((current) =>
      current
        .map((item) => {
          if (item.id === productId) {
            const nextQty = item.quantity + delta;
            if (nextQty <= 0) return null;
            if (nextQty > item.stock) return item;
            return { ...item, quantity: nextQty };
          }
          return item;
        })
        .filter((item): item is StoreCartItem => item !== null)
    );
  };

  const removeFromCart = (productId: number) => {
    setCart((current) => current.filter((item) => item.id !== productId));
  };

  const clearCart = () => {
    setCart([]);
  };

  // Calculations
  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const discountAmount = appliedCoupon ? appliedCoupon.amount : 0;
  const shipping = subtotal === 0 || subtotal >= 1999 ? 0 : 99;
  const total = Math.max(0, subtotal - discountAmount + shipping);

  const handleApplyCoupon = async () => {
    if (!couponInput.trim() || !store) return;
    setValidatingCoupon(true);
    setCouponError("");
    try {
      const res = await fetch(`/api/stores/${store.slug}/validate-discount`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: couponInput.trim(), subtotal }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Invalid coupon.");
      setAppliedCoupon({ code: data.code, amount: data.discountAmount });
      setCouponInput("");
    } catch (err) {
      setCouponError(err instanceof Error ? err.message : "Invalid coupon.");
      setAppliedCoupon(null);
    } finally {
      setValidatingCoupon(false);
    }
  };

  // Filter products
  const filteredProducts = products.filter((p) => {
    const matchesCategory =
      selectedCategory === "All" || (p.category || "General") === selectedCategory;
    const matchesSearch =
      searchQuery.trim() === "" ||
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.description.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  // Handle Share Store Link
  const handleCopyLink = () => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Handle Order Placement
  const handleCheckoutSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!store || cart.length === 0 || isSubmitting) return;

    setIsSubmitting(true);
    setCheckoutError("");

    const formData = new FormData(e.currentTarget);
    const customer_name = String(formData.get("name") || "").trim();
    const email = String(formData.get("email") || "").trim();
    const address = String(formData.get("address") || "").trim();

    try {
      // Step 1: Create payment order on backend (strictly calculated server-side in INR)
      const response = await fetch("/api/payments/create-order", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          customer_name,
          email,
          address,
          store_id: store.id,
          discount_code: appliedCoupon ? appliedCoupon.code : undefined,
          items: cart.map((item) => ({
            id: item.id,
            quantity: item.quantity,
          })),
        }),
      });

      const data: CreatePaymentOrderResponse = await response.json().catch(() => ({}));

      if (!response.ok || data.status !== "success") {
        throw new Error(data.message || `Order payment initiation failed (HTTP ${response.status}).`);
      }

      if (typeof data.orderId !== "number" || !Number.isFinite(data.orderId)) {
        throw new Error("Server response missing valid order ID.");
      }

      // Step 2: Launch Razorpay Checkout
      await launchRazorpayPayment({
        paymentOrder: data,
        storeName: store.name,
        themeColor: currentTheme,
        onSuccess: (verifyResult) => {
          setPlacedOrderId(verifyResult.orderId);
          setCart([]);
          try {
            localStorage.removeItem(cartStorageKey);
          } catch (storageErr) {
            console.debug("Cart storage clean error:", storageErr);
          }
          setCheckoutOpen(false);
          setCartOpen(false);
          setOrderSuccess(true);
          setIsSubmitting(false);
        },
        onFailure: (err) => {
          console.warn("Seller store payment error:", err);
          setCheckoutError(err.message || "Payment could not be completed. Please retry.");
          setIsSubmitting(false);
        },
        onDismiss: () => {
          setIsSubmitting(false);
        },
        onShowSandboxSimulation: (simDetails) => {
          setSandboxSim(simDetails);
          setIsSubmitting(false);
        },
      });
    } catch (err) {
      setCheckoutError(
        err instanceof Error ? err.message : "Failed to initiate payment. Please check connection."
      );
      setIsSubmitting(false);
    }
  };

  // 1. Loading View
  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] text-white flex flex-col items-center justify-center p-6" style={storefrontAccentStyle()}>
        <div className="w-12 h-12 rounded-full border-2 border-[var(--store-accent)] border-t-transparent animate-spin mb-4" />
        <p className="text-xs uppercase tracking-[0.3em] text-[var(--store-accent)]">
          Connecting to Seller Storefront...
        </p>
      </div>
    );
  }

  // 2. 404 Not Found View
  if (notFound || !store) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] text-white flex flex-col items-center justify-center p-6 text-center" style={storefrontAccentStyle()}>
        <div className="w-20 h-20 rounded-full border border-red-500/30 bg-red-950/20 flex items-center justify-center mb-6">
          <svg className="w-10 h-10 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h1 className="text-3xl font-serif text-[#f2efe9] mb-3">Store Not Found</h1>
        <p className="text-white/60 max-w-md text-sm mb-8 leading-relaxed">
          The seller store <span className="text-[var(--store-accent)] font-mono font-medium">/{slug}</span> does not exist or may have been deactivated.
        </p>
        <a
          href="/"
          className="inline-flex items-center gap-2 px-8 py-3.5 rounded-full bg-[var(--store-accent)] text-black text-xs font-semibold uppercase tracking-[0.2em] hover:brightness-110 transition"
        >
          <span>← Visit VELORA Marketplace</span>
        </a>
      </div>
    );
  }

  // 3. Seller Storefront
  const currentTheme = resolveThemeColor(store.themeColor || store.theme_color);
  const storeLogo = (store.logoUrl || store.logo_url || "").trim();

  const isSellerLoggedIn =
    typeof window !== "undefined" &&
    Boolean(sessionStorage.getItem("velora_seller_token")?.trim());
  const backHref = isSellerLoggedIn ? "/seller" : "/";
  const backTitle = isSellerLoggedIn ? "Return to Seller Dashboard" : "Return to VELORA Marketplace";
  const backLabel = isSellerLoggedIn ? "Dashboard" : "VELORA";

  return (
    <div
      className="min-h-screen bg-[#0c0c0c] text-[#f2efe9] flex flex-col font-sans selection:bg-[var(--store-accent)] selection:text-black"
      style={storefrontAccentStyle(currentTheme)}
    >
      {store.announcement && (
        <div className="bg-[var(--store-accent)] text-black text-center py-2 px-4 text-xs font-semibold tracking-wide">
          {store.announcement}
        </div>
      )}

      {/* Top Banner & Navigation */}
      <header className="sticky top-0 z-40 bg-[#0c0c0c]/90 backdrop-blur-md border-b border-[#25221b]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <a
              href={backHref}
              className="text-white/50 hover:text-white transition flex items-center gap-1.5 text-xs font-medium tracking-wider uppercase"
              title={backTitle}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              <span className="hidden sm:inline">{backLabel}</span>
            </a>
            <div className="h-4 w-[1px] bg-white/20 hidden sm:block" />
            <div className="flex items-center gap-3">
              <div className="relative w-10 h-10 rounded-full overflow-hidden bg-[color-mix(in_srgb,var(--store-accent)_18%,#151412)] border border-[color-mix(in_srgb,var(--store-accent)_50%,transparent)] flex items-center justify-center text-sm font-serif font-bold text-[var(--store-accent)] shadow-inner shrink-0">
                <span>{(store.name || "V").charAt(0).toUpperCase()}</span>
                {storeLogo ? (
                  <img
                    src={storeLogo}
                    alt={`${store.name} logo`}
                    className="absolute inset-0 w-full h-full object-cover"
                    onError={(e) => {
                      e.currentTarget.style.display = "none";
                    }}
                  />
                ) : null}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-base sm:text-lg font-medium text-white tracking-wide">
                    {store.name}
                  </h1>
                  <span className="inline-flex items-center gap-1 text-[10px] uppercase font-semibold tracking-wider px-2 py-0.5 rounded-full bg-[color-mix(in_srgb,var(--store-accent)_15%,transparent)] text-[var(--store-accent)] border border-[color-mix(in_srgb,var(--store-accent)_30%,transparent)]">
                    <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    Verified Store
                  </span>
                </div>
                <p className="text-[11px] text-white/50 truncate max-w-xs sm:max-w-md">
                  Merchant: {store.ownerName}
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleCopyLink}
              type="button"
              className="hidden md:inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full border border-white/15 bg-white/5 text-xs text-white/80 hover:bg-white/10 transition"
              title="Copy store link to share"
            >
              <svg className="w-3.5 h-3.5 text-[var(--store-accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              <span>{copied ? "Link Copied!" : "Share Store"}</span>
            </button>

            <button
              onClick={() => setCartOpen(true)}
              type="button"
              className="relative flex items-center gap-2 px-4 py-2 rounded-full bg-[var(--store-accent)] text-black font-semibold text-xs tracking-wider uppercase hover:brightness-110 transition shadow-lg shadow-[color-mix(in_srgb,var(--store-accent)_10%,transparent)]"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
              </svg>
              <span>Cart</span>
              {cartCount > 0 && (
                <span className="w-5 h-5 rounded-full bg-black text-[var(--store-accent)] text-[11px] flex items-center justify-center font-bold">
                  {cartCount}
                </span>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Hero / Store Branding Header */}
      <section className="relative overflow-hidden bg-gradient-to-b from-[#14120e] via-[#0f0e0c] to-[#0c0c0c] border-b border-[#201d16] py-12 md:py-16">
        <div className="absolute inset-0 opacity-15 pointer-events-none bg-[radial-gradient(var(--store-accent)_1px,transparent_1px)] [background-size:24px_24px]" />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="max-w-3xl">
            <span className="inline-block text-[11px] uppercase tracking-[0.35em] text-[var(--store-accent)] font-medium mb-3">
              Independent Storefront · Powered by VELORA
            </span>
            <div className="flex items-center gap-4 mb-4">
              <div className="relative w-16 h-16 sm:w-20 sm:h-20 rounded-2xl overflow-hidden bg-[color-mix(in_srgb,var(--store-accent)_18%,#151412)] border border-[color-mix(in_srgb,var(--store-accent)_40%,transparent)] flex items-center justify-center text-2xl sm:text-3xl font-serif font-bold text-[var(--store-accent)] shadow-xl shrink-0">
                <span>{(store.name || "V").charAt(0).toUpperCase()}</span>
                {storeLogo ? (
                  <img
                    src={storeLogo}
                    alt={`${store.name} logo`}
                    className="absolute inset-0 w-full h-full object-cover"
                    onError={(e) => {
                      e.currentTarget.style.display = "none";
                    }}
                  />
                ) : null}
              </div>
              <div>
                <h2 className="text-3xl sm:text-4xl md:text-5xl font-serif text-white tracking-tight">
                  {store.name}
                </h2>
                {store.ownerName && (
                  <p className="text-xs text-white/50 mt-1">
                    Merchant: <span className="text-white/80">{store.ownerName}</span>
                  </p>
                )}
              </div>
            </div>
            <p className="text-sm sm:text-base text-white/70 leading-relaxed font-light mb-6">
              {store.description || "Welcome to our public boutique. Discover handcrafted and curated pieces directly from our studio."}
            </p>
            <div className="flex flex-wrap items-center gap-4 text-xs text-white/50">
              <span className="flex items-center gap-1.5">
                <svg className="w-4 h-4 text-[var(--store-accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                </svg>
                Active Catalogue: {products.length} {products.length === 1 ? "Product" : "Products"}
              </span>
              <span>·</span>
              <span className="flex items-center gap-1.5">
                <svg className="w-4 h-4 text-[var(--store-accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
                Secure Checkout & Direct Fulfillment
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Main Content & Products Section */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 flex-1 w-full">
        {/* Search & Categories Bar */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8 pb-6 border-b border-white/10">
          {/* Categories */}
          <div className="flex items-center gap-2 overflow-x-auto pb-2 md:pb-0 scrollbar-none">
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCategory(cat)}
                className={`px-4 py-2 rounded-full text-xs font-medium uppercase tracking-wider whitespace-nowrap transition ${
                  selectedCategory === cat
                    ? "bg-[var(--store-accent)] text-black font-semibold shadow-md"
                    : "bg-white/5 text-white/70 hover:bg-white/10 hover:text-white border border-white/10"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Search Input */}
          <div className="relative w-full md:w-72">
            <input
              type="text"
              placeholder="Search store catalogue..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-white/5 border border-white/15 rounded-full px-4 py-2 pl-10 text-xs text-white placeholder-white/40 focus:outline-none focus:border-[var(--store-accent)] transition"
            />
            <svg
              className="w-4 h-4 text-white/40 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
        </div>

        {/* Product Grid */}
        {filteredProducts.length === 0 ? (
          <div className="py-20 text-center border border-white/10 rounded-2xl bg-white/[0.02]">
            <svg className="w-12 h-12 mx-auto text-white/20 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
            <h3 className="text-lg font-serif text-white/90 mb-1">No products found</h3>
            <p className="text-xs text-white/50 max-w-sm mx-auto">
              {searchQuery || selectedCategory !== "All"
                ? "Try adjusting your search or category filter to discover available items."
                : "This seller has not listed any active products yet. Check back soon!"}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {filteredProducts.map((product) => {
              const inCartItem = cart.find((item) => item.id === product.id);
              const inStock = product.stock > 0;

              return (
                <div
                  key={product.id}
                  className="group flex flex-col bg-[#131210] border border-[#23201a] hover:border-[color-mix(in_srgb,var(--store-accent)_50%,transparent)] rounded-2xl overflow-hidden transition-all duration-300 shadow-md hover:shadow-xl hover:shadow-black/50"
                >
                  {/* Product Image / Placeholder */}
                  <div className="relative aspect-square w-full bg-[#1c1913] overflow-hidden flex items-center justify-center border-b border-white/5">
                    {product.image_url ? (
                      <img
                        src={product.image_url}
                        alt={product.name}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                        loading="lazy"
                        onError={(e) => {
                          e.currentTarget.style.display = "none";
                          const fallback = e.currentTarget.nextElementSibling as HTMLElement | null;
                          if (fallback) fallback.style.display = "flex";
                        }}
                      />
                    ) : null}
                    <div
                      className="flex flex-col items-center justify-center p-6 text-center"
                      style={{ display: product.image_url ? "none" : "flex" }}
                    >
                        <div className="w-16 h-16 rounded-2xl bg-[color-mix(in_srgb,var(--store-accent)_15%,#171614)] border border-[color-mix(in_srgb,var(--store-accent)_30%,transparent)] flex items-center justify-center text-[var(--store-accent)] mb-2 group-hover:border-[var(--store-accent)] transition">
                          <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                          </svg>
                        </div>
                        <span className="text-[10px] uppercase tracking-widest text-white/40">
                          {product.category || "Velora Item"}
                        </span>
                      </div>

                    {/* Stock Tag */}
                    <div className="absolute top-3 right-3">
                      {!inStock ? (
                        <span className="px-2.5 py-1 rounded-full bg-red-950/80 border border-red-500/40 text-[10px] uppercase font-semibold tracking-wider text-red-300 backdrop-blur-sm">
                          Out of Stock
                        </span>
                      ) : product.stock <= 3 ? (
                        <span className="px-2.5 py-1 rounded-full bg-amber-950/80 border border-amber-500/40 text-[10px] uppercase font-semibold tracking-wider text-amber-300 backdrop-blur-sm">
                          Only {product.stock} left
                        </span>
                      ) : (
                        <span className="px-2.5 py-1 rounded-full bg-emerald-950/80 border border-emerald-500/40 text-[10px] uppercase font-semibold tracking-wider text-emerald-300 backdrop-blur-sm">
                          In Stock
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Product Details */}
                  <div className="p-5 flex-1 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <span className="text-[10px] uppercase font-medium tracking-widest text-[var(--store-accent)]">
                          {product.category || "General"}
                        </span>
                      </div>
                      <h3 className="text-base font-medium text-white group-hover:text-[var(--store-accent)] transition-colors leading-snug mb-2 line-clamp-1">
                        {product.name}
                      </h3>
                      <p className="text-xs text-white/60 line-clamp-2 leading-relaxed mb-4">
                        {product.description || "Crafted to high standards of quality and detail."}
                      </p>
                    </div>

                    <div className="pt-3 border-t border-white/5 flex items-center justify-between gap-3">
                      <div>
                        <span className="text-[10px] uppercase tracking-wider text-white/40 block">Price</span>
                        <span className="text-lg font-serif font-medium text-white">
                          {formatPrice(product.price)}
                        </span>
                      </div>

                      {/* Add to Cart / Quantity controls */}
                      {inCartItem ? (
                        <div className="flex items-center gap-2 bg-white/10 border border-white/15 rounded-full px-2 py-1">
                          <button
                            type="button"
                            onClick={() => updateQuantity(product.id, -1)}
                            className="w-6 h-6 rounded-full flex items-center justify-center text-white/80 hover:text-white hover:bg-white/10 transition text-sm font-bold"
                          >
                            −
                          </button>
                          <span className="text-xs font-semibold px-1 text-[var(--store-accent)]">
                            {inCartItem.quantity}
                          </span>
                          <button
                            type="button"
                            onClick={() => updateQuantity(product.id, 1)}
                            disabled={inCartItem.quantity >= product.stock}
                            className="w-6 h-6 rounded-full flex items-center justify-center text-white/80 hover:text-white hover:bg-white/10 transition text-sm font-bold disabled:opacity-30 disabled:cursor-not-allowed"
                          >
                            +
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => addToCart(product)}
                          disabled={!inStock}
                          className="px-4 py-2 rounded-full bg-[var(--store-accent)] text-black text-xs font-semibold uppercase tracking-wider hover:brightness-110 transition disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          Add to Cart
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Cart Drawer */}
      <AnimatePresence>
        {cartOpen && (
          <div className="fixed inset-0 z-50 overflow-hidden">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setCartOpen(false)}
              className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            />
            <div className="fixed inset-y-0 right-0 max-w-full flex pl-10">
              <motion.div
                initial={{ x: "100%" }}
                animate={{ x: 0 }}
                exit={{ x: "100%" }}
                transition={{ type: "spring", damping: 25, stiffness: 200 }}
                className="w-screen max-w-md bg-[#11100e] border-l border-[#28241b] text-white flex flex-col shadow-2xl"
              >
                {/* Drawer Header */}
                <div className="p-6 border-b border-white/10 flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-serif text-white tracking-wide">
                      Your Shopping Bag
                    </h2>
                    <span className="text-xs text-white/50">{store.name}</span>
                  </div>
                  <button
                    onClick={() => setCartOpen(false)}
                    type="button"
                    className="w-8 h-8 rounded-full border border-white/10 flex items-center justify-center text-white/60 hover:text-white hover:bg-white/5 transition"
                  >
                    ✕
                  </button>
                </div>

                {/* Drawer Items */}
                <div className="flex-1 overflow-y-auto p-6 space-y-4">
                  {cart.length === 0 ? (
                    <div className="text-center py-20 text-white/40">
                      <svg className="w-12 h-12 mx-auto mb-3 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                      </svg>
                      <p className="text-sm">Your shopping bag is empty.</p>
                      <button
                        onClick={() => setCartOpen(false)}
                        type="button"
                        className="mt-4 px-6 py-2 rounded-full border border-[color-mix(in_srgb,var(--store-accent)_50%,transparent)] text-[var(--store-accent)] text-xs uppercase tracking-wider hover:bg-[color-mix(in_srgb,var(--store-accent)_10%,transparent)] transition"
                      >
                        Browse Products
                      </button>
                    </div>
                  ) : (
                    cart.map((item) => (
                      <div
                        key={item.id}
                        className="flex gap-4 p-3 rounded-xl bg-white/[0.03] border border-white/5 items-center"
                      >
                        <div className="w-16 h-16 rounded-lg bg-black/40 border border-white/10 overflow-hidden flex-shrink-0 flex items-center justify-center">
                          {item.image_url ? (
                            <img src={item.image_url} alt={item.name} className="w-full h-full object-cover" />
                          ) : (
                            <span className="text-xs font-serif text-[var(--store-accent)]">
                              {item.name.charAt(0)}
                            </span>
                          )}
                        </div>

                        <div className="flex-1 min-w-0">
                          <h4 className="text-sm font-medium text-white truncate">{item.name}</h4>
                          <span className="text-xs text-[var(--store-accent)] font-serif block">
                            {formatPrice(item.price)}
                          </span>

                          <div className="flex items-center gap-3 mt-2">
                            <div className="flex items-center gap-1.5 border border-white/15 rounded-full px-2 py-0.5 bg-black/40">
                              <button
                                type="button"
                                onClick={() => updateQuantity(item.id, -1)}
                                className="w-4 h-4 flex items-center justify-center text-xs text-white/70 hover:text-white"
                              >
                                −
                              </button>
                              <span className="text-xs font-medium px-1">{item.quantity}</span>
                              <button
                                type="button"
                                onClick={() => updateQuantity(item.id, 1)}
                                disabled={item.quantity >= item.stock}
                                className="w-4 h-4 flex items-center justify-center text-xs text-white/70 hover:text-white disabled:opacity-30"
                              >
                                +
                              </button>
                            </div>

                            <button
                              type="button"
                              onClick={() => removeFromCart(item.id)}
                              className="text-[11px] text-red-400/80 hover:text-red-300 transition"
                            >
                              Remove
                            </button>
                          </div>
                        </div>

                        <div className="text-right">
                          <span className="text-sm font-serif font-medium text-white">
                            {formatPrice(item.price * item.quantity)}
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {/* Drawer Footer */}
                {cart.length > 0 && (
                  <div className="p-6 border-t border-white/10 bg-black/30 space-y-3">
                    <div className="flex justify-between text-xs text-white/60">
                      <span>Subtotal</span>
                      <span>{formatPrice(subtotal)}</span>
                    </div>
                    <div className="flex justify-between text-xs text-white/60">
                      <span>Shipping</span>
                      <span>{shipping === 0 ? "Free Shipping" : formatPrice(shipping)}</span>
                    </div>
                    <div className="flex justify-between text-sm font-serif font-medium text-white pt-2 border-t border-white/10">
                      <span>Total</span>
                      <span className="text-lg text-[var(--store-accent)]">{formatPrice(total)}</span>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setCheckoutOpen(true);
                      }}
                      className="w-full py-3.5 rounded-full bg-[var(--store-accent)] text-black text-xs font-semibold uppercase tracking-[0.2em] hover:brightness-110 transition shadow-lg mt-2"
                    >
                      Proceed to Checkout
                    </button>
                    <button
                      type="button"
                      onClick={clearCart}
                      className="w-full text-center text-[11px] text-white/40 hover:text-white/70 transition"
                    >
                      Clear Bag
                    </button>
                  </div>
                )}
              </motion.div>
            </div>
          </div>
        )}
      </AnimatePresence>

      {/* Checkout Modal */}
      <AnimatePresence>
        {checkoutOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setCheckoutOpen(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative w-full max-w-lg bg-[#14120e] border border-[#312b1e] rounded-2xl p-6 sm:p-8 text-white shadow-2xl max-h-[90vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between pb-4 border-b border-white/10 mb-6">
                <div>
                  <h3 className="text-xl font-serif text-white">Complete Your Order</h3>
                  <p className="text-xs text-[var(--store-accent)]">{store.name}</p>
                </div>
                <button
                  onClick={() => setCheckoutOpen(false)}
                  className="w-8 h-8 rounded-full border border-white/10 flex items-center justify-center text-white/60 hover:text-white"
                >
                  ✕
                </button>
              </div>

              {checkoutError && (
                <div className="mb-4 p-3.5 rounded-xl bg-red-950/50 border border-red-500/40 text-xs text-red-200">
                  {checkoutError}
                </div>
              )}

              <form onSubmit={handleCheckoutSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium uppercase tracking-wider text-white/70 mb-1.5">
                    Full Name *
                  </label>
                  <input
                    type="text"
                    name="name"
                    required
                    placeholder="e.g. John Doe"
                    className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/15 text-sm text-white placeholder-white/30 focus:outline-none focus:border-[var(--store-accent)]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium uppercase tracking-wider text-white/70 mb-1.5">
                    Email Address *
                  </label>
                  <input
                    type="email"
                    name="email"
                    required
                    placeholder="e.g. buyer@example.com"
                    className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/15 text-sm text-white placeholder-white/30 focus:outline-none focus:border-[var(--store-accent)]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium uppercase tracking-wider text-white/70 mb-1.5">
                    Shipping & Contact Notes
                  </label>
                  <textarea
                    name="address"
                    rows={2}
                    placeholder="Delivery address and contact phone number..."
                    className="w-full px-4 py-2 rounded-xl bg-white/5 border border-white/15 text-sm text-white placeholder-white/30 focus:outline-none focus:border-[var(--store-accent)]"
                  />
                </div>

                {/* Coupon Code Input */}
                <div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="PROMO / COUPON CODE"
                      value={couponInput}
                      onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                      className="flex-1 px-3.5 py-2 rounded-xl bg-white/5 border border-white/15 text-xs text-white uppercase placeholder-white/30 focus:outline-none focus:border-[var(--store-accent)]"
                    />
                    <button
                      type="button"
                      disabled={validatingCoupon || !couponInput.trim()}
                      onClick={handleApplyCoupon}
                      className="px-4 py-2 rounded-xl bg-[color-mix(in_srgb,var(--store-accent)_15%,transparent)] hover:bg-[color-mix(in_srgb,var(--store-accent)_25%,transparent)] text-xs font-semibold text-[var(--store-accent)] border border-[color-mix(in_srgb,var(--store-accent)_30%,transparent)] transition disabled:opacity-40"
                    >
                      {validatingCoupon ? "..." : "Apply"}
                    </button>
                  </div>
                  {couponError && <p className="text-[11px] text-red-400 mt-1">{couponError}</p>}
                  {appliedCoupon && (
                    <p className="text-[11px] text-green-400 mt-1">
                      ✓ Coupon "{appliedCoupon.code}" applied (-{formatPrice(appliedCoupon.amount)})
                    </p>
                  )}
                </div>

                {/* Summary Box */}
                <div className="p-4 rounded-xl bg-black/40 border border-white/10 space-y-2 text-xs">
                  <div className="flex justify-between text-white/60">
                    <span>Items ({cartCount})</span>
                    <span>{formatPrice(subtotal)}</span>
                  </div>
                  {appliedCoupon && (
                    <div className="flex justify-between text-green-400">
                      <span>Discount ({appliedCoupon.code})</span>
                      <span>-{formatPrice(appliedCoupon.amount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-white/60">
                    <span>Shipping</span>
                    <span>{shipping === 0 ? "Free" : formatPrice(shipping)}</span>
                  </div>
                  <div className="flex justify-between font-serif text-sm font-semibold text-white pt-2 border-t border-white/10">
                    <span>Total Due</span>
                    <span className="text-[var(--store-accent)]">{formatPrice(total)}</span>
                  </div>
                  <div className="flex items-center justify-between pt-1 text-[11px] text-white/50">
                    <span className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block"></span>
                      Razorpay Gateway
                    </span>
                    <span className="text-[10px] text-[var(--store-accent)] font-medium uppercase tracking-wider">Secure INR</span>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-3.5 rounded-full bg-[var(--store-accent)] text-black text-xs font-semibold uppercase tracking-[0.2em] hover:brightness-110 transition shadow-lg disabled:opacity-50 flex items-center justify-center gap-2 mt-4"
                >
                  {isSubmitting ? (
                    <>
                      <div className="w-4 h-4 rounded-full border-2 border-black border-t-transparent animate-spin" />
                      <span>Verifying & Placing Order...</span>
                    </>
                  ) : (
                    <span>Pay with Razorpay ({formatPrice(total)})</span>
                  )}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Razorpay Sandbox Test Simulation Sheet */}
      <AnimatePresence>
        {sandboxSim && (
          <div className="fixed inset-0 z-[250] flex items-center justify-center bg-black/85 backdrop-blur-sm p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="max-w-sm w-full bg-[#18181b] border border-[var(--store-accent)] rounded-2xl p-6 text-white text-center shadow-2xl"
            >
              <span className="inline-block px-2.5 py-1 rounded-full bg-[color-mix(in_srgb,var(--store-accent)_20%,transparent)] text-[var(--store-accent)] text-[10px] font-semibold tracking-wider uppercase mb-2">
                Razorpay Test Sandbox
              </span>
              <h3 className="text-lg font-serif">Simulate Gateway Payment</h3>
              <p className="text-xs text-white/60 mt-1">
                Order #{sandboxSim.orderId} &middot; {formatPrice(sandboxSim.amount / 100)}
              </p>
              <div className="mt-5 space-y-2.5">
                <button
                  type="button"
                  onClick={async () => {
                    const confirm = sandboxSim.confirmSuccess;
                    setSandboxSim(null);
                    await confirm();
                  }}
                  className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium transition cursor-pointer"
                >
                  ✓ Simulate Payment Success
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const fail = sandboxSim.simulateFailure;
                    setSandboxSim(null);
                    await fail();
                  }}
                  className="w-full py-2.5 rounded-xl bg-red-600/80 hover:bg-red-600 text-white text-xs font-medium transition cursor-pointer"
                >
                  ✕ Simulate Payment Failure
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const cancel = sandboxSim.simulateCancel;
                    setSandboxSim(null);
                    await cancel();
                  }}
                  className="w-full py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white/80 text-xs transition cursor-pointer"
                >
                  Cancel Payment
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Order Success Modal */}
      <AnimatePresence>
        {orderSuccess && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/85 backdrop-blur-md"
            />
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="relative w-full max-w-md bg-[#14120e] border border-[color-mix(in_srgb,var(--store-accent)_40%,transparent)] rounded-2xl p-8 text-center text-white shadow-2xl"
            >
              <div className="w-16 h-16 rounded-full bg-[color-mix(in_srgb,var(--store-accent)_20%,transparent)] border border-[var(--store-accent)] flex items-center justify-center text-[var(--store-accent)] mx-auto mb-4">
                <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>

              <span className="text-[10px] uppercase tracking-[0.3em] text-[var(--store-accent)] font-semibold">
                Order Confirmed
              </span>
              <h3 className="text-2xl font-serif text-white mt-1 mb-2">
                Thank you for your order!
              </h3>
              <p className="text-xs text-white/70 leading-relaxed mb-6">
                Your order has been recorded directly with{" "}
                <span className="text-[var(--store-accent)] font-medium">{store.name}</span>.
                The seller has been notified for fulfillment.
              </p>

              <div className="p-4 rounded-xl bg-black/50 border border-white/10 mb-6 text-left space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-white/50">Order Reference:</span>
                  <span className="font-mono font-bold text-[var(--store-accent)]">#{placedOrderId}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-white/50">Payment:</span>
                  <span className="text-emerald-400 font-medium flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block animate-pulse"></span>
                    Verified via Razorpay
                  </span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-white/50">Fulfillment:</span>
                  <span className="text-white/80 font-medium">Queued for Delivery</span>
                </div>
              </div>

              <div className="space-y-3">
                <a
                  href="/track-order"
                  className="block w-full py-3 rounded-full bg-white/10 hover:bg-white/15 border border-white/20 text-xs font-semibold uppercase tracking-wider text-white transition"
                >
                  Track Your Order
                </a>
                <button
                  type="button"
                  onClick={() => setOrderSuccess(false)}
                  className="block w-full py-2.5 text-xs text-[var(--store-accent)] hover:underline"
                >
                  Back to {store.name}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Footer */}
      <footer className="border-t border-[#221f18] bg-[#090807] py-8 text-center text-xs text-white/40">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p>© {new Date().getFullYear()} {store.name}. All rights reserved.</p>
          <a
            href="/"
            className="flex items-center gap-1.5 text-white/50 hover:text-[var(--store-accent)] transition font-medium tracking-wider uppercase text-[11px]"
          >
            <span>Powered by VELORA Platform</span>
            <span>↗</span>
          </a>
        </div>
      </footer>
    </div>
  );
}
