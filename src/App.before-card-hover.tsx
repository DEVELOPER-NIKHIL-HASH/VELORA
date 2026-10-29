import VeloraLoader from './VeloraLoader';
import VeloraCursor from './VeloraCursor';

import { AnimatePresence, motion } from "motion/react"
import { useState, type FormEvent, type ReactNode } from "react"
import AdminDashboard from "./AdminDashboard"
import TrackOrder from "./TrackOrder"


import headphones from "./assets/products/headphones.jpg"
import watch from "./assets/products/watch.jpg"
import backpack from "./assets/products/backpack.jpg"

type Product = {
  id: number
  name: string
  price: number
  oldPrice: number
  discount: number
  image: string
  description: string
}

type CartItem = Product & { quantity: number }

type OrderResponse = {
  status?: string
  message?: string
  orderId?: number
}

const API_URL = "http://localhost:5000/api/orders"

const products: Product[] = [
  {
    id: 1,
    name: "Aura Wireless Headphones",
    price: 1999,
    oldPrice: 3499,
    discount: 43,
    image: headphones,
    description: "Premium wireless sound with a clean modern design.",
  },
  {
    id: 2,
    name: "Minimal Smart Watch",
    price: 2499,
    oldPrice: 4999,
    discount: 50,
    image: watch,
    description: "Elegant everyday smartwatch with a premium finish.",
  },
  {
    id: 3,
    name: "Premium Everyday Backpack",
    price: 1299,
    oldPrice: 2199,
    discount: 41,
    image: backpack,
    description: "Minimal everyday backpack built for style and utility.",
  },
]

const formatPrice = (price: number) =>
  `₹${price.toLocaleString("en-IN")}`

