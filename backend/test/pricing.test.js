import { test } from "node:test";
import assert from "node:assert/strict";
import { money, platformFeePaise, quoteBooking, savedBookingPricing } from "../src/pricing.js";

test("2.5 percent fee rounds half a paise up once on the subtotal", () => {
  for (const [subtotal, fee] of [
    [0, 0], [19, 0], [20, 1], [100, 3], [200, 5], [300, 8],
    [10000, 250], [20000, 500], [30000, 750], [50000, 1250], [100000, 2500],
  ]) assert.equal(platformFeePaise(subtotal), fee);
  assert.deepEqual(quoteBooking(1, "RAZORPAY"), { ticketSubtotal: 22_000, platformFee: 550, amount: 22_550 });
  assert.deepEqual(quoteBooking(2, "RAZORPAY"), { ticketSubtotal: 44_000, platformFee: 1_100, amount: 45_100 });
  assert.deepEqual(quoteBooking(3, "RAZORPAY"), { ticketSubtotal: 66_000, platformFee: 1_650, amount: 67_650 });
  assert.deepEqual(quoteBooking(5, "RAZORPAY"), { ticketSubtotal: 110_000, platformFee: 2_750, amount: 112_750 });
  for (const [adults, subtotal] of [[1, 22_000], [2, 44_000], [3, 66_000], [5, 110_000]])
    assert.deepEqual(quoteBooking(adults, "CASH"), { ticketSubtotal: subtotal, platformFee: 0, amount: subtotal });
  for (const method of ["CASH", "RAZORPAY", "FREE"])
    assert.deepEqual(quoteBooking(0, method), { ticketSubtotal: 0, platformFee: 0, amount: 0 });
  assert.deepEqual(quoteBooking(3, "FREE"), { ticketSubtotal: 0, platformFee: 0, amount: 0 });
  assert.equal(money(30750), "₹307.50");
});

test("the saved price breakdown never changes historical or fee-inclusive totals", () => {
  for (const amount of [300, 60000])
    assert.deepEqual(savedBookingPricing({ adults: 3, amount }),
      { ticketSubtotal: amount, platformFee: 0, amount });
  assert.deepEqual(savedBookingPricing({ adults: 3, amount: 308 }),
    { ticketSubtotal: 300, platformFee: 8, amount: 308 });
  assert.deepEqual(savedBookingPricing({ adults: 3, amount: 61_500 }),
    { ticketSubtotal: 60_000, platformFee: 1_500, amount: 61_500 });
  assert.deepEqual(savedBookingPricing({ adults: 3, amount: 67_650 }), quoteBooking(3, "RAZORPAY"));
  assert.deepEqual(savedBookingPricing({ adults: 3, amount: 0 }), quoteBooking(0, "RAZORPAY"));
});
