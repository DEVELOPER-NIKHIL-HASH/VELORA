import VeloraLoader from "./VeloraLoader"
import VeloraCursor from "./VeloraCursor"
import VeloraImage from "./VeloraImage"

import { AnimatePresence, motion } from "motion/react"
import { useState, useEffect, useRef, type FormEvent, type ReactNode } from "react"
import AdminDashboard from "./AdminDashboard"
import TrackOrder from "./TrackOrder"
import SellerDashboard from "./SellerDashboard"
import SellerRegistrationModal from "./SellerRegistrationModal"
import SellerStorefront from "./SellerStorefront"
import CustomerAuthModal from "./CustomerAuthModal"
import {
  type CustomerUser,
  getStoredCustomer,
  subscribeToCustomerAuth,
  fetchCurrentCustomer,
  logoutCustomer
} from "./services/customerAuth"
import { launchRazorpayPayment, type CreatePaymentOrderResponse } from "./services/razorpay"


import headphones from "./assets/products/headphones.jpg"
import watch from "./assets/products/watch.jpg"
import backpack from "./assets/products/backpack.jpg"

export type Product = {
  id: number
  name: string
  category: string
  price: number
  oldPrice: number
  discount: number
  image: string
  description: string
  details?: string[]
}

export type CartItem = Product & { quantity: number }

export type OrderResponse = {
  status?: string
  message?: string
  orderId?: number
}

export const API_BASE = "/api"
export const API_URL = `${API_BASE}/orders`

const initialProducts: Product[] = [
  {
    id: 1,
    name: "Aura Wireless Headphones",
    category: "Audio & Acoustics",
    price: 1999,
    oldPrice: 3499,
    discount: 43,
    image: headphones,
    description: "Architectural acoustic engineering with an anodized aluminum finish and precision planar drivers.",
    details: ["Active Noise Cancellation", "42-hour continuous battery", "Custom gold-plated connectors"]
  },
  {
    id: 2,
    name: "Minimal Smart Watch",
    category: "Horology & Wearables",
    price: 2499,
    oldPrice: 4999,
    discount: 50,
    image: watch,
    description: "Understated horology featuring sapphire crystal, aerospace-grade titanium casing, and subtle haptics.",
    details: ["Sapphire crystal face", "Grade 5 titanium alloy", "Water-resistant to 50 meters"]
  },
  {
    id: 3,
    name: "Premium Everyday Backpack",
    category: "Leather & Carry",
    price: 1299,
    oldPrice: 2199,
    discount: 41,
    image: backpack,
    description: "Sculpted full-grain calfskin and weather-resistant canvas designed for the discerning traveler.",
    details: ["Reinforced waterproof canvas", "Modular magnetic closures", "Dedicated 16-inch laptop chamber"]
  },
]

const formatPrice = (price: number) =>
  `₹${price.toLocaleString("en-IN")}`

