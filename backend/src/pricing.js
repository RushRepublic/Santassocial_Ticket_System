export const ADULT_TICKET_PAISE = 100;
export const PLATFORM_FEE_PERCENT = 2.5;

export function platformFeePaise(subtotal) {
  // 2.5% is 1/40. Round half up using integer paise.
  return Math.floor((subtotal + 20) / 40);
}

export function quoteBooking(adults) {
  const ticketSubtotal = adults * ADULT_TICKET_PAISE;
  const platformFee = platformFeePaise(ticketSubtotal);
  return { ticketSubtotal, platformFee, amount: ticketSubtotal + platformFee };
}

export function savedBookingPricing({ adults, amount }) {
  // The current fee-inclusive rate is distinct from the historical fee-free
  // adult prices (₹1 and ₹200). Never use a quote to replace a saved total.
  const quote = quoteBooking(adults);
  return quote.amount === amount
    ? quote
    : { ticketSubtotal: amount, platformFee: 0, amount };
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
