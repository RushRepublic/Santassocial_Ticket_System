import { randomUUID, randomBytes } from "node:crypto";
import { paymentDemo, production, config } from "./config.js";
import { hash, qrToken } from "./security.js";
export class AppError extends Error {
  status;
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}
export const now = () => new Date().toISOString();
export const fail = (status, message) => {
  throw new AppError(status, message);
};
export async function settings(db) {
  return (await db.all("SELECT * FROM events WHERE id = ?", ["santa-2026"]))[0];
}
export async function lockEvent(tx) {
  return (
    await tx.all("SELECT * FROM events WHERE id = ? FOR UPDATE", ["santa-2026"])
  )[0];
}
// Retained for existing maintenance callers. Bookings have no payment deadline.
export async function expire(_tx) {}
export async function availability(db) {
  const event = await settings(db);
  return {
    ...event,
    capacity: null,
    day5Capacity: null,
    day6Capacity: null,
    holdMinutes: null,
    cashHoldMinutes: null,
    remaining: null,
    unlimited: true,
    days: ["2026-11-11", "2026-11-12"].map((date) => ({
      date,
      remaining: null,
      bookable: date >= eventToday(),
    })),
  };
}
export async function audit(tx, userId, action, entityId) {
  await tx.run(
    "INSERT INTO audit_logs (id,userId,action,entityId,createdAt) VALUES (?,?,?,?,?)",
    [randomUUID(), userId, action, entityId, now()],
  );
}
export async function notification(tx, b, type) {
  const exists = await tx.all(
    "SELECT id FROM notification_logs WHERE bookingId = ? AND type = ?",
    [b.id, type],
  );
  if (!exists.length)
    await tx.run(
      "INSERT INTO notification_logs (id,bookingId,type,status,nextAttemptAt) VALUES (?,?,?,?,?)",
      [randomUUID(), b.id, type, "QUEUED", now()],
    );
}
export async function activate(tx, b, status = "PAID") {
  await tx.run(
    "UPDATE bookings SET status = ?, qrHash = ?, updatedAt = ? WHERE id = ?",
    [status, hash(qrToken(b)), now(), b.id],
  );
  await notification(tx, b, "TICKET");
}
export function publicBooking(b) {
  const { ticketNonce, qrHash, gatewayOrderId, gatewayPaymentId, ...safe } = b;
  return {
    ...safe,
    holdUntil: null,
    qrToken: hasBookingQr(b) ? qrToken(b) : null,
    demo:
      paymentDemo ||
      gatewayOrderId?.startsWith("order_demo_") ||
      gatewayPaymentId?.startsWith("pay_demo_") ||
      false,
  };
}
export const hasBookingQr = (b) =>
  ["PAID", "FREE"].includes(b.status) ||
  (b.method === "CASH" && b.status === "PENDING_CASH");
