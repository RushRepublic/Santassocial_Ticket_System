import { AppError } from "./services.js";

// Supplied AskEVA PDF, pages 2-7 and 28-34. Never log the URL: its
// token query parameter is a credential. No redirects or automatic OTP retries.
const endpoint = "https://backend.askeva.io/v1/message/send-message";
const text = (value) => ({ type: "text", text: String(value) });
const body = (values) => ({ type: "body", parameters: values.map(text) });
const deliveryError = () =>
  new AppError(
    503,
    "WhatsApp delivery failed. Please try again shortly or contact the organiser.",
  );

export function createAskevaMessaging({
  apiKey = process.env.ASKEVA_API_KEY,
  otpTemplate = process.env.ASKEVA_OTP_TEMPLATE || "santa_social_otp",
  ticketTemplate = process.env.ASKEVA_TICKET_TEMPLATE || "santa_social_ticket",
  language = process.env.ASKEVA_LANGUAGE || "en",
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!apiKey?.trim()) throw Error("ASKEVA_API_KEY is required.");
  if (
    ![otpTemplate, ticketTemplate].every((v) => /^[a-z0-9_]+$/.test(v)) ||
    !/^[a-z]{2}(?:_[A-Z]{2})?$/.test(language)
  )
    throw Error("Invalid AskEVA template name or language.");

  async function send(mobile, name, components) {
    if (!/^[6-9]\d{9}$/.test(mobile))
      throw Error("Invalid WhatsApp recipient.");
    const url = new URL(endpoint);
    url.searchParams.set("token", apiKey.trim());
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        redirect: "error",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(15000),
        body: JSON.stringify({
          to: `91${mobile}`,
          type: "template",
          template: {
            name,
            language: { policy: "deterministic", code: language },
            components,
          },
        }),
      });
      const result = await response.json();
      // HTTP 200 alone is insufficient: provider errors can be JSON bodies.
      if (
        !response.ok ||
        result.error ||
        result.code ||
        !result.messages?.some(
          (message) => typeof message.id === "string" && message.id,
        )
      )
        throw deliveryError();
      return { messageId: result.messages[0].id };
    } catch {
      // Provider bodies/network exceptions may contain tokens or customer data.
      throw deliveryError();
    }
  }

  return {
    async sendOtp(mobile, otp) {
      if (!/^\d{6}$/.test(otp)) throw Error("Invalid OTP.");
      return send(mobile, otpTemplate, [
        body([otp]),
        {
          type: "button",
          sub_type: "url",
          index: "0",
          parameters: [text(otp)],
        },
      ]);
    },
    async sendNotification(message) {
      const {
        mobile,
        name,
        reference,
        eventDate,
        adults,
        kids,
        status,
        amount,
        ticketLink,
        type,
      } = message;
      // PAYMENT_REVIEW is not an issued ticket and must never receive this template.
      if (
        !["TICKET", "CASH_PENDING"].includes(type) ||
        !["PAID", "FREE", "PENDING_CASH"].includes(status) ||
        !ticketLink
      )
        throw Error("No deliverable ticket for this booking update.");
      const link = new URL(ticketLink);
      if (link.protocol !== "https:" || !/^#ss_[a-f0-9]{64}$/.test(link.hash))
        throw Error("A secure HTTPS ticket link is required.");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate))
        throw Error("Invalid event date.");
      const date = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Kolkata",
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      }).format(new Date(`${eventDate}T00:00:00+05:30`));
      const money = new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
      }).format(amount / 100);
      const payment =
        status === "PENDING_CASH"
          ? `Cash due: ${money}. Approval required before entry.`
          : status === "FREE"
            ? "Free ticket"
            : `Paid: ${money}`;
      return send(mobile, ticketTemplate, [
        body([name, reference, date, adults, kids, payment, ticketLink]),
      ]);
    },
  };
}
