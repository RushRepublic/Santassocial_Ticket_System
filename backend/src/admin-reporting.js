import { paymentDemo } from "./config.js";

// Reporting only: preserve historical rows and customer ticket/payment flows.
// Simulated OTP/notifications do not make a live Razorpay payment simulated.
export function adminBookingVisibility(alias) {
  if (!["b", "bookings"].includes(alias))
    throw new Error("Unsupported booking alias.");
  if (paymentDemo) return { sql: "1 = 1", values: [] };
  return {
    sql: `(${alias}.method <> ? OR NOT EXISTS (
      SELECT 1 FROM payments simulated
      WHERE simulated.bookingId = ${alias}.id
        AND (SUBSTR(simulated.orderId, 1, 11) = ?
          OR SUBSTR(simulated.paymentId, 1, 9) = ?)
    ))`,
    values: ["RAZORPAY", "order_demo_", "pay_demo_"],
  };
}

export function hiddenSimulatedBooking(booking) {
  return (
    !paymentDemo &&
    booking.method === "RAZORPAY" &&
    (booking.gatewayOrderId?.startsWith("order_demo_") ||
      booking.gatewayPaymentId?.startsWith("pay_demo_"))
  );
}
