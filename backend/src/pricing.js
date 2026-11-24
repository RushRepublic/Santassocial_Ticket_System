export const ADULT_TICKET_PAISE = 22_000;
export const PLATFORM_FEE_PERCENT = 2.5;
const PREVIOUS_FEE_INCLUSIVE_ADULT_PRICES = [20_000, 100];

export function platformFeePaise(subtotal) {
  // 2.5% is 1/40. Round half up using integer paise.
  return Math.floor((subtotal + 20) / 40);
}

export function quoteSubtotal(subtotal, method) {
  const ticketSubtotal = method === "FREE" ? 0 : subtotal;
  const platformFee = method === "RAZORPAY" ? platformFeePaise(ticketSubtotal) : 0;
  return { ticketSubtotal, platformFee, amount: ticketSubtotal + platformFee };
}

export function quoteBooking(adults, method) {
  return quoteSubtotal(adults * ADULT_TICKET_PAISE, method);
}

export function savedBookingPricing({ adults, amount }) {
  // Recover the breakdown only when a known fee-inclusive rate matches the
  // saved total. Earlier fee-free bookings and complimentary tickets keep theirs.
  const current = quoteBooking(adults, "RAZORPAY");
  if (current.amount === amount) return current;
  for (const rate of PREVIOUS_FEE_INCLUSIVE_ADULT_PRICES) {
    const previous = quoteSubtotal(adults * rate, "RAZORPAY");
    if (previous.amount === amount) return previous;
  }
  return { ticketSubtotal: amount, platformFee: 0, amount };
}

const wholeRupees = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});
const fractionalRupees = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
});
export function money(paise) {
  return (paise % 100 === 0 ? wholeRupees : fractionalRupees).format(paise / 100);
}