export async function getBooking(db, id) {
  const b = (
    await db.all(
      "SELECT b.*,p.orderId AS gatewayOrderId,p.paymentId AS gatewayPaymentId FROM bookings b LEFT JOIN payments p ON p.bookingId = b.id WHERE b.id = ? OR b.reference = ?",
      [id, id],
    )
  )[0];
  if (!b) fail(404, "Booking not found.");
  return b;
}
export async function createBooking(db, input, mobile, key) {
  assertBookableDate(input.eventDate);
  const fingerprint = hash(JSON.stringify(input));
  return db.transaction(async (tx) => {
    const e = await lockEvent(tx);
    await expire(tx);
    const previous = (
      await tx.all("SELECT * FROM booking_requests WHERE id = ?", [key])
    )[0];
    if (previous) {
      if (previous.mobile !== mobile || previous.fingerprint !== fingerprint)
        fail(409, "This request key is already in use.");
      return getBooking(tx, previous.bookingId);
    }
    const people = input.adults + input.kids;
    if (people < 1 || people > e.maxGroup)
      fail(400, `Choose between 1 and ${e.maxGroup} guests.`);
    if (input.adults === 0 && !e.allowKidsOnly)
      fail(400, "A supervising adult is required for children under five.");
    const id = randomUUID(),
      amount = input.adults * 100,
      status =
        amount === 0
          ? "FREE"
          : input.method === "CASH"
            ? "PENDING_CASH"
            : "PENDING_PAYMENT";
    const b = {
      id,
      reference: `SS2026-${randomBytes(5).toString("hex").toUpperCase()}`,
      eventId: e.id,
      eventDate: input.eventDate,
      name: input.name,
      mobile,
      email: input.email,
      adults: input.adults,
      kids: input.kids,
      people,
      amount,
      method: amount === 0 ? "FREE" : input.method,
      status,
      // Legacy NOT NULL storage column; no longer a payment deadline.
      holdUntil: now(),
      ticketNonce: randomBytes(32).toString("hex"),
      createdAt: now(),
      updatedAt: now(),
    };
    if (status === "PENDING_CASH") b.qrHash = hash(qrToken(b));
    const cols = Object.keys(b);
    await tx.run(
      `INSERT INTO bookings (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`,
      Object.values(b),
    );
    await tx.run(
      "INSERT INTO payments (id,bookingId,amount,status) VALUES (?,?,?,?)",
      [randomUUID(), id, amount, amount === 0 ? "FREE" : "PENDING"],
    );
    await tx.run(
      "INSERT INTO booking_requests (id,mobile,bookingId,fingerprint) VALUES (?,?,?,?)",
      [key, mobile, id, fingerprint],
    );
    if (amount === 0) await activate(tx, b, "FREE");
    else if (input.method === "CASH") await notification(tx, b, "CASH_PENDING");
    return getBooking(tx, id);
  });
}
export function assertBookableDate(date) {
  if (!["2026-11-11", "2026-11-12"].includes(date) || date < eventToday())
    fail(
      400,
      "This event date is no longer available for booking. Please choose an available date.",
    );
}
export async function replacePaymentMethod(db, id, mobile, method, key) {
  return db.transaction(async (tx) => {
    await lockEvent(tx);
    const original = await getBooking(tx, id);
    if (original.mobile !== mobile)
      fail(403, "This booking belongs to another customer.");
    const input = {
      name: original.name,
      email: original.email,
      eventDate: original.eventDate,
      adults: original.adults,
      kids: original.kids,
      method,
    };
    // Reuse booking-request idempotency inside this same transaction.
    const nested = { transaction: (work) => work(tx) };
    const previous = await tx.all(
      "SELECT id FROM booking_requests WHERE id = ?",
      [key],
    );
    if (previous.length) return createBooking(nested, input, mobile, key);
    if (original.method === method) return original;
    if (
      !["PENDING_CASH", "PENDING_PAYMENT"].includes(original.status) ||
      original.checkedInAt
    )
      fail(
        409,
        "This booking can no longer change payment method. Check your ticket or payment status.",
      );
    const payment = (
      await tx.all("SELECT * FROM payments WHERE bookingId = ? FOR UPDATE", [
        id,
      ])
    )[0];
    if (
      payment?.status === "CAPTURED" ||
      payment?.orderId?.startsWith("creating_")
    )
      fail(
        409,
        "Payment is being processed. Check payment status before changing method.",
      );
    // Keep original payment evidence for delayed gateway callbacks. A late
    // capture on this cancelled booking becomes PAYMENT_REVIEW, never admission.
    await tx.run(
      "UPDATE bookings SET status = 'CANCELLED', updatedAt = ? WHERE id = ?",
      [now(), id],
    );
    const replacement = await createBooking(nested, input, mobile, key);
    await audit(tx, null, `PAYMENT_METHOD_REPLACED:${replacement.id}`, id);
    return replacement;
  });
}
export async function settleCaptured(
  db,
  orderId,
  paymentId,
  amount,
  currency,
  event,
) {
  return db.transaction(async (tx) => {
    const e = await lockEvent(tx);
    if (
      event &&
      (await tx.all("SELECT id FROM webhook_events WHERE id = ?", [event.id]))
        .length
    )
      return;
    const p = (
      await tx.all("SELECT * FROM payments WHERE orderId = ? FOR UPDATE", [
        orderId,
      ])
    )[0];
    if (!p) fail(404, "Payment order not found.");
    const b = await getBooking(tx, p.bookingId);
    if (b.method !== "RAZORPAY" || amount !== b.amount || currency !== "INR")
      fail(400, "Payment evidence does not match this booking.");
    if (p.paymentId && p.paymentId !== paymentId)
      fail(409, "A different payment is already recorded.");
    if (p.status !== "CAPTURED") {
      await expire(tx);
      const current = await getBooking(tx, b.id);
      let status = "PAID";
      if (!["PAID", "FREE"].includes(current.status)) {
        if (["CANCELLED", "PAYMENT_REVIEW"].includes(current.status))
          status = "PAYMENT_REVIEW";
        if (status === "PAID") await activate(tx, b);
        else {
          await tx.run(
            "UPDATE bookings SET status = 'PAYMENT_REVIEW', updatedAt = ? WHERE id = ?",
            [now(), b.id],
          );
          await notification(tx, b, "PAYMENT_REVIEW");
        }
      }
      await tx.run(
        "UPDATE payments SET paymentId = ?, status = 'CAPTURED', approvedAt = ? WHERE id = ?",
        [paymentId, now(), p.id],
      );
      await audit(tx, null, "RAZORPAY_CAPTURED", b.id);
    }
    if (event)
      await tx.run(
        "INSERT INTO webhook_events (id,eventType,createdAt) VALUES (?,?,?)",
        [event.id, event.type, now()],
      );
  });
}
export async function approveCash(db, id, amount, userId) {
  return db.transaction(async (tx) => {
    await lockEvent(tx);
    await expire(tx);
    return approveCashInTransaction(tx, id, amount, userId);
  });
}
async function approveCashInTransaction(tx, id, amount, userId) {
  const b = await getBooking(tx, id);
  validateTicketDate(b);
  if (b.method !== "CASH")
    fail(400, "Only cash bookings can be approved here.");
  const p = (
    await tx.all("SELECT * FROM payments WHERE bookingId = ?", [id])
  )[0];
  if (b.status === "PAID") return publicBooking(b);
  if (b.status !== "PENDING_CASH")
    fail(
      409,
      "Booking is no longer reserved. Restore it before collecting cash.",
    );
  if (amount !== b.amount)
    fail(400, "Amount received must match the booking total in paise.");
  await tx.run(
    "UPDATE payments SET status = 'CAPTURED',receipt = ?,approvedBy = ?,approvedAt = ? WHERE id = ?",
    [
      `CASH-${randomBytes(6).toString("hex").toUpperCase()}`,
      userId,
      now(),
      p.id,
    ],
  );
  await activate(tx, b);
  await audit(tx, userId, "CASH_APPROVED", id);
  return publicBooking(await getBooking(tx, id));
}
export function istCalendarDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
export function eventToday() {
  // A fixed date is permitted only for isolated local demo/test runs.
  return paymentDemo && !production ? config.demoDate : istCalendarDate();
}
export function validateTicketDate(booking) {
  const scanningDate = eventToday();
  if (
    booking.eventDate === scanningDate &&
    ["2026-11-11", "2026-11-12"].includes(scanningDate)
  )
    return;
  const label = (date) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Kolkata",
      month: "long",
      day: "numeric",
      year: "numeric",
    }).format(new Date(`${date}T12:00:00+05:30`));
  const eventDay = ["2026-11-11", "2026-11-12"].includes(scanningDate);
  const direction = booking.eventDate < scanningDate ? "Past" : "Future";
  const title = eventDay
    ? `Invalid Ticket \u2013 ${direction} Event Date`
    : "Invalid Ticket \u2013 Event Not Taking Place Today";
  const message = `This ticket is registered for ${label(booking.eventDate)}, and cannot be used on ${label(scanningDate)}.`;
  throw new AppError(400, message, {
    code: eventDay ? `${direction.toUpperCase()}_EVENT_DATE` : "NOT_EVENT_DAY",
    title,
    eventDate: booking.eventDate,
    scanningDate,
  });
}
export async function inspectTicket(db, token) {
  const b = (
    await db.all(
      "SELECT b.*,p.orderId AS gatewayOrderId,p.paymentId AS gatewayPaymentId FROM bookings b LEFT JOIN payments p ON p.bookingId = b.id WHERE b.qrHash = ?",
      [hash(token)],
    )
  )[0];
  if (!b) fail(404, "INVALID TICKET: This QR code is not recognised.");
  if (!paymentDemo && b.method === "RAZORPAY" && publicBooking(b).demo)
    fail(
      403,
      "TEST PAYMENT: This simulated online ticket is not valid for admission.",
    );
  if (b.checkedInAt)
    fail(
      409,
      `ALREADY CHECKED IN: ${new Date(b.checkedInAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`,
    );
  if (!hasBookingQr(b)) fail(403, "PAYMENT PENDING: Entry is not permitted.");
  validateTicketDate(b);
  return b;
}
export async function verifyTicket(db, token) {
  const b = await inspectTicket(db, token);
  if (!["PAID", "FREE"].includes(b.status))
    fail(403, "PAYMENT PENDING: Collect cash and approve before entry.");
  return b;
}
export async function checkin(db, token, userId, key, amountReceived) {
  return db.transaction(async (tx) => {
    await lockEvent(tx);
    const previous = (
      await tx.all("SELECT * FROM checkins WHERE idempotencyKey = ?", [key])
    )[0];
    if (previous) {
      const b = await getBooking(tx, previous.bookingId);
      if (b.qrHash !== hash(token) || previous.staffId !== userId)
        fail(409, "Idempotency key already used.");
      validateTicketDate(b);
      return previous;
    }
    if (amountReceived !== undefined) {
      // Authorize collection here too, so direct service calls cannot bypass it.
      const collector = (
        await tx.all("SELECT role FROM users WHERE id = ? AND active = 1", [
          userId,
        ])
      )[0];
      if (collector?.role !== "ADMIN")
        fail(403, "Only an admin can collect cash at the gate.");
      const pending = await inspectTicket(tx, token);
      if (pending.method !== "CASH")
        fail(400, "Only cash bookings can be collected here.");
      await expire(tx);
      await approveCashInTransaction(tx, pending.id, amountReceived, userId);
    }
    const b = await verifyTicket(tx, token);
    const at = now();
    const result = await tx.run(
      "UPDATE bookings SET checkedInAt = ?, updatedAt = ? WHERE id = ? AND checkedInAt IS NULL",
      [at, at, b.id],
    );
    if (result.changes !== 1) fail(409, "ALREADY CHECKED IN");
    const entry = {
      id: randomUUID(),
      bookingId: b.id,
      staffId: userId,
      eventDate: b.eventDate,
      adults: b.adults,
      kids: b.kids,
      people: b.people,
      idempotencyKey: key,
      createdAt: at,
    };
    const cols = Object.keys(entry);
    await tx.run(
      `INSERT INTO checkins (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`,
      Object.values(entry),
    );
    await audit(tx, userId, "GROUP_CHECKIN", b.id);
    return entry;
  });
}