function VeloraLogo() {
  return (
    <a href="#home" className="flex items-center gap-3">
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#111] text-2xl font-bold text-[#D4AF37]">
        V
      </span>
      <span className="text-xl font-semibold tracking-[0.18em]">
        VELORA
      </span>
    </a>
  )
}

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
      whileHover={disabled ? undefined : { scale: 1.02 }}
      whileTap={disabled ? undefined : { scale: 0.97 }}
      className={`rounded-full transition disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    >
      {children}
    </motion.button>
  )
}

function Storefront() {
  const [cart, setCart] = useState<CartItem[]>([])
  const [cartOpen, setCartOpen] = useState(false)
  const [checkoutOpen, setCheckoutOpen] = useState(false)
  const [selectedProduct, setSelectedProduct] =
    useState<Product | null>(null)
  const [addingProductId, setAddingProductId] = useState<number | null>(null)

  const [orderSuccess, setOrderSuccess] = useState(false)
  const [orderId, setOrderId] = useState<number | null>(null)
  const [orderError, setOrderError] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)

  const cartCount = cart.reduce(
    (sum, item) => sum + item.quantity,
    0
  )

  const subtotal = cart.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  )

  const shipping = subtotal === 0 || subtotal >= 1999 ? 0 : 99
  const total = subtotal + shipping

  async function addToCart(product: Product) {
    if (addingProductId !== null) return

    setAddingProductId(product.id)

    await new Promise((resolve) => setTimeout(resolve, 450))

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
            ? {
                ...item,
                quantity: Math.max(0, Math.min(10, item.quantity + amount)),
              }
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
      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          customer_name: String(formData.get("name") ?? "").trim(),
          email: String(formData.get("email") ?? "").trim(),
          total,
          items: cart.map((item) => ({
            id: item.id,
            name: item.name,
            price: item.price,
            quantity: item.quantity,
          })),
        }),
      })

      const responseText = await response.text()
      let data: OrderResponse

      try {
        data = JSON.parse(responseText) as OrderResponse
      } catch {
        throw new Error(
          response.status === 404
            ? "Order API route nahi mila. Backend mein POST /api/orders check karo."
            : `Backend ka response valid JSON nahi tha (HTTP ${response.status}).`
        )
      }

      if (!response.ok) {
        throw new Error(data.message || `Order save nahi hua (HTTP ${response.status}).`)
      }

      if (typeof data.orderId !== "number" || !Number.isFinite(data.orderId)) {
        throw new Error("Server response mein valid orderId nahi mila.")
      }

      setOrderId(data.orderId)
      setCheckoutOpen(false)
      setCart([])
      setCartOpen(false)
      setOrderSuccess(true)
    } catch (error) {
      console.error("VELORA order error:", error)
      setOrderError(
        error instanceof TypeError
          ? "Backend se connect nahi ho paaya. Node server localhost:5000 par chalu hai?"
          : error instanceof Error
            ? error.message
            : "Order save nahi ho saka. Dobara try karo."
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  function closeCheckout() {
    if (isSubmitting) return
    setCheckoutOpen(false)
    setOrderError("")
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="min-h-screen overflow-x-hidden bg-[#f6f3ed] text-[#111]"
    >
      <header className="sticky top-0 z-40 border-b border-black/10 bg-[#f6f3ed]/95 backdrop-blur-xl">
        <div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-5 md:px-8">
          <VeloraLogo />
          <nav className="hidden items-center gap-8 text-sm md:flex">
            <a href="#home" className="hover:opacity-50">Home</a>
            <a href="#shop" className="hover:opacity-50">Shop</a>
            <a href="#offers" className="hover:opacity-50">Offers</a>
            <a href="/track-order" className="hover:opacity-50">Track Order</a>
          </nav>
          <button
            type="button"
            onClick={() => setCartOpen(true)}
            className="flex items-center gap-3 text-sm"
          >
            Cart
            <span className="flex h-8 min-w-8 items-center justify-center rounded-full bg-black px-2 text-white">
              {cartCount}
            </span>
          </button>
        </div>
      </header>

      <section
        id="home"
        className="mx-auto grid min-h-[80vh] max-w-7xl items-center gap-10 px-5 py-16 md:grid-cols-2 md:px-8 md:py-20"
      >
        <motion.div
          initial={{ opacity: 0, x: -30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.7 }}
        >
          <p className="text-xs uppercase tracking-[0.35em] text-black/50">
            VELORA | Curated Essentials
          </p>
          <h1 className="mt-7 text-5xl font-medium leading-[0.98] tracking-[-0.05em] sm:text-7xl md:text-8xl">
            Designed<br />for the<br />everyday.
          </h1>
          <p className="mt-7 max-w-md text-base leading-7 text-black/60">
            Premium products, simple design and everyday functionality.
            Discover pieces made to fit your lifestyle.
          </p>
          <AnimatedButton
            onClick={() =>
              document.getElementById("shop")?.scrollIntoView({ behavior: "smooth" })
            }
            className="mt-9 bg-[#111] px-8 py-4 text-sm text-white"
          >
            Shop Collection →
          </AnimatedButton>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.94 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.8 }}
          className="overflow-hidden rounded-[2rem] bg-[#e8e3da]"
        >
          <motion.img
            src={headphones}
            alt="Aura Wireless Headphones"
            animate={{ scale: [1, 1.035, 1] }}
            transition={{ duration: 8, repeat: Infinity }}
            className="h-[350px] w-full object-cover sm:h-[520px]"
          />
        </motion.div>
      </section>

      <section
        id="offers"
        className="flex flex-col items-center justify-between gap-5 bg-[#111] px-5 py-10 text-center text-white md:flex-row md:px-12 md:text-left"
      >
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-white/50">Limited offer</p>
          <h2 className="mt-2 text-2xl font-medium">Premium products. Better prices.</h2>
        </div>
        <a href="#shop" className="rounded-full border border-white/30 px-7 py-3 text-sm hover:bg-white hover:text-black">
          Explore Collection
        </a>
      </section>

      <section id="shop" className="mx-auto max-w-7xl px-5 py-20 md:px-8 md:py-28">
        <div className="mb-12 flex flex-col justify-between gap-5 md:flex-row md:items-end">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-black/40">The collection</p>
            <h2 className="mt-3 text-4xl font-medium tracking-tight sm:text-6xl">Shop essentials</h2>
          </div>
          <p className="max-w-sm text-sm leading-6 text-black/50">
            Carefully selected products combining clean aesthetics with everyday utility.
          </p>
        </div>

        <div className="grid gap-9 md:grid-cols-2 lg:grid-cols-3">
          {products.map((product, index) => (
            <motion.article
              key={product.id}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: index * 0.1 }}
              className="group"
            >
              <div className="relative overflow-hidden rounded-[1.5rem] bg-[#e8e3da]">
                <span className="absolute left-4 top-4 z-10 rounded-full bg-white px-3 py-2 text-xs">
                  {product.discount}% OFF
                </span>
                <VeloraImage src={product.image} alt={product.name} animated onClick={() => setSelectedProduct(product)} className="h-[340px] w-full cursor-pointer object-cover sm:h-[400px]" />
                <div className="absolute inset-x-3 bottom-3 grid grid-cols-2 gap-3">
                  <AnimatedButton onClick={() => addToCart(product)} disabled={addingProductId !== null} className="bg-white px-3 py-4 text-sm">
                    {addingProductId === product.id ? "Adding..." : "Add to Cart"}
                  </AnimatedButton>
                  <AnimatedButton onClick={() => buyNow(product)} className="bg-[#111] px-3 py-4 text-sm text-white">
                    Buy Now
                  </AnimatedButton>
                </div>
              </div>
              <div className="flex items-start justify-between gap-3 pt-5">
                <div>
                  <button type="button" onClick={() => setSelectedProduct(product)} className="text-left font-medium hover:opacity-60">
                    {product.name}
                  </button>
                  <p className="mt-2 max-w-xs text-sm leading-6 text-black/50">{product.description}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-medium">{formatPrice(product.price)}</p>
                  <p className="mt-1 text-xs text-black/40 line-through">{formatPrice(product.oldPrice)}</p>
                </div>
              </div>
            </motion.article>
          ))}
        </div>
      </section>

      <section className="border-y border-black/10 bg-[#ebe6dc]">
        <div className="mx-auto grid max-w-7xl gap-10 px-5 py-16 md:grid-cols-3 md:px-8 md:py-20">
          {[
            ["01", "Quality first", "Products selected with care for design and everyday usability."],
            ["02", "Secure shopping", "A simple shopping experience from product discovery to checkout."],
            ["03", "Customer focused", "A thoughtful experience from beginning to end."],
          ].map(([number, title, description]) => (
            <div key={number}>
              <p className="text-3xl">{number}</p>
              <h3 className="mt-5 text-lg font-medium">{title}</h3>
              <p className="mt-3 text-sm leading-6 text-black/50">{description}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="bg-[#111] px-5 py-12 text-white md:px-8 md:py-16">
        <div className="mx-auto flex max-w-7xl flex-col justify-between gap-8 md:flex-row">
          <div>
            <VeloraLogo />
            <p className="mt-4 text-sm text-white/50">Modern essentials for a modern everyday life.</p>
          </div>
          <div className="flex gap-10 text-sm text-white/60">
            <div className="space-y-3">
              <p className="text-white/40">Navigate</p>
              <a href="#home" className="block hover:text-white">Home</a>
              <a href="#shop" className="block hover:text-white">Shop</a>
              <a href="#offers" className="block hover:text-white">Offers</a>
              <a href="/track-order" className="block hover:text-white">Track Order</a>
            </div>
            <div className="space-y-3">
              <p className="text-white/40">Support</p>
              <a href="mailto:support@velora.com" className="block hover:text-white">Contact</a>
              <p>Shipping</p>
              <p>Returns</p>
            </div>
          </div>
        </div>
        <div className="mx-auto mt-12 max-w-7xl border-t border-white/10 pt-6 text-xs text-white/30">
          Â© 2026 VELORA. All rights reserved.
        </div>
      </footer>

      <AnimatePresence>
        {selectedProduct && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] overflow-y-auto bg-[#f6f3ed] p-5 md:p-10"
          >
            <div className="mx-auto max-w-6xl">
              <div className="flex items-center justify-between">
                <button type="button" onClick={() => setSelectedProduct(null)} className="rounded-full border border-black/10 px-5 py-3 text-sm">← Back</button>
                <VeloraLogo />
              </div>
              <div className="grid items-center gap-10 py-10 md:grid-cols-2">
                <VeloraImage src={selectedProduct.image} alt={selectedProduct.name} className="max-h-[600px] w-full rounded-[2rem] object-cover" />
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-black/40">{selectedProduct.discount}% OFF</p>
                  <h2 className="mt-5 text-4xl font-medium sm:text-6xl">{selectedProduct.name}</h2>
                  <p className="mt-5 leading-7 text-black/50">{selectedProduct.description}</p>
                  <div className="mt-7 flex items-center gap-4">
                    <span className="text-2xl font-medium">{formatPrice(selectedProduct.price)}</span>
                    <span className="text-black/40 line-through">{formatPrice(selectedProduct.oldPrice)}</span>
                  </div>
                  <div className="mt-8 grid gap-3 sm:grid-cols-2">
                    <AnimatedButton onClick={() => addToCart(selectedProduct)} className="border border-black/15 px-5 py-4 text-sm">Add to Cart</AnimatedButton>
                    <AnimatedButton onClick={() => buyNow(selectedProduct)} className="bg-black px-5 py-4 text-sm text-white">Buy Now</AnimatedButton>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {cartOpen && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setCartOpen(false)} className="fixed inset-0 z-[60] bg-black/40" />
            <motion.aside
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              className="fixed right-0 top-0 z-[65] flex h-full w-full max-w-md flex-col bg-[#f6f3ed]"
            >
              <div className="flex items-center justify-between border-b border-black/10 px-6 py-5">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-black/40">VELORA | Your bag</p>
                  <h2 className="mt-1 text-2xl font-medium">Shopping Cart</h2>
                </div>
                <button type="button" onClick={() => setCartOpen(false)} className="h-10 w-10 rounded-full border border-black/10 text-xl">×</button>
              </div>
              <div className="flex-1 overflow-y-auto px-6 py-6">
                {cart.length === 0 ? (
                  <div className="py-16 text-center">
                    <p className="text-4xl">&#128717;&#65039;</p>
                    <p className="mt-5 text-lg">Your cart is empty</p>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {cart.map((item) => (
                      <div key={item.id} className="flex gap-4 border-b border-black/10 pb-6">
                        <VeloraImage src={item.image} alt={item.name} className="h-24 w-24 rounded-xl object-cover" />
                        <div className="min-w-0 flex-1">
                          <div className="flex justify-between gap-2">
                            <p className="text-sm font-medium">{item.name}</p>
                            <button type="button" onClick={() => removeItem(item.id)} className="text-xs text-black/40">Remove</button>
                          </div>
                          <p className="mt-2 text-sm">{formatPrice(item.price)}</p>
                          <div className="mt-4 flex items-center gap-4">
                            <button type="button" onClick={() => changeQuantity(item.id, -1)} className="h-8 w-8 rounded-full border border-black/15">âˆ’</button>
                            <span>{item.quantity}</span>
                            <button type="button" disabled={item.quantity >= 10} onClick={() => changeQuantity(item.id, 1)} className="h-8 w-8 rounded-full border border-black/15 disabled:opacity-40">+</button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {cart.length > 0 && (
                <div className="border-t border-black/10 px-6 py-6">
                  <div className="space-y-3 text-sm">
                    <div className="flex justify-between"><span className="text-black/50">Subtotal</span><span>{formatPrice(subtotal)}</span></div>
                    <div className="flex justify-between"><span className="text-black/50">Shipping</span><span>{shipping === 0 ? "Free" : formatPrice(shipping)}</span></div>
                    <div className="flex justify-between border-t border-black/10 pt-4 text-lg font-medium"><span>Total</span><span>{formatPrice(total)}</span></div>
                  </div>
                  <AnimatedButton onClick={() => { setCartOpen(false); setOrderError(""); setCheckoutOpen(true) }} className="mt-6 w-full bg-black px-6 py-4 text-sm text-white">
                    Proceed to Checkout
                  </AnimatedButton>
                </div>
              )}
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {checkoutOpen && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={closeCheckout} className="fixed inset-0 z-[80] bg-black/50 backdrop-blur-sm" />
            <motion.div
              initial={{ opacity: 0, y: 25, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 25, scale: 0.97 }}
              className="fixed inset-0 z-[90] flex items-center justify-center overflow-y-auto p-3 sm:p-5"
            >
              <div className="my-auto max-h-[95dvh] w-full max-w-2xl overflow-y-auto rounded-[2rem] bg-[#f6f3ed] p-5 shadow-2xl sm:p-8 md:p-10">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs uppercase tracking-[0.25em] text-black/40">VELORA | Secure checkout</p>
                    <h2 className="mt-2 text-2xl font-medium sm:text-3xl">Complete your order</h2>
                  </div>
                  <button type="button" onClick={closeCheckout} disabled={isSubmitting} className="h-10 w-10 shrink-0 rounded-full border border-black/10 text-xl disabled:opacity-40">×</button>
                </div>

                <form onSubmit={placeOrder} className="mt-8 space-y-5">
                  <div className="grid gap-5 md:grid-cols-2">
                    <div>
                      <label className="mb-2 block text-sm">Full Name</label>
                      <input required minLength={2} maxLength={100} name="name" autoComplete="name" placeholder="Enter your name" className="w-full rounded-xl border border-black/10 bg-white px-4 py-3 outline-none focus:border-black" />
                    </div>
                    <div>
                      <label className="mb-2 block text-sm">Email</label>
                      <input required type="email" maxLength={254} name="email" autoComplete="email" placeholder="you@example.com" className="w-full rounded-xl border border-black/10 bg-white px-4 py-3 outline-none focus:border-black" />
                    </div>
                  </div>
                  <div className="grid gap-5 md:grid-cols-2">
                    <div>
                      <label className="mb-2 block text-sm">Phone</label>
                      <input required type="tel" name="phone" autoComplete="tel" minLength={10} maxLength={20} pattern="[0-9+() -]{10,20}" title="Enter a valid phone number" placeholder="Enter phone number" className="w-full rounded-xl border border-black/10 bg-white px-4 py-3 outline-none focus:border-black" />
                    </div>
                    <div>
                      <label className="mb-2 block text-sm">Pincode</label>
                      <input required name="pincode" inputMode="numeric" autoComplete="postal-code" pattern="[0-9]{6}" title="Enter a valid 6-digit Indian pincode" placeholder="Enter pincode" className="w-full rounded-xl border border-black/10 bg-white px-4 py-3 outline-none focus:border-black" />
                    </div>
                  </div>
                  <div>
                    <label className="mb-2 block text-sm">Address</label>
                    <textarea required minLength={5} maxLength={300} rows={3} name="address" autoComplete="street-address" placeholder="House number, street, area..." className="w-full resize-none rounded-xl border border-black/10 bg-white px-4 py-3 outline-none focus:border-black" />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm">City</label>
                    <input required minLength={2} maxLength={100} name="city" autoComplete="address-level2" placeholder="Enter city" className="w-full rounded-xl border border-black/10 bg-white px-4 py-3 outline-none focus:border-black" />
                  </div>
                  <div className="rounded-2xl bg-[#ebe6dc] p-5">
                    <div className="flex justify-between text-sm"><span className="text-black/50">Order total</span><span className="font-medium">{formatPrice(total)}</span></div>
                    <p className="mt-2 text-xs text-black/40">Online payment is not connected yet.</p>
                  </div>
                  {orderError && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{orderError}</div>}
                  <AnimatedButton type="submit" disabled={isSubmitting || cart.length === 0} className="w-full bg-[#111] px-6 py-4 text-sm font-medium text-white">
                    {isSubmitting ? "Saving Order..." : "Place Order"}
                  </AnimatedButton>
                </form>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {orderSuccess && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] flex items-center justify-center bg-[#111] p-5 text-white">
            <motion.div initial={{ opacity: 0, scale: 0.9, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ type: "spring", stiffness: 180, damping: 18 }} className="max-w-lg text-center">
              <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full border border-white/20 text-3xl">âœ“</div>
              <p className="mt-8 text-xs uppercase tracking-[0.3em] text-white/40">VELORA | Order confirmed</p>
              <h2 className="mt-4 text-4xl font-medium sm:text-6xl">Thank you.</h2>
              <p className="mt-5 text-sm leading-7 text-white/60">Your order has been saved successfully.</p>
              {orderId !== null && (
                <div className="mt-6 rounded-2xl border border-white/15 p-5">
                  <p className="text-xs text-white/50">Your order number</p>
                  <p className="mt-2 text-2xl font-medium">#{orderId}</p>
                </div>
              )}
              {orderId !== null && (
                <a
                  href="/track-order"
                  className="mt-5 inline-block rounded-full border border-white/30 px-6 py-3 text-sm hover:bg-white hover:text-black"
                >
                  Track Your Order
                </a>
              )}
              <p className="mt-5 text-xs leading-6 text-white/40">Your order was saved by the backend. Online payment processing is not connected yet.</p>
              <AnimatedButton onClick={() => setOrderSuccess(false)} className="mt-9 bg-white px-8 py-4 text-sm font-medium text-black">Continue Shopping</AnimatedButton>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

export default function App() {
  const path = window.location.pathname

  if (path === "/admin") {
    return <AdminDashboard />
  }

  if (path === "/track-order") {
    return <TrackOrder />
  }

  return (
    <>
      <VeloraCursor />
      <VeloraLoader />
      <Storefront />
    </>
  )
}



import VeloraImage from './VeloraImage';





