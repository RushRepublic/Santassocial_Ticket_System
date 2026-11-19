import { test } from "node:test";
import assert from "node:assert/strict";
import { money, platformFeePaise, quoteBooking, savedBookingPricing } from "../src/pricing.js";

test("2.5 percent fee rounds half a paise up once on the subtotal", () => {
  for (const [subtotal, fee] of [
    [0, 0], [19, 0], [20, 1], [100, 3], [200, 5], [300, 8],
    [10000, 250], [20000, 500], [30000, 750], [50000, 1250], [100000, 2500],
  ]) assert.equal(platformFeePaise(subtotal), fee);
  assert.deepEqual(quoteBooking(3), { ticketSubtotal: 300, platformFee: 8, amount: 308 });
  assert.deepEqual(quoteBooking(0), { ticketSubtotal: 0, platformFee: 0, amount: 0 });
  assert.equal(money(30750), "₹307.50");
});

test("the saved price breakdown never changes historical or fee-inclusive totals", () => {
  for (const amount of [300, 60000])
    assert.deepEqual(savedBookingPricing({ adults: 3, amount }),
      { ticketSubtotal: amount, platformFee: 0, amount });
  assert.deepEqual(savedBookingPricing({ adults: 3, amount: 308 }), quoteBooking(3));
});
