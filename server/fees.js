/**
 * VELORA Platform Fee Business Rule:
 * VELORA platform fee = 3% of each successful/completed order total.
 *
 * Example:
 *   Order Total: ₹1,000
 *   Platform Fee (3%): ₹30
 *   Seller Net Payout: ₹970
 *
 * Monetary amounts are safely rounded to 2 decimal places.
 */

export const PLATFORM_FEE_RATE = 0.03;

/**
 * Calculates the platform fee and seller net payout for an order total.
 *
 * @param {number|string} orderTotal
 * @returns {{ fee_rate: number, platform_fee: number, seller_payout: number }}
 */
export function calculatePlatformFee(orderTotal) {
  const numericTotal = Number(orderTotal) || 0;
  if (!Number.isFinite(numericTotal) || numericTotal <= 0) {
    return {
      fee_rate: PLATFORM_FEE_RATE,
      platform_fee: 0,
      seller_payout: 0,
    };
  }

  // Safe monetary rounding to 2 decimal places
  const platformFee = Math.round(numericTotal * PLATFORM_FEE_RATE * 100) / 100;
  const sellerPayout = Math.round((numericTotal - platformFee) * 100) / 100;

  return {
    fee_rate: PLATFORM_FEE_RATE,
    platform_fee: platformFee,
    seller_payout: sellerPayout,
  };
}

/**
 * Normalizes an order record to ensure platform fee and seller payout fields
 * are safely populated, including backward-compatible fallback for historical records.
 *
 * Settlement Rule:
 * Only orders with status === "Delivered" represent settled transactions.
 * For non-delivered orders (Pending, Processing, Shipped, Cancelled), settlement
 * fees are NOT applied/settled.
 *
 * @param {object} order - Raw SQLite order row
 * @returns {object} Order with fee fields safely attached
 */
export function normalizeOrderFees(order) {
  if (!order) return order;

  const total = Number(order.total) || 0;
  const isDelivered = order.status === "Delivered";
  const hasRecordedFee = typeof order.platform_fee === "number" && !isNaN(order.platform_fee);

  let platform_fee;
  let seller_payout;
  const fee_rate = order.fee_rate ?? PLATFORM_FEE_RATE;

  if (hasRecordedFee) {
    platform_fee = order.platform_fee;
    seller_payout = order.seller_payout ?? (Math.round((total - platform_fee) * 100) / 100);
  } else if (isDelivered) {
    // Dynamic compatibility for historical delivered orders
    const feeData = calculatePlatformFee(total);
    platform_fee = feeData.platform_fee;
    seller_payout = feeData.seller_payout;
  } else {
    // Unsettled orders
    platform_fee = 0;
    seller_payout = total;
  }

  return {
    ...order,
    fee_rate,
    platform_fee,
    seller_payout,
    is_settled: isDelivered,
  };
}
