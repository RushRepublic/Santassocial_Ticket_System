import { randomBytes, randomUUID } from "node:crypto";
import { hash, qrToken } from "./security.js";
import {
  AppError,
  fail,
  getBooking,
  hasBookingQr,
  publicBooking,
  validateTicketDate,
  lockEvent,
  audit,
  now,
  approveCashInTransaction,
} from "./services.js";
import { paymentDemo } from "./config.js";

export const individualToken = (ticket) =>
  qrToken({ id: `individual:${ticket.id}`, ticketNonce: ticket.nonce });

export async function issueIndividualTickets(tx, booking) {
  if (
    !(
      await tx.all("SELECT bookingId FROM ticket_batches WHERE bookingId = ?", [
        booking.id,
      ])
    ).length
  )
    return;
  const existing = await tx.all(
    "SELECT id FROM individual_tickets WHERE bookingId = ?",
    [booking.id],
  );
  if (existing.length) {
    if (existing.length !== booking.people)
      fail(409, "Ticket quantities need operator review.");
    return;
  }
  for (let i = 0; i < booking.people; i++) {
    const ticket = { id: randomUUID(), nonce: randomBytes(32).toString("hex") };
    await tx.run(
      "INSERT INTO individual_tickets (id,bookingId,ordinal,category,eventDate,nonce,qrHash,createdAt) VALUES (?,?,?,?,?,?,?,?)",
      [
        ticket.id,
        booking.id,
        i + 1,
        i < booking.adults ? "ADULT" : "KID",
        booking.eventDate,
        ticket.nonce,
        hash(individualToken(ticket)),
        now(),
      ],
    );
  }
}

export async function receiptTickets(db, booking) {
  if (!hasBookingQr(booking)) return [];
  const rows = await db.all(
    "SELECT * FROM individual_tickets WHERE bookingId = ? ORDER BY ordinal",
    [booking.id],
  );
  return rows.map((t) => ({
    id: t.id,
    number: `${booking.reference}-${t.ordinal}`,
    ordinal: t.ordinal,
    category: t.category,
    eventDate: t.eventDate,
    status: t.approvedAt ? "APPROVED" : "NOT_SCANNED",
    approvedAt: t.approvedAt,
    qrToken: individualToken(t),
  }));
}

export async function inspectIndividual(db, token) {
  const ticket = (
    await db.all("SELECT * FROM individual_tickets WHERE qrHash = ?", [
      hash(token),
    ])
  )[0];
  if (!ticket) return null;
  const b = await getBooking(db, ticket.bookingId);
  if (!hasBookingQr(b)) fail(403, "Invalid Ticket");
  if (!paymentDemo && b.method === "RAZORPAY" && publicBooking(b).demo)
    fail(403, "Simulated payments are not valid for entry.");
  validateTicketDate(ticket);
  const all = await receiptTickets(db, b);
  const selected = all.find((t) => t.id === ticket.id);
  if (ticket.approvedAt)
    throw new AppError(409, "Already Approved", {
      code: "ALREADY_APPROVED",
      ticketNumber: selected.number,
      category: ticket.category,
      approvedAt: ticket.approvedAt,
      status: "APPROVED",
    });
  return {
    ...b,
    ticket: selected,
    approvedTickets: all.filter((t) => t.status === "APPROVED").length,
    pendingTickets: all
      .filter((t) => t.status === "NOT_SCANNED")
      .map(({ qrToken: _token, ...safe }) => safe),
  };
}

export async function checkinIndividual(
  db,
  token,
  userId,
  key,
  amountReceived,
) {
  return db.transaction(async (tx) => {
    await lockEvent(tx);
    const user = (
      await tx.all("SELECT role FROM users WHERE id = ? AND active = 1", [
        userId,
      ])
    )[0];
    if (!["ADMIN", "SCANNER", "staff"].includes(user?.role))
      fail(403, "Staff permission is required.");
    const previous = (
      await tx.all("SELECT * FROM individual_tickets WHERE approvalKey = ?", [
        key,
      ])
    )[0];
    if (previous) {
      if (previous.qrHash !== hash(token) || previous.approvedBy !== userId)
        fail(409, "Idempotency key already used.");
      validateTicketDate(previous);
      const b = await getBooking(tx, previous.bookingId);
      if (!["PAID", "FREE"].includes(b.status)) fail(403, "Invalid Ticket");
      return { ticketId: previous.id, approvedAt: previous.approvedAt };
    }
    if (
      (await tx.all("SELECT id FROM checkins WHERE idempotencyKey = ?", [key]))
        .length
    )
      fail(409, "Idempotency key already used.");
    const b = await inspectIndividual(tx, token);
    if (!b) fail(404, "Invalid Ticket");
    if (b.status === "PENDING_CASH") {
      if (!["ADMIN", "staff"].includes(user.role))
        fail(403, "Only an admin can collect cash at the gate.");
      if (amountReceived !== b.amount)
        fail(400, "Collect the exact booking amount before entry.");
      await approveCashInTransaction(tx, b.id, amountReceived, userId);
    } else if (!["PAID", "FREE"].includes(b.status))
      fail(403, "Payment is not confirmed.");
    const at = now();
    const changed = await tx.run(
      "UPDATE individual_tickets SET approvedAt = ?,approvedBy = ?,approvalKey = ? WHERE id = ? AND approvedAt IS NULL",
      [at, userId, key, b.ticket.id],
    );
    if (changed.changes !== 1) fail(409, "Already Approved");
    const adults = b.ticket.category === "ADULT" ? 1 : 0;
    const kids = 1 - adults;
    const aggregate = (
      await tx.all("SELECT id FROM checkins WHERE bookingId = ?", [b.id])
    )[0];
    if (aggregate)
      await tx.run(
        "UPDATE checkins SET adults = adults + ?,kids = kids + ?,people = people + 1 WHERE bookingId = ?",
        [adults, kids, b.id],
      );
    else
      await tx.run(
        "INSERT INTO checkins (id,bookingId,staffId,eventDate,adults,kids,people,idempotencyKey,createdAt) VALUES (?,?,?,?,?,?,?,?,?)",
        [randomUUID(), b.id, userId, b.eventDate, adults, kids, 1, key, at],
      );
    const pending = (
      await tx.all(
        "SELECT id FROM individual_tickets WHERE bookingId = ? AND approvedAt IS NULL",
        [b.id],
      )
    ).length;
    if (!pending)
      await tx.run(
        "UPDATE bookings SET checkedInAt = ?,updatedAt = ? WHERE id = ?",
        [at, at, b.id],
      );
    await audit(tx, userId, "INDIVIDUAL_CHECKIN", b.ticket.id);
    return {
      ticketId: b.ticket.id,
      approvedAt: at,
      approved: b.people - pending,
      pending,
    };
  });
}
