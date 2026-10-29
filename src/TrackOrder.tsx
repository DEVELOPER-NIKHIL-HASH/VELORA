
import { useState } from "react";
import "./TrackOrder.css";

type Order = {
  id: number;
  customer_name: string;
  total: number;
  items: {
    name: string;
    price: number;
    quantity: number;
  }[];
  created_at: string;
  status: "Pending" | "Processing" | "Shipped" | "Delivered" | "Cancelled";
};

const API_URL = "/api/orders";

const steps = ["Pending", "Processing", "Shipped", "Delivered"] as const;

const money = (amount: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(amount);

export default function TrackOrder() {
  const [orderId, setOrderId] = useState("");
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function findOrder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setOrder(null);

    try {
      const id = Number(orderId.trim());

      if (!Number.isInteger(id) || id < 1) {
        throw new Error("Please enter a valid order ID.");
      }

      const response = await fetch(`${API_URL}/${id}`);
      const data = await response.json();

      if (!response.ok || data.status !== "success" || !data.order) {
        throw new Error(data.message || "Order not found.");
      }

      setOrder(data.order);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not load order."
      );
    } finally {
      setLoading(false);
    }
  }

  const currentStep = order ? steps.indexOf(order.status as (typeof steps)[number]) : -1;

  return (
    <main className="track-page">
      <header className="track-header">
        <a className="track-brand" href="/">VELORA</a>
        <a className="track-back" href="/">Back to Store</a>
      </header>

      <section className="track-content">
        <p className="track-eyebrow">ORDER UPDATES</p>
        <h1>Track your order.</h1>
        <p className="track-subtitle">
          Enter your order ID to check its current status.
        </p>

        <form className="track-form" onSubmit={findOrder}>
          <label htmlFor="order-id">Order ID</label>
          <div className="track-input-row">
            <input
              id="order-id"
              type="number"
              min="1"
              required
              value={orderId}
              onChange={(event) => setOrderId(event.target.value)}
              placeholder="e.g. 9"
            />
            <button type="submit" disabled={loading}>
              {loading ? "Searching..." : "Track Order"}
            </button>
          </div>
        </form>

        {error && <p className="track-error">{error}</p>}

        {order && (
          <article className="track-result">
            <div className="track-result-heading">
              <div>
                <p className="track-muted">ORDER #{order.id}</p>
                <h2>{order.status === "Cancelled" ? "Order cancelled" : "Order status"}</h2>
              </div>
              <span className={`track-status status-${order.status.toLowerCase()}`}>
                {order.status}
              </span>
            </div>

            {order.status !== "Cancelled" && (
              <div className="track-steps">
                {steps.map((step, index) => (
                  <div
                    key={step}
                    className={`track-step ${index <= currentStep ? "complete" : ""}`}
                  >
                    <span className="track-step-dot">
                      {index < currentStep ? "✓" : index + 1}
                    </span>
                    <span>{step}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="track-details">
              <p><span>Customer</span><strong>{order.customer_name}</strong></p>
              <p><span>Order date</span><strong>{order.created_at}</strong></p>
            </div>

            <h3>Items</h3>
            {order.items.map((item, index) => (
              <div className="track-item" key={`${item.name}-${index}`}>
                <span>{item.name} × {item.quantity}</span>
                <strong>{money(item.price * item.quantity)}</strong>
              </div>
            ))}

            <div className="track-total">
              <span>Total</span>
              <strong>{money(order.total)}</strong>
            </div>

            <p className="track-privacy">
              Keep your order ID private. Customer verification will be added
              before this page is used for public order lookup.
            </p>
          </article>
        )}
      </section>
    </main>
  );
}

