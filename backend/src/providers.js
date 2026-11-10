import Razorpay from "razorpay";
import nodemailer from "nodemailer";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { demo, whatsappDemo, paymentDemo, config } from "./config.js";
import {
  AppError,
  getBooking,
  hasBookingQr,
  publicBooking,
  now,
  settleCaptured,
} from "./services.js";
import { qrToken } from "./security.js";
import { createAskevaMessaging } from "./askeva.js";
let messaging;
export async function getMessaging() {
  if (messaging) return messaging;
  if (whatsappDemo)
    return (messaging = { async sendOtp() {}, async sendNotification() {} });
  const file = process.env.ASKEVA_ADAPTER_MODULE;
  if (!file) return (messaging = createAskevaMessaging());
  const module = await import(pathToFileURL(resolve(file)).href);
  messaging = module.default;
  if (
    typeof messaging?.sendOtp !== "function" ||
    typeof messaging?.sendNotification !== "function"
  )
    throw Error("Invalid messaging adapter.");
  return messaging;
}
export function razorpay() {
  if (paymentDemo)
    throw new AppError(400, "Live payments are disabled in payment demo mode.");
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET)
    throw new AppError(
      503,
      "Online payment is not configured. Please choose cash.",
    );
  return new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });
}
async function emailFallback(b, type) {
  if (!process.env.SMTP_HOST || !process.env.SMTP_FROM)
    throw Error("SMTP is not configured.");
  const port = Number(process.env.SMTP_PORT || 587);
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    requireTLS: port !== 465,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
      : undefined,
    connectionTimeout: 10000,
    socketTimeout: 15000,
  });
  const active = ["PAID", "FREE"].includes(b.status);
  const text = [
    `Santa Social 9th Edition`,
    type === "TICKET" && active
      ? "Your group ticket is ready."
      : "Your booking update",
    `Booking: ${b.reference}`,
    `Date: ${b.eventDate}`,
    `Adults: ${b.adults} | Kids: ${b.kids} | Guests: ${b.people}`,
    `Amount: INR ${b.amount / 100}`,
    hasBookingQr(b)
      ? `Secure ticket: ${config.origin}/ticket/${b.id}#${qrToken(b)}`
      : `Status: ${b.status}. This is not an entry ticket.`,
    "Please ensure your entire group arrives together.",
  ].join("\n\n");
  await transport.sendMail({
    from: process.env.SMTP_FROM,
    to: b.email,
    subject: `Santa Social · ${b.reference}`,
    text,
  });
}
export async function dispatchNotifications(db, provider) {
  const jobs = await db.all(
    "SELECT * FROM notification_logs WHERE status IN ('QUEUED','RETRY') AND nextAttemptAt <= ? AND attempts < 5 LIMIT 20",
    [now()],
  );
  for (const job of jobs) {
    try {
      const b = await getBooking(db, job.bookingId);
      if (
        (job.type === "CASH_PENDING" && b.status !== "PENDING_CASH") ||
        (!paymentDemo && b.method === "RAZORPAY" && publicBooking(b).demo)
      ) {
        await db.run(
          "UPDATE notification_logs SET status = 'SUPERSEDED' WHERE id = ?",
          [job.id],
        );
        continue;
      }
      await (provider || (await getMessaging())).sendNotification({
        mobile: b.mobile,
        name: b.name,
        status: b.status,
        type: job.type,
        reference: b.reference,
        amount: b.amount,
        eventDate: b.eventDate,
        adults: b.adults,
        kids: b.kids,
        ticketLink: hasBookingQr(b)
          ? `${config.origin}/ticket/${b.id}#${qrToken(b)}`
          : undefined,
      });
      await db.run(
        "UPDATE notification_logs SET status = ?, attempts = attempts + 1, sentAt = ? WHERE id = ?",
        [whatsappDemo ? "DEMO_SENT" : "SENT", now(), job.id],
      );
    } catch {
      if (!demo && job.attempts >= 1) {
        try {
          await emailFallback(await getBooking(db, job.bookingId), job.type);
          await db.run(
            "UPDATE notification_logs SET status = 'EMAIL_SENT', attempts = attempts + 1, sentAt = ? WHERE id = ?",
            [now(), job.id],
          );
          continue;
        } catch {
          /* Keep the original notification retryable. */
        }
      }
      await db.run(
        "UPDATE notification_logs SET status = ?, attempts = attempts + 1, nextAttemptAt = ?, lastError = ? WHERE id = ?",
        [
          job.attempts >= 4 ? "FAILED" : "RETRY",
          new Date(Date.now() + 60000 * 2 ** job.attempts).toISOString(),
          "Provider delivery failed; inspect provider dashboard.",
          job.id,
        ],
      );
    }
  }
}
let reconcileCursor = "";
export async function reconcilePayments(db) {
  if (
    paymentDemo ||
    !process.env.RAZORPAY_KEY_ID ||
    !process.env.RAZORPAY_KEY_SECRET
  )
    return;
  const rows = await db.all(
    "SELECT p.orderId FROM payments p JOIN bookings b ON b.id = p.bookingId WHERE b.method = 'RAZORPAY' AND p.status = 'PENDING' AND p.orderId > ? AND p.orderId NOT LIKE 'creating_%' AND p.orderId NOT LIKE 'order_demo_%' ORDER BY p.orderId LIMIT 25",
    [reconcileCursor],
  );
  if (!rows.length) {
    reconcileCursor = "";
    return;
  }
  for (const row of rows) {
    try {
      const collection = await razorpay().orders.fetchPayments(row.orderId);
      for (const payment of collection.items)
        if (
          payment.status === "captured" &&
          Number(payment.amount_refunded || 0) === 0
        )
          await settleCaptured(
            db,
            row.orderId,
            payment.id,
            Number(payment.amount),
            payment.currency,
          );
    } catch {
      console.error("Payment reconciliation will retry a pending order.");
    }
    reconcileCursor = row.orderId;
  }
}
