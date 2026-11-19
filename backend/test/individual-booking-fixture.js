import { issueIndividualTickets } from "../src/individual-tickets.js";
import { createBooking, getBooking, hasBookingQr, now } from "../src/services.js";

// Reproduce the issuance marker and tickets from the individual-ticket release.
export async function createLegacyIndividualBooking(db, ...args) {
  const booking = await createBooking(db, ...args);
  await db.transaction(async (tx) => {
    await tx.run("INSERT INTO ticket_batches (bookingId,createdAt) VALUES (?,?)", [
      booking.id,
      now(),
    ]);
    if (hasBookingQr(booking)) await issueIndividualTickets(tx, booking);
  });
  return getBooking(db, booking.id);
}
