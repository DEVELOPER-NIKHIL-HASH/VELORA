import "./AdminDashboard.css";
import { useCallback, useEffect, useState } from "react";

type OrderStatus =
  | "Pending"
  | "Processing"
  | "Shipped"
  | "Delivered"
  | "Cancelled";

type OrderItem = {
  id?: number;
  name: string;
  price: number;
  quantity: number;
};

type Order = {
  id: number;
  customer_name: string;
  email: string;
  total: number;
  items: OrderItem[];
  created_at: string;
  status: OrderStatus;
  store_name?: string | null;
  store_slug?: string | null;
  platform_fee?: number | null;
  seller_payout?: number | null;
  fee_rate?: number | null;
};

const API_URL = "/api/orders";

const STATUSES: OrderStatus[] = [
  "Pending",
  "Processing",
  "Shipped",
  "Delivered",
  "Cancelled",
];

const COLORS: Record<OrderStatus, string> = {
  Pending: "#d97706",
  Processing: "#2563eb",
  Shipped: "#7c3aed",
  Delivered: "#16a34a",
  Cancelled: "#dc2626",
};

const money = (value: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(value);

export default function AdminDashboard() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(() => Boolean(sessionStorage.getItem("velora_admin_token")));
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState<number | null>(null);
  const [adminToken, setAdminToken] = useState(
    () => sessionStorage.getItem("velora_admin_token") ?? ""
  );
  const [adminPassword, setAdminPassword] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);

  const loadOrders = useCallback(async () => {

    try {
      const response = await fetch(API_URL, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Orders load nahi hue.");
      }

      setOrders(data.orders ?? []);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Backend se connect nahi hua."
      );
    } finally {
      setLoading(false);
    }
  }, [adminToken]);

  useEffect(() => {
    if (!adminToken) return;

    let cancelled = false;

    async function fetchOrders() {
      try {
        const response = await fetch(API_URL, {
          headers: { Authorization: `Bearer ${adminToken}` },
        });
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.message || "Orders load nahi hue.");
        }

        if (!cancelled) setOrders(data.orders ?? []);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Backend se connect nahi hua.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void fetchOrders();
    return () => { cancelled = true; };
  }, [adminToken]);

  async function handleAdminLogin() {
    setLoginLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: adminPassword }),
      });
      const data = await response.json();
      if (!response.ok || !data.token) {
        throw new Error(data.message || "Admin login failed.");
      }
      sessionStorage.setItem("velora_admin_token", data.token);
      setLoading(true);
      setAdminToken(data.token);
      setAdminPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed.");
    } finally {
      setLoginLoading(false);
    }
  }

  function handleAdminLogout() {
    sessionStorage.removeItem("velora_admin_token");
    setAdminToken("");
    setLoading(false);
    setAdminPassword("");
    setError("");
    setNotice("");
    setOrders([]);
  }

  async function changeStatus(id: number, status: OrderStatus) {
    setSaving(id);
    setError("");
    setNotice("");

    try {
      const response = await fetch(`${API_URL}/${id}/status`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ status }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Status update failed.");
      }

      setOrders((current) =>
        current.map((order) =>
          order.id === id ? { ...order, ...data.order } : order
        )
      );

      setNotice(`Order #${id} updated to ${status}.`);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Status update failed."
      );
      await loadOrders();
    } finally {
      setSaving(null);
    }
  }

  const filteredOrders = orders.filter((order) => {
    const query = search.toLowerCase();

    return (
      String(order.id).includes(query) ||
      order.customer_name.toLowerCase().includes(query) ||
      order.email.toLowerCase().includes(query) ||
      order.status.toLowerCase().includes(query)
    );
  });

  const totalValue = orders.reduce((sum, order) => sum + order.total, 0);

  // Settlement metrics on successful/completed (Delivered) orders
  const deliveredOrders = orders.filter((o) => o.status === "Delivered");
  const deliveredVolume = deliveredOrders.reduce((sum, order) => sum + (Number(order.total) || 0), 0);
  const platformRevenue = deliveredOrders.reduce((sum, order) => {
    const fee = typeof order.platform_fee === "number" && !isNaN(order.platform_fee)
      ? order.platform_fee
      : Math.round((Number(order.total) || 0) * 0.03 * 100) / 100;
    return sum + fee;
  }, 0);

  const statCards = [
    { label: "Total Orders", value: String(orders.length) },
    { label: "Total Order Value", value: money(totalValue) },
    { label: "Delivered Volume", value: money(deliveredVolume) },
    { label: "Platform Revenue (3%)", value: money(platformRevenue) },
    {
      label: "Pending",
      value: String(orders.filter((o) => o.status === "Pending").length),
    },
    {
      label: "Delivered",
      value: String(deliveredOrders.length),
    },
  ];

  if (!adminToken) {
    return (
      <main className="admin-page">
        <section className="admin-panel">
          <div className="admin-brand">V E L O R A</div>
          <h1>Admin Login</h1>
          <p className="muted">Enter your admin password to continue.</p>
          <form onSubmit={(event) => {
            event.preventDefault();
            void handleAdminLogin();
          }}>
            <input
              type="password"
              className="admin-search"
              placeholder="Admin password"
              value={adminPassword}
              onChange={(event) => setAdminPassword(event.target.value)}
              required
            />
            <button className="admin-button gold" type="submit" disabled={loginLoading}>
              {loginLoading ? "Signing in..." : "Sign In"}
            </button>
          </form>
          {error && <p className="admin-error">{error}</p>}
          <a className="admin-button secondary" href="/">Back to Store</a>
        </section>
      </main>
    );
  }
  return (
    <main className="admin-page">
      <header className="admin-header">
        <div>
          <div className="admin-brand">V E L O R A</div>
          <h1>Order Management</h1>
          <p className="muted">Admin Dashboard Â· Order fulfillment</p>
        </div>

        <div className="header-actions">
          <button
            className="admin-button secondary"
            onClick={handleAdminLogout}
          >
            Logout
          </button>
          <a className="admin-button secondary" href="/">
            â† Storefront
          </a>
          <button
            className="admin-button gold"
            onClick={() => void loadOrders()}
            disabled={loading}
          >
            {loading ? "Loading..." : "â†» Refresh"}
          </button>
        </div>
      </header>

      <section className="admin-stats">
        {statCards.map((card) => (
          <article className="admin-stat" key={card.label}>
            <p className="muted">{card.label}</p>
            <strong>{card.value}</strong>
          </article>
        ))}
      </section>

      <section className="admin-panel">
        <div className="orders-toolbar">
          <div>
            <h2>All Orders</h2>
            <p className="muted">{filteredOrders.length} order(s)</p>
          </div>

          <input
            className="admin-search"
            placeholder="Search order, customer, email..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        {error && <p className="admin-error">{error}</p>}
        {notice && <p className="admin-success">{notice}</p>}

        {loading && <p className="muted">Loading orders...</p>}

        {!loading && !error && filteredOrders.length === 0 && (
          <p className="muted">No orders found.</p>
        )}

        {!loading &&
          filteredOrders.map((order) => (
            <article className="order-card" key={order.id}>
              <div className="order-heading">
                <div>
                  <span className="order-id">ORDER #{order.id}</span>
                  {order.store_name ? (
                    <span style={{ marginLeft: "8px", fontSize: "11px", color: "#d4af37", background: "rgba(212,175,55,0.1)", padding: "2px 8px", borderRadius: "10px" }}>
                      Store: {order.store_name}
                    </span>
                  ) : (
                    <span style={{ marginLeft: "8px", fontSize: "11px", color: "#888", background: "rgba(255,255,255,0.06)", padding: "2px 8px", borderRadius: "10px" }}>
                      VELORA Marketplace
                    </span>
                  )}
                  <h3>{order.customer_name}</h3>
                  <p className="muted">{order.email}</p>
                </div>

                <div className="order-price">
                  <strong>{money(order.total)}</strong>
                  {order.status === "Delivered" && (
                    <span style={{ display: "block", fontSize: "11px", color: "#10b981", marginTop: "2px" }}>
                      Fee (3%): {money(typeof order.platform_fee === "number" ? order.platform_fee : Math.round(order.total * 0.03 * 100) / 100)}
                    </span>
                  )}
                  <p className="muted">
                    {new Date(
                      order.created_at.replace(" ", "T") + "Z"
                    ).toLocaleString("en-IN")}
                  </p>
                </div>
              </div>

              <div className="order-items">
                {order.items.map((item, index) => (
                  <div key={`${item.id ?? item.name}-${index}`}>
                    <span>
                      {item.name} Ã— {item.quantity}
                    </span>
                    <span>{money(item.price * item.quantity)}</span>
                  </div>
                ))}
              </div>

              <div className="order-controls">
                <span
                  className="status-badge"
                  style={{
                    background: COLORS[order.status] ?? "#64748b",
                  }}
                >
                  {order.status}
                </span>

                <label className="status-control">
                  <span>Change status</span>
                  <select
                    value={order.status}
                    disabled={saving === order.id}
                    onChange={(event) =>
                      void changeStatus(
                        order.id,
                        event.target.value as OrderStatus
                      )
                    }
                  >
                    {STATUSES.map((status) => (
                      <option value={status} key={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                </label>

                {saving === order.id && (
                  <span className="muted">Saving...</span>
                )}
              </div>
            </article>
          ))}
      </section>

      <footer className="admin-footer">
        VELORA Â· Connected to the orders API
      </footer>
    </main>
  );
}