function AnimatedButton({
  children,
  onClick,
  type = "button",
  className = "",
  disabled = false,
}: {
  children: ReactNode
  onClick?: () => void
  type?: "button" | "submit"
  className?: string
  disabled?: boolean
}) {
  return (
    <motion.button
      type={type}
      onClick={onClick}
      disabled={disabled}
      whileHover={disabled ? undefined : { scale: 1.015 }}
      whileTap={disabled ? undefined : { scale: 0.985 }}
      className={`transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    >
      {children}
    </motion.button>
  )
}

function Storefront() {
  // Theme state: "light" | "dark"
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("velora_theme")
      if (saved === "light" || saved === "dark") return saved
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
    }
    return "dark"
  })

  // Theme modal visibility: Only show on first visit if no preference is saved
  const [showThemeModal, setShowThemeModal] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("velora_theme") === null
    }
    return false
  })

  // Apply theme class to documentElement
  useEffect(() => {
    if (theme === "dark") {
      document.documentElement.classList.add("dark")
    } else {
      document.documentElement.classList.remove("dark")
    }
  }, [theme])

  const selectTheme = (selected: "light" | "dark") => {
    setTheme(selected)
    localStorage.setItem("velora_theme", selected)
    setShowThemeModal(false)
  }

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark"
    setTheme(next)
    localStorage.setItem("velora_theme", next)
  }


  // Seller Registration modal state
  const [showSellerModal, setShowSellerModal] = useState(() => {
    if (typeof window !== "undefined") {
      return window.location.search.includes("register=seller")
    }
    return false
  })
  const [isCtaOpening, setIsCtaOpening] = useState(false)

  const handleGetStartClick = () => {
    if (isCtaOpening) return
    setIsCtaOpening(true)
    window.setTimeout(() => {
      setIsCtaOpening(false)
      setShowSellerModal(true)
    }, 220)
  }

  // Cart & UI states
  const [cart, setCart] = useState<CartItem[]>([])
  const [cartOpen, setCartOpen] = useState(false)
  const [checkoutOpen, setCheckoutOpen] = useState(false)
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [addingProductId, setAddingProductId] = useState<number | null>(null)


  // Search & Navigation states
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [selectedCategory, setSelectedCategory] = useState<string>("All")

  // Checkout submission states
  const [orderSuccess, setOrderSuccess] = useState(false)
  const [orderId, setOrderId] = useState<number | null>(null)
  const [orderError, setOrderError] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [sandboxSim, setSandboxSim] = useState<{
    orderId: number
    razorpay_order_id: string
    amount: number
    confirmSuccess: () => Promise<void>
    simulateFailure: () => Promise<void>
    simulateCancel: () => Promise<void>
  } | null>(null)

  const [accountMenuRef] = [useRef<HTMLDivElement>(null)]
  const [showCustomerModal, setShowCustomerModal] = useState(false)
  const [customer, setCustomer] = useState<CustomerUser | null>(() => getStoredCustomer())

  // Synchronize customer auth state
  useEffect(() => {
    const unsubscribe = subscribeToCustomerAuth((updated) => {
      setCustomer(updated)
    })
    void fetchCurrentCustomer().then((res) => {
      if (res?.customer) {
        setCustomer(res.customer)
      }
    })
    return unsubscribe
  }, [])

  // Close account dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (accountMenuRef.current && !accountMenuRef.current.contains(event.target as Node)) {
        setAccountMenuOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  // Cart calculations
  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0)
  const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0)
  const shipping = subtotal === 0 || subtotal >= 1999 ? 0 : 99
  const total = subtotal + shipping

  const categories = ["All", "Audio & Acoustics", "Horology & Wearables", "Leather & Carry"]

  // Filtered products
  const filteredProducts = initialProducts.filter((product) => {
    const matchesCategory = selectedCategory === "All" || product.category === selectedCategory
    const matchesSearch =
      searchQuery.trim() === "" ||
      product.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      product.description.toLowerCase().includes(searchQuery.toLowerCase())
    return matchesCategory && matchesSearch
  })

  async function addToCart(product: Product) {
    if (addingProductId !== null) return
    setAddingProductId(product.id)
    await new Promise((resolve) => setTimeout(resolve, 300))

    setCart((current) => {
      const existing = current.find((item) => item.id === product.id)
      if (existing) {
        return current.map((item) =>
          item.id === product.id
            ? { ...item, quantity: Math.min(item.quantity + 1, 10) }
            : item
        )
      }
      return [...current, { ...product, quantity: 1 }]
    })

    setAddingProductId(null)
    setCartOpen(true)
    setSelectedProduct(null)
  }

  function buyNow(product: Product) {
    setCart([{ ...product, quantity: 1 }])
    setSelectedProduct(null)
    setCartOpen(false)
    setOrderError("")
    setCheckoutOpen(true)
  }

  function changeQuantity(id: number, amount: number) {
    setCart((current) =>
      current
        .map((item) =>
          item.id === id
            ? { ...item, quantity: Math.max(0, Math.min(10, item.quantity + amount)) }
            : item
        )
        .filter((item) => item.quantity > 0)
    )
  }

  function removeItem(id: number) {
    setCart((current) => current.filter((item) => item.id !== id))
  }

  async function placeOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isSubmitting || cart.length === 0) return

    setOrderError("")
    setIsSubmitting(true)
    const formData = new FormData(event.currentTarget)

    try {
      // Step 1: Create Payment Order on backend (Amount calculated server-side in INR)
      const response = await fetch("/api/payments/create-order", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          customer_name: String(formData.get("name") ?? "").trim(),
          email: String(formData.get("email") ?? "").trim(),
          phone: String(formData.get("phone") ?? "").trim(),
          address: String(formData.get("address") ?? "").trim(),
          city: String(formData.get("city") ?? "").trim(),
          pincode: String(formData.get("pincode") ?? "").trim(),
          items: cart.map((item) => ({
            id: item.id,
            quantity: item.quantity,
          })),
        }),
      })

      const data: CreatePaymentOrderResponse = await response.json().catch(() => ({}))

      if (!response.ok || data.status !== "success") {
        throw new Error(data.message || `Payment order initiation failed (HTTP ${response.status}).`)
      }

      if (typeof data.orderId !== "number" || !Number.isFinite(data.orderId)) {
        throw new Error("Server response missing valid VELORA order ID.")
      }

      // Step 2: Open Razorpay Checkout modal
      await launchRazorpayPayment({
        paymentOrder: data,
        storeName: "VELORA Marketplace",
        themeColor: "#D4AF37",
        onSuccess: (verifyResult) => {
          setOrderId(verifyResult.orderId)
          setCheckoutOpen(false)
          setCart([])
          setCartOpen(false)
          setOrderSuccess(true)
          setIsSubmitting(false)
        },
        onFailure: (err) => {
          console.warn("Payment error:", err)
          setOrderError(err.message || "Payment could not be completed. Please retry.")
          setIsSubmitting(false)
        },
        onDismiss: () => {
          setIsSubmitting(false)
        },
        onShowSandboxSimulation: (simDetails) => {
          setSandboxSim(simDetails)
          setIsSubmitting(false)
        },
      })
    } catch (error) {
      console.error("VELORA payment initiation error:", error)
      setOrderError(
        error instanceof TypeError
          ? "Unable to connect to VELORA backend. Please ensure the server is running."
          : error instanceof Error
            ? error.message
            : "Payment order could not be created. Please retry."
      )
      setIsSubmitting(false)
    }
  }

  function closeCheckout() {
    if (isSubmitting) return
    setCheckoutOpen(false)
    setOrderError("")
  }

  return (
    <div className={`min-h-screen transition-colors duration-300 ${theme === "dark" ? "bg-[#0B0B0C] text-[#F5F4F0]" : "bg-[#F9F7F2] text-[#121212]"}`}>

      {/* =========================================================================
          FIRST-VISIT LUXURY THEME SELECTION MODAL
         ========================================================================= */}
      <AnimatePresence>
        {showThemeModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/75 backdrop-blur-md p-4"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              transition={{ type: "spring", stiffness: 260, damping: 24 }}
              className="w-full max-w-lg rounded-2xl border border-white/15 bg-[#141416] p-7 md:p-9 text-[#F5F4F0] shadow-2xl relative"
            >
              <div className="text-center">
                <span className="text-[10px] uppercase tracking-[0.4em] text-[#D4AF37]">
                  V E L O R A &nbsp;&middot;&nbsp; EXPERIENCE
                </span>
                <h2 className="mt-3 text-2xl md:text-3xl font-normal font-editorial-serif tracking-wide text-white">
                  Select Your Preferred Aesthetic
                </h2>
                <p className="mt-2 text-xs md:text-sm text-white/60 font-light leading-relaxed">
                  Tailor your view of the marketplace. You can toggle this anytime in the header.
                </p>
              </div>

              <div className="mt-7 grid grid-cols-2 gap-4">
                {/* Light Mode Preview Card */}
                <button
                  type="button"
                  onClick={() => selectTheme("light")}
                  className={`group relative flex flex-col items-center justify-center rounded-xl border p-5 transition-all text-left ${theme === "light"
                    ? "border-[#D4AF37] bg-[#F9F7F2] text-[#121212] shadow-md ring-1 ring-[#D4AF37]"
                    : "border-white/10 bg-white/5 hover:border-white/30 text-white"
                    }`}
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#EAE5D9] text-[#121212] mb-3">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                    </svg>
                  </div>
                  <span className="text-xs font-medium tracking-[0.2em] uppercase">Light Mode</span>
                  <span className="mt-1 text-[11px] opacity-60">Warm ivory & charcoal</span>
                </button>

                {/* Dark Mode Preview Card */}
                <button
                  type="button"
                  onClick={() => selectTheme("dark")}
                  className={`group relative flex flex-col items-center justify-center rounded-xl border p-5 transition-all text-left ${theme === "dark"
                    ? "border-[#D4AF37] bg-[#0B0B0C] text-[#F5F4F0] shadow-md ring-1 ring-[#D4AF37]"
                    : "border-white/10 bg-white/5 hover:border-white/30 text-white"
                    }`}
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#1F1F24] text-[#D4AF37] mb-3">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                    </svg>
                  </div>
                  <span className="text-xs font-medium tracking-[0.2em] uppercase">Dark Mode</span>
                  <span className="mt-1 text-[11px] opacity-60">Deep obsidian & gold</span>
                </button>
              </div>

              <div className="mt-7 flex items-center justify-center">
                <button
                  type="button"
                  onClick={() => selectTheme(theme)}
                  className="w-full rounded-full bg-[#D4AF37] hover:bg-[#E5C365] text-black px-6 py-3.5 text-xs font-medium tracking-[0.25em] uppercase transition shadow-lg"
                >
                  Confirm & Enter
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* =========================================================================
          HERO & EDITORIAL SIDE PANEL SECTION
         ========================================================================= */}
      <section id="home" className={`relative w-full min-h-[95vh] flex flex-col md:flex-row ${theme === "dark" ? "bg-[#0B0B0C] text-white" : "bg-[#F9F7F2] text-[#121212]"}`}>

        {/* NARROW EDITORIAL SIDE STRIP (Directly Inspired by Reference Screenshot) */}
        <aside className={`hidden md:flex w-16 lg:w-24 shrink-0 flex-col justify-between items-center py-10 z-20 ${theme === "dark" ? "bg-[#070708] border-r border-white/10" : "bg-[#EAE5D9] border-r border-[#121212/10]"}`}>
          <a href="#home" className="text-sm font-semibold tracking-widest text-[#D4AF37]">
            V
          </a>
          <span className={`vertical-editorial-text text-[11px] tracking-[0.45em] font-light select-none ${theme === "dark" ? "text-white/50" : "text-[#121212/50]"}`}>
            AUTUMN / WINTER 2026
          </span>
          <span className={`h-10 w-[1px] ${theme === "dark" ? "bg-white/20" : "bg-[#121212/20]"}`} />
        </aside>

        {/* HERO CANVAS */}
        <div className={`relative flex-1 flex flex-col justify-between overflow-hidden ${theme === "dark" ? "bg-[#0B0B0C]" : "bg-[#F9F7F2]"}`}>

          {/* TOP EDITORIAL NAVIGATION (Floating over Hero) */}
          <header className={`relative z-30 w-full px-5 sm:px-8 lg:px-12 py-6 border-b backdrop-blur-md ${theme === "dark" ? "border-white/10 bg-black/25" : "border-[#121212/10] bg-black/5"}`}>
            <div className="mx-auto flex max-w-7xl items-center justify-between">

              {/* Left Nav Links */}
              <nav className={`hidden lg:flex items-center gap-8 text-[12px] font-medium tracking-[0.24em] uppercase ${theme === "dark" ? "text-white/80" : "text-[#121212/80]"}`}>
                <a href="#home" className={`transition-colors ${theme === "dark" ? "hover:text-white" : "hover:text-[#121212]"}`}>Home</a>
                <a href="#shop" className={`transition-colors ${theme === "dark" ? "hover:text-white" : "hover:text-[#121212]"}`}>Shop</a>
                <a href="#marketplace" className={`transition-colors ${theme === "dark" ? "hover:text-white" : "hover:text-[#121212]"}`}>Marketplace</a>
                <a href="#heritage" className={`transition-colors ${theme === "dark" ? "hover:text-white" : "hover:text-[#121212]"}`}>Heritage</a>
              </nav>

              {/* Mobile Hamburger Toggle */}
              <button
                type="button"
                onClick={() => setMobileMenuOpen(true)}
                className={`lg:hidden p-2 ${theme === "dark" ? "text-white/80 hover:text-white" : "text-[#121212/80] hover:text-[#121212]"}`}
                aria-label="Open Navigation Menu"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>

              {/* Centered Brand Wordmark */}
              <a href="#home" className="text-center group">
                <h1 className={`text-xl sm:text-2xl md:text-3xl font-normal font-editorial-serif tracking-[0.38em] transition-opacity group-hover:opacity-85 ${theme === "dark" ? "text-white" : "text-[#121212]"}`}>
                  V E L O R A
                </h1>
              </a>

              {/* Right Utility Icons */}
              <div className={`flex items-center gap-4 sm:gap-6 ${theme === "dark" ? "text-white/80" : "text-[#121212/80]"}`}>

                {/* Search Toggle */}
                <button
                  type="button"
                  onClick={() => setSearchOpen(!searchOpen)}
                  className={`p-1.5 transition-colors ${theme === "dark" ? "hover:text-white" : "hover:text-[#121212]"}`}
                  aria-label="Search Products"
                  title="Search products"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </button>

                {/* Account / Portals Dropdown */}
                <div className="relative" ref={accountMenuRef}>
                  <button
                    type="button"
                    onClick={() => setAccountMenuOpen(!accountMenuOpen)}
                    className={`p-1.5 transition-colors flex items-center gap-1.5 ${theme === "dark" ? "hover:text-white" : "hover:text-[#121212]"}`}
                    aria-label="Account Portals"
                    title={customer ? `Signed in as ${customer.name || customer.email || "Customer"}` : "Account & Portals"}
                  >
                    {customer ? (
                      <span className="w-6 h-6 rounded-full bg-[#D4AF37] text-black text-[11px] font-bold flex items-center justify-center shadow">
                        {customer.name ? customer.name[0].toUpperCase() : "C"}
                      </span>
                    ) : (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                    )}
                  </button>

                  <AnimatePresence>
                    {accountMenuOpen && (
                      <motion.div
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 8 }}
                        className={`absolute right-0 mt-3 w-64 rounded-xl border backdrop-blur-xl py-2 shadow-2xl z-50 text-xs ${theme === "dark" ? "border-white/15 bg-[#141416]/95" : "border-[#121212/15] bg-[#F9F7F2]/95"}`}
                      >
                        {customer ? (
                          <div className={`px-4 py-2.5 border-b ${theme === "dark" ? "border-white/10" : "border-[#121212/10]"}`}>
                            <p className="text-[10px] tracking-[0.2em] uppercase text-[#D4AF37]">Welcome</p>
                            <p className="font-medium text-xs truncate mt-0.5">{customer.name || "Valued Client"}</p>
                            <p className={`text-[11px] truncate ${theme === "dark" ? "text-white/50" : "text-[#121212/50]"}`}>
                              {customer.email || customer.phone}
                            </p>
                            <div className="mt-2.5 flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  setAccountMenuOpen(false)
                                  setShowCustomerModal(true)
                                }}
                                className="flex-1 py-1.5 px-2.5 rounded-lg bg-[#D4AF37] text-black font-semibold text-[10px] tracking-wider uppercase text-center shadow"
                              >
                                Account & Orders
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setAccountMenuOpen(false)
                                  void logoutCustomer()
                                }}
                                className="py-1.5 px-2.5 rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10 text-[10px] tracking-wider uppercase transition"
                              >
                                Sign Out
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className={`p-3 border-b ${theme === "dark" ? "border-white/10" : "border-[#121212/10]"}`}>
                            <p className={`text-[11px] mb-2 ${theme === "dark" ? "text-white/60" : "text-[#121212/60]"}`}>
                              Sign in with secure Email or Mobile OTP.
                            </p>
                            <button
                              type="button"
                              onClick={() => {
                                setAccountMenuOpen(false)
                                setShowCustomerModal(true)
                              }}
                              className="w-full py-2.5 px-3 rounded-lg bg-[#D4AF37] hover:bg-[#E5C158] text-black font-semibold text-xs tracking-wider uppercase transition shadow flex items-center justify-center gap-1.5"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
                              </svg>
                              Sign In with OTP
                            </button>
                          </div>
                        )}

                        <div className={`px-4 py-1.5 border-b ${theme === "dark" ? "border-white/10" : "border-[#121212/10]"}`}>
                          <p className="text-[10px] tracking-[0.2em] uppercase text-[#D4AF37]">Portals</p>
                        </div>
                        <a
                          href="/track-order"
                          className={`flex items-center gap-3 px-4 py-2.5 transition ${theme === "dark" ? "text-white/80 hover:bg-white/10 hover:text-white" : "text-[#121212/80] hover:bg-[#121212/5] hover:text-[#121212]"}`}
                        >
                          <svg className="w-4 h-4 text-[#D4AF37]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                          </svg>
                          Track Your Order
                        </a>
                        <a
                          href="/seller"
                          className={`flex items-center gap-3 px-4 py-2.5 transition ${theme === "dark" ? "text-white/80 hover:bg-white/10 hover:text-white" : "text-[#121212/80] hover:bg-[#121212/5] hover:text-[#121212]"}`}
                        >
                          <svg className="w-4 h-4 text-[#D4AF37]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                          </svg>
                          Seller Workspace
                        </a>
                        <a
                          href="/admin"
                          className={`flex items-center gap-3 px-4 py-2.5 transition ${theme === "dark" ? "text-white/80 hover:bg-white/10 hover:text-white" : "text-[#121212/80] hover:bg-[#121212/5] hover:text-[#121212]"}`}
                        >
                          <svg className="w-4 h-4 text-[#D4AF37]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                          </svg>
                          Admin Console
                        </a>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Theme Toggle Button */}
                <button
                  type="button"
                  onClick={toggleTheme}
                  className={`p-1.5 transition-colors ${theme === "dark" ? "hover:text-white" : "hover:text-[#121212]"}`}
                  aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
                  title={`Toggle to ${theme === "dark" ? "Light" : "Dark"} mode`}
                >
                  {theme === "dark" ? (
                    <svg className="w-5 h-5 text-[#D4AF37]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5 text-[#121212/90]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                    </svg>
                  )}
                </button>

                {/* Cart / Shopping Bag Button */}
                <button
                  type="button"
                  onClick={() => setCartOpen(true)}
                  className={`relative p-1.5 transition-colors ${theme === "dark" ? "hover:text-white" : "hover:text-[#121212]"}`}
                  aria-label="Shopping Bag"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                  </svg>
                  {cartCount > 0 && (
                    <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#D4AF37] px-1 text-[10px] font-bold text-black">
                      {cartCount}
                    </span>
                  )}
                </button>
              </div>
            </div>

            {/* Quick Interactive Search Bar */}
            <AnimatePresence>
              {searchOpen && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className={`mt-4 pt-4 border-t max-w-2xl mx-auto overflow-hidden ${theme === "dark" ? "border-white/10" : "border-[#121212/10]"}`}
                >
                  <div className="relative flex items-center">
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search essentials, horology, leather..."
                      className={`w-full rounded-full px-5 py-2.5 text-xs border outline-none focus:border-[#D4AF37] ${theme === "dark" ? "bg-white/10 text-white placeholder-white/50 border-white/20" : "bg-[#121212/5] text-[#121212] placeholder-[#121212/50] border-[#121212/20]"}`}
                      autoFocus
                    />
                    {searchQuery && (
                      <button
                        type="button"
                        onClick={() => setSearchQuery("")}
                        className={`absolute right-4 text-xs ${theme === "dark" ? "text-white/50 hover:text-white" : "text-[#121212/50] hover:text-[#121212]"}`}
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </header>

          <div className="relative z-20 flex min-h-0 flex-1 flex-col lg:flex-row lg:items-stretch">
            {/* MAIN HERO TEXT CONTENT */}
            <div className="relative flex flex-1 flex-col justify-end max-w-6xl px-6 sm:px-12 lg:px-20 py-16 sm:py-24 md:py-32">
              {/* Eyebrow Text */}
              <motion.p
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
                className={`text-[10px] sm:text-[11px] uppercase tracking-[0.4em] mb-6 ${theme === "dark" ? "text-[#D4AF37]" : "text-[#D4AF37]"}`}
              >
                Curation 04 · Worldwide Dispatch
              </motion.p>

              {/* Hero Heading with Word-Level Highlights */}
              <motion.h1
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1], delay: 0.2 }}
                className="font-editorial-serif leading-[1.08] tracking-[-0.02em]"
              >
                <div className="text-4xl sm:text-5xl md:text-6xl lg:text-[4.5rem] xl:text-[5.5rem]">
                  <motion.span
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1], delay: 0.25 }}
                    className={`inline-block ${theme === "dark" ? "text-[#F7F5F0]" : "text-[#121212]"}`}
                  >
                    Your
                  </motion.span>{' '}
                  <motion.span
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1], delay: 0.3 }}
                    whileHover={{ scale: 1.02 }}
                    className={`inline-block ${theme === "dark" ? "text-[#D4AF37]" : "text-[#D4AF37]"}`}
                  >
                    Vision
                  </motion.span>.
                </div>
                <div className="text-4xl sm:text-5xl md:text-6xl lg:text-[4.5rem] xl:text-[5.5rem] mt-1 sm:mt-2">
                  <motion.span
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1], delay: 0.35 }}
                    className={`inline-block ${theme === "dark" ? "text-[#F7F5F0]" : "text-[#121212]"}`}
                  >
                    Your
                  </motion.span>{' '}
                  <motion.span
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1], delay: 0.4 }}
                    whileHover={{ scale: 1.02 }}
                    className={`inline-block ${theme === "dark" ? "text-[#D4AF37]" : "text-[#D4AF37]"}`}
                  >
                    Store
                  </motion.span>.
                </div>
                <div className="text-4xl sm:text-5xl md:text-6xl lg:text-[4.5rem] xl:text-[5.5rem] mt-1 sm:mt-2">
                  <motion.span
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1], delay: 0.45 }}
                    className={`inline-block ${theme === "dark" ? "text-[#F7F5F0]" : "text-[#121212]"}`}
                  >
                    One
                  </motion.span>{' '}
                  <motion.span
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1], delay: 0.5 }}
                    whileHover={{ scale: 1.02 }}
                    className={`inline-block ${theme === "dark" ? "text-[#D4AF37]" : "text-[#D4AF37]"}`}
                  >
                    VELORA
                  </motion.span>.
                </div>
              </motion.h1>

              {/* Supporting Text */}
              <motion.p
                initial={{ opacity: 0, y: 25 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.35 }}
                className={`mt-6 sm:mt-8 max-w-lg text-sm sm:text-base leading-relaxed font-light tracking-wide ${theme === "dark" ? "text-white/85" : "text-[#121212/85]"}`}
              >
                Exceptional finds. Independent sellers. A marketplace designed around you.
              </motion.p>

              {/* Primary Call To Action */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.5 }}
                className="mt-8 sm:mt-10"
              >
                <motion.button
                  type="button"
                  onClick={handleGetStartClick}
                  disabled={isCtaOpening}
                  whileHover={{ scale: 1.02, y: -2 }}
                  whileTap={{ scale: 0.98 }}
                  animate={
                    isCtaOpening
                      ? {
                          opacity: [1, 0.7, 1],
                          y: [0, -4, 0],
                          transition: { duration: 0.22, ease: "easeOut" }
                        }
                      : {}
                  }
                  className={`group relative overflow-hidden inline-flex items-center gap-3.5 bg-[#EAE8E2] hover:bg-white text-[#111111] px-8 sm:px-10 py-4 sm:py-5 text-xs sm:text-sm font-medium tracking-[0.22em] uppercase transition-all duration-300 shadow-xl border ${theme === "dark" ? "border-white/20" : "border-[#121212/20]"} ${isCtaOpening ? "cursor-wait opacity-80" : "cursor-pointer"} motion-reduce:transition-none motion-reduce:transform-none`}
                  aria-label="Get start with seller registration"
                >
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/50 to-transparent transition-transform duration-700 ease-out group-hover:translate-x-full motion-reduce:hidden"
                  />
                  <span className="relative z-10 font-medium">GET START</span>
                  <svg
                    className="relative z-10 w-4 h-4 transform transition-transform duration-300 ease-out group-hover:translate-x-1.5 motion-reduce:transform-none"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                  </svg>
                </motion.button>
              </motion.div>
            </div>

            {/* Right-side hero visual (below nav/cart, not a full-screen background) */}
            <div className="relative w-full shrink-0 self-stretch px-5 pb-8 sm:px-8 lg:w-[48%] lg:px-8 lg:pr-12 lg:pb-10 lg:pt-4">
              <div className={`relative h-[42vh] min-h-[240px] overflow-hidden sm:h-[48vh] lg:h-full lg:min-h-[420px] ${theme === "dark" ? "bg-[#141416]" : "bg-[#EAE5D9]"}`}>
                <img
                  src="/hero/velora-hero.png"
                  alt="VELORA Luxury Editorial"
                  className="h-full w-full object-cover object-center filter brightness-[0.92] contrast-[1.04] opacity-[0.89]"
                  onError={(e) => {
                    e.currentTarget.style.display = "none"
                  }}
                />
              </div>
            </div>
          </div>

          {/* Sub-hero seasonal status indicator */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.6 }}
            className={`relative z-20 px-6 sm:px-12 lg:px-20 pb-8 flex items-center justify-between text-xs border-t pt-4 ${theme === "dark" ? "text-white/50 border-white/10" : "text-[#121212/50] border-[#121212/10]"}`}
          >
            <span className="tracking-[0.2em] uppercase">Limited seasonal release</span>
            <span className="hidden sm:inline-block tracking-[0.2em] uppercase">Autumn / Winter 2026</span>
          </motion.div>
        </div>
      </section>

      {/* =========================================================================
          MOBILE NAVIGATION DRAWER
         ========================================================================= */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileMenuOpen(false)}
              className="fixed inset-0 z-[120] bg-black/70 backdrop-blur-sm lg:hidden"
            />
            <motion.div
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              className="fixed top-0 left-0 bottom-0 z-[130] w-4/5 max-w-sm bg-[#141416] p-7 text-white flex flex-col justify-between lg:hidden border-r border-white/15"
            >
              <div>
                <div className="flex items-center justify-between border-b border-white/10 pb-5">
                  <span className="text-xl font-editorial-serif tracking-[0.3em]">V E L O R A</span>
                  <button
                    type="button"
                    onClick={() => setMobileMenuOpen(false)}
                    className="p-2 text-white/60 hover:text-white"
                  >
                    &times;
                  </button>
                </div>
                <nav className="mt-8 flex flex-col gap-6 text-sm tracking-[0.25em] uppercase font-light">
                  <a href="#home" onClick={() => setMobileMenuOpen(false)} className="hover:text-[#D4AF37] transition">Home</a>
                  <a href="#shop" onClick={() => setMobileMenuOpen(false)} className="hover:text-[#D4AF37] transition">Shop Collection</a>
                  <a href="#marketplace" onClick={() => setMobileMenuOpen(false)} className="hover:text-[#D4AF37] transition">Marketplace</a>
                  <a href="#heritage" onClick={() => setMobileMenuOpen(false)} className="hover:text-[#D4AF37] transition">Heritage</a>
                  <div className="h-px bg-white/10 my-2" />
                  {customer ? (
                    <button
                      type="button"
                      onClick={() => {
                        setMobileMenuOpen(false)
                        setShowCustomerModal(true)
                      }}
                      className="text-left text-xs tracking-[0.2em] uppercase text-[#D4AF37] flex items-center justify-between"
                    >
                      <span>Account ({customer.name || "Client"})</span>
                      <span className="text-[10px] opacity-75">&rarr;</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setMobileMenuOpen(false)
                        setShowCustomerModal(true)
                      }}
                      className="w-full py-2.5 px-3 rounded-lg bg-[#D4AF37] text-black font-semibold text-xs tracking-wider uppercase text-center"
                    >
                      Sign In with OTP
                    </button>
                  )}
                  <a href="/track-order" className="hover:text-[#D4AF37] transition text-xs tracking-[0.2em]">Track Order</a>
                  <a href="/seller" className="hover:text-[#D4AF37] transition text-xs tracking-[0.2em]">Seller Dashboard</a>
                  <a href="/admin" className="hover:text-[#D4AF37] transition text-xs tracking-[0.2em]">Admin Console</a>
                </nav>
              </div>

              <div className="border-t border-white/10 pt-5 flex items-center justify-between">
                <span className="text-xs text-white/50">Theme</span>
                <button
                  type="button"
                  onClick={toggleTheme}
                  className="flex items-center gap-2 text-xs text-[#D4AF37] border border-[#D4AF37]/40 px-3 py-1.5 rounded-full"
                >
                  {theme === "dark" ? "Dark Mode" : "Light Mode"}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* =========================================================================
          THE COLLECTION / SHOP SECTION (#shop)
         ========================================================================= */}
      <section id="shop" className={`mx-auto max-w-7xl px-5 sm:px-8 py-20 md:py-32 transition-colors duration-300`}>

        {/* Section Header */}
        <div className="mb-14 flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <div>
            <p className="text-[11px] uppercase tracking-[0.35em] text-[#D4AF37]">
              AUTUMN / WINTER 2026 &middot; CURATED ESSENTIALS
            </p>
            <h2 className="mt-3 text-4xl sm:text-5xl md:text-6xl font-normal font-editorial-serif tracking-tight">
              The Collection
            </h2>
          </div>
          <p className="max-w-md text-xs sm:text-sm leading-relaxed opacity-70">
            Exceptional materials, architectural silhouettes, and everyday utility. Designed for enduring longevity.
          </p>
        </div>

        {/* Category Filter Pills */}
        <div className="mb-12 flex flex-wrap items-center gap-2 sm:gap-3 border-b border-black/10 dark:border-white/10 pb-5">
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setSelectedCategory(cat)}
              className={`rounded-full px-5 py-2 text-xs tracking-[0.16em] uppercase transition ${selectedCategory === cat
                ? "bg-black text-white dark:bg-white dark:text-black font-medium"
                : "bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 opacity-70"
                }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Products Grid */}
        {filteredProducts.length === 0 ? (
          <div className="py-24 text-center">
            <p className="text-xl font-editorial-serif">No essentials found matching your search.</p>
            <button
              type="button"
              onClick={() => { setSelectedCategory("All"); setSearchQuery(""); }}
              className="mt-4 text-xs uppercase tracking-widest text-[#D4AF37] underline"
            >
              Reset Filters
            </button>
          </div>
        ) : (
          <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-3">
            {filteredProducts.map((product, index) => (
              <motion.article
                key={product.id}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: index * 0.1 }}
                className="group flex flex-col justify-between"
              >
                {/* Product Image Frame */}
                <div className="relative overflow-hidden rounded-2xl bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/10">
                  <span className="absolute left-4 top-4 z-10 rounded-full bg-black/80 dark:bg-white/90 text-white dark:text-black px-3 py-1.5 text-[10px] font-semibold tracking-wider">
                    {product.discount}% OFF
                  </span>

                  <VeloraImage
                    src={product.image}
                    alt={product.name}
                    animated
                    onClick={() => setSelectedProduct(product)}
                    className="h-[360px] sm:h-[420px] w-full cursor-pointer object-cover transition-transform duration-700 group-hover:scale-105"
                  />

                  {/* Floating Action Buttons */}
                  <div className="absolute inset-x-4 bottom-4 grid grid-cols-2 gap-3 opacity-95">
                    <AnimatedButton
                      onClick={() => addToCart(product)}
                      disabled={addingProductId !== null}
                      className="bg-white/95 hover:bg-white text-black px-4 py-3.5 text-xs uppercase tracking-wider font-medium shadow-md backdrop-blur-sm"
                    >
                      {addingProductId === product.id ? "Adding..." : "Add to Bag"}
                    </AnimatedButton>
                    <AnimatedButton
                      onClick={() => buyNow(product)}
                      className="bg-black/95 hover:bg-black text-white dark:bg-[#D4AF37] dark:text-black px-4 py-3.5 text-xs uppercase tracking-wider font-medium shadow-md"
                    >
                      Buy Now
                    </AnimatedButton>
                  </div>
                </div>

                {/* Product Meta */}
                <div className="pt-6 flex items-start justify-between gap-4">
                  <div>
                    <span className="text-[10px] tracking-[0.25em] uppercase text-[#D4AF37]">
                      {product.category}
                    </span>
                    <h3
                      onClick={() => setSelectedProduct(product)}
                      className="mt-1 text-lg font-medium cursor-pointer hover:opacity-70 transition font-editorial-serif"
                    >
                      {product.name}
                    </h3>
                    <p className="mt-1.5 text-xs opacity-60 line-clamp-2 leading-relaxed">
                      {product.description}
                    </p>
                  </div>

                  <div className="text-right shrink-0">
                    <p className="text-base font-semibold">{formatPrice(product.price)}</p>
                    <p className="text-xs opacity-40 line-through mt-0.5">{formatPrice(product.oldPrice)}</p>
                  </div>
                </div>
              </motion.article>
            ))}
          </div>
        )}
      </section>

      {/* =========================================================================
          MARKETPLACE ECOSYSTEM SECTION (#marketplace)
         ========================================================================= */}
      <section id="marketplace" className="border-t border-b border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/[0.02] py-24 md:py-32">
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <div className="max-w-2xl">
            <p className="text-[11px] uppercase tracking-[0.35em] text-[#D4AF37]">
              INDEPENDENT COMMERCE
            </p>
            <h2 className="mt-3 text-4xl sm:text-5xl font-normal font-editorial-serif tracking-tight">
              A Marketplace Built for Visionaries
            </h2>
            <p className="mt-4 text-sm leading-relaxed opacity-70">
              VELORA is more than a store. We connect discerning patrons with independent ateliers, master horologists, and leather craftsmen around the globe.
            </p>
          </div>

          <div className="mt-14 grid gap-8 md:grid-cols-3">
            <div className="rounded-2xl border border-black/10 dark:border-white/10 p-8 bg-white dark:bg-[#141416] transition-colors duration-300">
              <span className="text-2xl font-editorial-serif text-[#D4AF37] dark:text-[#E5C365]">01</span>
              <h3 className="mt-4 text-xl font-medium font-editorial-serif text-[#121212] dark:text-[#F5F4F0]">Curated Independents</h3>
              <p className="mt-3 text-xs leading-relaxed text-[#121212] opacity-60 dark:opacity-100 dark:text-[#E0DDD5]">
                Every artisan and boutique on VELORA is carefully verified for craftsmanship, ethical manufacturing, and design excellence.
              </p>
            </div>

            <div className="rounded-2xl border border-black/10 dark:border-white/10 p-8 bg-white dark:bg-[#141416] transition-colors duration-300">
              <span className="text-2xl font-editorial-serif text-[#D4AF37] dark:text-[#E5C365]">02</span>
              <h3 className="mt-4 text-xl font-medium font-editorial-serif text-[#121212] dark:text-[#F5F4F0]">Direct Studio Access</h3>
              <p className="mt-3 text-xs leading-relaxed text-[#121212] opacity-60 dark:opacity-100 dark:text-[#E0DDD5]">
                Purchase directly from the makers. Eliminate unnecessary middleman markups while supporting true independent innovation.
              </p>
            </div>

            <div className="rounded-2xl border border-black/10 dark:border-white/10 p-8 bg-white dark:bg-[#141416] flex flex-col justify-between transition-colors duration-300">
              <div>
                <span className="text-2xl font-editorial-serif text-[#D4AF37] dark:text-[#E5C365]">03</span>
                <h3 className="mt-4 text-xl font-medium font-editorial-serif text-[#121212] dark:text-[#F5F4F0]">Open Your Atelier</h3>
                <p className="mt-3 text-xs leading-relaxed text-[#121212] opacity-60 dark:opacity-100 dark:text-[#E0DDD5]">
                  Are you a creator? Showcase your inventory to an international audience appreciative of subtle luxury.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowSellerModal(true)}
                className="mt-6 inline-flex items-center gap-2 text-xs font-semibold tracking-widest text-[#D4AF37] dark:text-[#E5C365] dark:hover:text-[#F3E5AB] uppercase hover:underline cursor-pointer transition-colors"
              >
                Join as Seller &rarr;
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* =========================================================================
          HERITAGE & CRAFTSMANSHIP SECTION (#heritage)
         ========================================================================= */}
      <section id="heritage" className="mx-auto max-w-7xl px-5 sm:px-8 py-24 md:py-32">
        <div className="grid gap-12 lg:grid-cols-2 items-center">
          <div>
            <p className="text-[11px] uppercase tracking-[0.35em] text-[#D4AF37]">
              OUR PHILOSOPHY
            </p>
            <h2 className="mt-3 text-4xl sm:text-5xl font-normal font-editorial-serif tracking-tight leading-tight">
              Quiet Elegance.<br />Permanent Relevance.
            </h2>
            <p className="mt-6 text-sm sm:text-base leading-relaxed opacity-75">
              VELORA was conceived on the principle that the finest objects whisper. In an era of disposable fashion and sensory saturation, we curate objects characterized by restraint, tactile depth, and longevity.
            </p>
            <div className="mt-8 grid grid-cols-2 gap-6 border-t border-black/10 dark:border-white/10 pt-8">
              <div>
                <h4 className="text-2xl font-editorial-serif">100%</h4>
                <p className="mt-1 text-xs opacity-60 tracking-wider uppercase">Authenticity Assured</p>
              </div>
              <div>
                <h4 className="text-2xl font-editorial-serif">Carbon-Neutral</h4>
                <p className="mt-1 text-xs opacity-60 tracking-wider uppercase">Curated Fulfillment</p>
              </div>
            </div>
          </div>

          <div className="relative overflow-hidden rounded-3xl bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 p-3 sm:p-5">
            <img
              src="https://images.unsplash.com/photo-1509631179647-0177331693ae?auto=format&fit=crop&w=1200&q=80"
              alt="VELORA Heritage"
              className="h-[380px] sm:h-[480px] w-full object-cover rounded-2xl"
              onError={(e) => {
                e.currentTarget.style.display = "none"
              }}
            />
          </div>
        </div>
      </section>

      {/* =========================================================================
          FOOTER
         ========================================================================= */}
      <footer className="border-t border-black/10 dark:border-white/10 bg-[#101012] text-white px-5 sm:px-8 py-16 md:py-24">
        <div className="mx-auto max-w-7xl">
          <div className="grid gap-12 lg:grid-cols-4">

            {/* Brand column */}
            <div className="lg:col-span-2">
              <span className="text-2xl font-editorial-serif tracking-[0.35em]">V E L O R A</span>
              <p className="mt-4 max-w-md text-xs sm:text-sm text-white/60 leading-relaxed font-light">
                The Art of Everyday Luxury. Curated essentials and independent ateliers brought together for the modern collector.
              </p>
              <div className="mt-8 flex items-center gap-4 text-xs text-white/40">
                <span>&copy; 2026 VELORA Inc.</span>
                <span>&middot;</span>
                <span>All Rights Reserved</span>
              </div>
            </div>

            {/* Navigation links */}
            <div>
              <p className="text-[11px] uppercase tracking-[0.3em] text-[#D4AF37]">Exploration</p>
              <ul className="mt-4 space-y-3 text-xs text-white/70 font-light">
                <li><a href="#home" className="hover:text-white transition">Home</a></li>
                <li><a href="#shop" className="hover:text-white transition">The Collection</a></li>
                <li><a href="#marketplace" className="hover:text-white transition">Marketplace</a></li>
                <li><a href="#heritage" className="hover:text-white transition">Heritage</a></li>
                <li><a href="/track-order" className="hover:text-white transition">Order Tracking</a></li>
              </ul>
            </div>

            {/* Portals */}
            <div>
              <p className="text-[11px] uppercase tracking-[0.3em] text-[#D4AF37]">Management</p>
              <ul className="mt-4 space-y-3 text-xs text-white/70 font-light">
                <li><a href="/seller" className="hover:text-white transition">Seller Workspace</a></li>
                <li><a href="/admin" className="hover:text-white transition">Admin Portal</a></li>
                <li><a href="#shop" className="hover:text-white transition">Catalog API</a></li>
                <li><span className="opacity-50">Private Concierge</span></li>
              </ul>
            </div>
          </div>
        </div>
      </footer>

      {/* =========================================================================
          PRODUCT DETAILS MODAL
         ========================================================================= */}
      <AnimatePresence>
        {selectedProduct && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[150] overflow-y-auto bg-black/70 backdrop-blur-md p-4 sm:p-8 flex items-center justify-center"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-4xl rounded-3xl bg-[#F9F7F2] dark:bg-[#151518] border border-black/10 dark:border-white/10 p-6 sm:p-10 text-[#121212] dark:text-[#F5F4F0] shadow-2xl overflow-hidden"
            >
              <button
                type="button"
                onClick={() => setSelectedProduct(null)}
                className="absolute top-6 right-6 h-10 w-10 rounded-full border border-black/10 dark:border-white/10 flex items-center justify-center text-xl hover:opacity-70"
              >
                &times;
              </button>

              <div className="grid gap-8 md:grid-cols-2 items-center">
                <div className="overflow-hidden rounded-2xl bg-black/5 dark:bg-white/5">
                  <img
                    src={selectedProduct.image}
                    alt={selectedProduct.name}
                    className="max-h-[460px] w-full object-cover"
                  />
                </div>

                <div>
                  <span className="text-[10px] uppercase tracking-[0.3em] text-[#D4AF37]">
                    {selectedProduct.category}
                  </span>
                  <h3 className="mt-2 text-3xl sm:text-4xl font-normal font-editorial-serif">
                    {selectedProduct.name}
                  </h3>

                  <div className="mt-4 flex items-center gap-4">
                    <span className="text-2xl font-semibold">{formatPrice(selectedProduct.price)}</span>
                    <span className="text-sm opacity-40 line-through">{formatPrice(selectedProduct.oldPrice)}</span>
                    <span className="rounded-full bg-[#D4AF37]/20 text-[#D4AF37] px-2.5 py-1 text-xs font-medium">
                      {selectedProduct.discount}% OFF
                    </span>
                  </div>

                  <p className="mt-5 text-xs sm:text-sm leading-relaxed opacity-70">
                    {selectedProduct.description}
                  </p>

                  {selectedProduct.details && (
                    <ul className="mt-6 space-y-2 border-t border-black/10 dark:border-white/10 pt-4 text-xs opacity-75">
                      {selectedProduct.details.map((detail) => (
                        <li key={detail} className="flex items-center gap-2">
                          <span className="text-[#D4AF37]">&bull;</span>
                          <span>{detail}</span>
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="mt-8 grid grid-cols-2 gap-4">
                    <AnimatedButton
                      onClick={() => addToCart(selectedProduct)}
                      className="border border-black/20 dark:border-white/20 px-5 py-4 text-xs uppercase tracking-widest font-medium hover:border-black dark:hover:border-white"
                    >
                      Add to Bag
                    </AnimatedButton>
                    <AnimatedButton
                      onClick={() => buyNow(selectedProduct)}
                      className="bg-black text-white dark:bg-[#D4AF37] dark:text-black px-5 py-4 text-xs uppercase tracking-widest font-medium shadow-md"
                    >
                      Buy Now
                    </AnimatedButton>
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* =========================================================================
          SHOPPING BAG / CART DRAWER
         ========================================================================= */}
      <AnimatePresence>
        {cartOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setCartOpen(false)}
              className="fixed inset-0 z-[160] bg-black/60 backdrop-blur-sm"
            />
            <motion.aside
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", stiffness: 320, damping: 32 }}
              className="fixed right-0 top-0 bottom-0 z-[170] flex h-full w-full max-w-md flex-col bg-[#F9F7F2] dark:bg-[#141416] border-l border-black/10 dark:border-white/10 text-[#121212] dark:text-[#F5F4F0] shadow-2xl"
            >
              <div className="flex items-center justify-between border-b border-black/10 dark:border-white/10 px-6 py-5">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.3em] text-[#D4AF37]">V E L O R A</p>
                  <h3 className="mt-1 text-xl font-normal font-editorial-serif">Your Shopping Bag</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setCartOpen(false)}
                  className="h-9 w-9 rounded-full border border-black/10 dark:border-white/10 flex items-center justify-center text-lg hover:opacity-70"
                >
                  &times;
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-6 py-6">
                {cart.length === 0 ? (
                  <div className="py-24 text-center">
                    <p className="text-3xl">&loz;</p>
                    <p className="mt-4 text-base font-editorial-serif">Your shopping bag is empty</p>
                    <button
                      type="button"
                      onClick={() => setCartOpen(false)}
                      className="mt-6 text-xs uppercase tracking-widest text-[#D4AF37] underline"
                    >
                      Explore Collection
                    </button>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {cart.map((item) => (
                      <div key={item.id} className="flex gap-4 border-b border-black/10 dark:border-white/10 pb-6">
                        <img src={item.image} alt={item.name} className="h-20 w-20 rounded-xl object-cover" />
                        <div className="min-w-0 flex-1">
                          <div className="flex justify-between gap-2">
                            <p className="text-sm font-medium font-editorial-serif">{item.name}</p>
                            <button
                              type="button"
                              onClick={() => removeItem(item.id)}
                              className="text-xs opacity-50 hover:opacity-100"
                            >
                              Remove
                            </button>
                          </div>
                          <p className="mt-1 text-xs font-semibold">{formatPrice(item.price)}</p>
                          <div className="mt-3 flex items-center gap-3">
                            <button
                              type="button"
                              onClick={() => changeQuantity(item.id, -1)}
                              className="h-7 w-7 rounded-full border border-black/20 dark:border-white/20 flex items-center justify-center text-sm"
                            >
                              &minus;
                            </button>
                            <span className="text-xs font-medium">{item.quantity}</span>
                            <button
                              type="button"
                              disabled={item.quantity >= 10}
                              onClick={() => changeQuantity(item.id, 1)}
                              className="h-7 w-7 rounded-full border border-black/20 dark:border-white/20 flex items-center justify-center text-sm disabled:opacity-30"
                            >
                              &#43;
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {cart.length > 0 && (
                <div className="border-t border-black/10 dark:border-white/10 px-6 py-6 bg-black/5 dark:bg-white/[0.02]">
                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between opacity-70">
                      <span>Subtotal</span>
                      <span>{formatPrice(subtotal)}</span>
                    </div>
                    <div className="flex justify-between opacity-70">
                      <span>Complimentary Shipping</span>
                      <span>{shipping === 0 ? "Free" : formatPrice(shipping)}</span>
                    </div>
                    <div className="flex justify-between border-t border-black/10 dark:border-white/10 pt-3 text-base font-semibold">
                      <span>Total</span>
                      <span>{formatPrice(total)}</span>
                    </div>
                  </div>
                  <AnimatedButton
                    onClick={() => {
                      setCartOpen(false)
                      setOrderError("")
                      setCheckoutOpen(true)
                    }}
                    className="mt-6 w-full bg-black text-white dark:bg-[#D4AF37] dark:text-black px-6 py-4 text-xs font-medium tracking-[0.2em] uppercase shadow-lg"
                  >
                    Proceed to Checkout
                  </AnimatedButton>
                </div>
              )}
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* =========================================================================
          CHECKOUT MODAL
         ========================================================================= */}
      <AnimatePresence>
        {checkoutOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={closeCheckout}
              className="fixed inset-0 z-[180] bg-black/70 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, y: 25, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 25, scale: 0.98 }}
              className="fixed inset-0 z-[190] flex items-center justify-center overflow-y-auto p-4 sm:p-6"
            >
              <div className="my-auto max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-3xl bg-[#F9F7F2] dark:bg-[#151518] p-6 sm:p-9 text-[#121212] dark:text-[#F5F4F0] border border-black/10 dark:border-white/10 shadow-2xl">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.3em] text-[#D4AF37]">VELORA &middot; CHECKOUT</p>
                    <h3 className="mt-1 text-2xl font-normal font-editorial-serif">Complete Your Order</h3>
                  </div>
                  <button
                    type="button"
                    onClick={closeCheckout}
                    disabled={isSubmitting}
                    className="h-9 w-9 rounded-full border border-black/10 dark:border-white/10 flex items-center justify-center text-lg disabled:opacity-40"
                  >
                    &times;
                  </button>
                </div>

                {customer ? (
                  <div className="mt-6 p-3 rounded-xl border border-[#D4AF37]/30 bg-[#D4AF37]/10 text-xs flex items-center justify-between">
                    <div>
                      <span className="text-[10px] uppercase tracking-wider text-[#D4AF37] font-semibold block">Signed In Client</span>
                      <span className="font-medium">{customer.name || customer.email || customer.phone}</span>
                    </div>
                    <span className="px-2 py-0.5 rounded text-[10px] bg-[#D4AF37] text-black font-semibold uppercase">Verified</span>
                  </div>
                ) : (
                  <div className="mt-6 p-3 rounded-xl border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 text-xs flex items-center justify-between">
                    <span className="opacity-75">Have a VELORA account?</span>
                    <button
                      type="button"
                      onClick={() => setShowCustomerModal(true)}
                      className="text-[#D4AF37] hover:underline font-semibold"
                    >
                      Sign In with OTP &rarr;
                    </button>
                  </div>
                )}

                <form key={customer ? `cust-${customer.id}` : "guest"} onSubmit={placeOrder} className="mt-6 space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs opacity-70">Full Name *</label>
                      <input
                        required
                        minLength={2}
                        maxLength={100}
                        name="name"
                        defaultValue={customer?.name || ""}
                        placeholder="e.g. Eleanor Vance"
                        className="w-full rounded-xl border border-black/15 dark:border-white/15 bg-white dark:bg-white/5 px-4 py-3 text-xs outline-none focus:border-[#D4AF37]"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs opacity-70">Email Address *</label>
                      <input
                        required
                        type="email"
                        maxLength={254}
                        name="email"
                        defaultValue={customer?.email || ""}
                        placeholder="you@domain.com"
                        className="w-full rounded-xl border border-black/15 dark:border-white/15 bg-white dark:bg-white/5 px-4 py-3 text-xs outline-none focus:border-[#D4AF37]"
                      />
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs opacity-70">Phone *</label>
                      <input
                        required
                        type="tel"
                        name="phone"
                        minLength={10}
                        maxLength={20}
                        defaultValue={customer?.phone || ""}
                        placeholder="+91 98765 43210"
                        className="w-full rounded-xl border border-black/15 dark:border-white/15 bg-white dark:bg-white/5 px-4 py-3 text-xs outline-none focus:border-[#D4AF37]"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs opacity-70">Pincode *</label>
                      <input
                        required
                        name="pincode"
                        pattern="[0-9]{6}"
                        placeholder="6-digit pincode"
                        className="w-full rounded-xl border border-black/15 dark:border-white/15 bg-white dark:bg-white/5 px-4 py-3 text-xs outline-none focus:border-[#D4AF37]"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs opacity-70">Shipping Address *</label>
                    <textarea
                      required
                      minLength={5}
                      maxLength={300}
                      rows={2}
                      name="address"
                      placeholder="Suite, apartment, street name..."
                      className="w-full resize-none rounded-xl border border-black/15 dark:border-white/15 bg-white dark:bg-white/5 px-4 py-3 text-xs outline-none focus:border-[#D4AF37]"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-xs opacity-70">City *</label>
                    <input
                      required
                      minLength={2}
                      maxLength={100}
                      name="city"
                      placeholder="e.g. Mumbai, New Delhi"
                      className="w-full rounded-xl border border-black/15 dark:border-white/15 bg-white dark:bg-white/5 px-4 py-3 text-xs outline-none focus:border-[#D4AF37]"
                    />
                  </div>

                  <div className="rounded-xl bg-black/5 dark:bg-white/5 p-4 border border-black/5 dark:border-white/5">
                    <div className="flex justify-between text-xs font-medium">
                      <span>Total Payable</span>
                      <span className="text-[#D4AF37] font-semibold">{formatPrice(total)}</span>
                    </div>
                    <div className="flex items-center justify-between pt-2 border-t border-black/5 dark:border-white/10 text-[11px]">
                      <span className="opacity-70 flex items-center gap-1.5">
                        <span className="inline-block w-2 h-2 rounded-full bg-emerald-500"></span>
                        Razorpay Gateway (UPI, Cards, NetBanking, Wallets)
                      </span>
                      <span className="text-[10px] uppercase tracking-wider text-[#D4AF37] font-medium">100% Secure</span>
                    </div>
                  </div>

                  {orderError && (
                    <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-500">
                      {orderError}
                    </div>
                  )}

                  <AnimatedButton
                    type="submit"
                    disabled={isSubmitting || cart.length === 0}
                    className="w-full bg-black text-white dark:bg-[#D4AF37] dark:text-black py-4 text-xs font-medium tracking-[0.2em] uppercase shadow-lg mt-2"
                  >
                    {isSubmitting ? "Initiating Secure Payment..." : `Pay with Razorpay · ${formatPrice(total)}`}
                  </AnimatedButton>
                </form>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* =========================================================================
          ORDER SUCCESS CONFIRMATION MODAL
         ========================================================================= */}
      <AnimatePresence>
        {orderSuccess && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] flex items-center justify-center bg-black/85 backdrop-blur-md p-5 text-white"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ type: "spring", stiffness: 220, damping: 20 }}
              className="max-w-md w-full text-center rounded-3xl border border-white/15 bg-[#141416] p-8 shadow-2xl"
            >
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-[#D4AF37] text-2xl text-[#D4AF37]">
                &#10003;
              </div>
              <p className="mt-6 text-[10px] uppercase tracking-[0.35em] text-[#D4AF37]">
                VELORA &middot; CONFIRMED
              </p>
              <h2 className="mt-2 text-3xl font-normal font-editorial-serif">
                Thank You
              </h2>
              <p className="mt-3 text-xs text-white/60 leading-relaxed font-light">
                Your order has been recorded into our fulfillment pipeline.
              </p>

              {orderId !== null && (
                <div className="mt-6 rounded-xl border border-white/15 bg-white/5 p-4">
                  <p className="text-[11px] text-white/50 tracking-wider uppercase">Order Identifier</p>
                  <p className="mt-1 text-2xl font-semibold font-editorial-serif text-[#D4AF37]">#{orderId}</p>
                  <div className="mt-3 flex items-center justify-center gap-1.5 text-[11px] text-emerald-400">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block animate-pulse"></span>
                    <span>Payment Verified via Razorpay</span>
                  </div>
                </div>
              )}

              <div className="mt-6 flex flex-col gap-3">
                {orderId !== null && (
                  <a
                    href="/track-order"
                    className="inline-block rounded-full border border-white/30 px-6 py-3 text-xs tracking-[0.2em] uppercase hover:bg-white hover:text-black transition"
                  >
                    Track Your Order
                  </a>
                )}
                <AnimatedButton
                  onClick={() => setOrderSuccess(false)}
                  className="bg-[#D4AF37] text-black px-6 py-3 text-xs tracking-[0.2em] uppercase font-medium rounded-full hover:bg-[#E5C365]"
                >
                  Continue Browsing
                </AnimatedButton>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Razorpay Sandbox Test Simulation Sheet */}
      <AnimatePresence>
        {sandboxSim && (
          <div className="fixed inset-0 z-[250] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="max-w-sm w-full bg-[#18181b] border border-[#D4AF37]/40 rounded-2xl p-6 text-white text-center shadow-2xl"
            >
              <span className="inline-block px-2.5 py-1 rounded-full bg-[#D4AF37]/20 text-[#D4AF37] text-[10px] font-semibold tracking-wider uppercase mb-2">
                Razorpay Test Sandbox
              </span>
              <h3 className="text-lg font-serif">Simulate Payment Gateway</h3>
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

      {/* Customer Email & Mobile OTP Authentication Modal */}
      <CustomerAuthModal
        isOpen={showCustomerModal}
        onClose={() => setShowCustomerModal(false)}
        theme={theme}
        initialCustomer={customer}
        onSuccess={(authenticatedCustomer) => {
          setCustomer(authenticatedCustomer)
        }}
      />

      {/* Real Seller Onboarding & Verification Modal */}
      <SellerRegistrationModal
        isOpen={showSellerModal}
        onClose={() => setShowSellerModal(false)}
        onSuccess={() => {
          setShowSellerModal(false)
          window.location.href = "/seller"
        }}
        theme={theme}
      />
    </div>
  )
}

export default function App() {
  const path = window.location.pathname
  const cleanPath = path.replace(/^\/+|\/+$/g, "").toLowerCase()

  if (path === "/admin" || cleanPath === "admin") {
    return <AdminDashboard />
  }

  if (path === "/seller" || cleanPath === "seller") {
    return <SellerDashboard />
  }

  if (path === "/track-order" || cleanPath === "track-order") {
    return <TrackOrder />
  }

  if (cleanPath && cleanPath !== "api" && cleanPath !== "index.html") {
    return <SellerStorefront slug={cleanPath} />
  }

  return (
    <>
      <VeloraCursor />
      <VeloraLoader />
      <Storefront />
    </>
  )
}
