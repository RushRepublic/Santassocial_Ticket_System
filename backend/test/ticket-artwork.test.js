import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import jsQR from "jsqr";
import { renderTicketPng } from "../src/ticket-artwork.js";
import { qrToken } from "../src/security.js";

for (const [method, status] of [
  ["RAZORPAY", "PAID"],
  ["CASH", "PENDING_CASH"],
  ["CASH", "PAID"],
]) {
  test(`${method} ${status} exports a complete branded image with a decodable group QR`, async () => {
    const booking = {
      id: "ticket-artwork-test",
      ticketNonce: "c".repeat(64),
      reference: "SS2026-ARTWORK",
      name: "Sri & Family <Guest>",
      eventDate: "2026-11-05",
      adults: 3,
      kids: 2,
      people: 5,
      amount: 60000,
      method,
      status,
      demo: true,
      holdUntil: "2026-11-05T20:00:00.000Z",
    };
    const png = await renderTicketPng(booking);
    const { data, info } = await sharp(png)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    assert.equal(info.width, 1290);
    assert.equal(info.height, 2610);
    // Sample the clear red header, rather than accepting a QR-only image.
    const index = (40 * info.width + info.width / 2) * 4;
    assert.deepEqual([...data.subarray(index, index + 3)], [138, 29, 35]);
    const decoded = jsQR(new Uint8ClampedArray(data), info.width, info.height);
    assert.equal(decoded?.data, qrToken(booking));
  });
}
