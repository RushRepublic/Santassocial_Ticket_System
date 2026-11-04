"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  ArrowLeft,
  Minus,
  Plus,
  ShieldCheck,
  Ticket,
  Check,
  MessageCircle,
  Users,
  CalendarDays,
  CreditCard,
  Banknote,
  LockKeyhole,
} from "lucide-react";
import { z } from "zod";
import QRCode from "qrcode";
import { api, post, money, eventDate } from "@/lib/api";
import { VenueLocation, Notice, Loading, Status } from "./common";
import { MobileVerification } from "./mobile-verification";
const initial = {
  name: "",
  email: "",
  mobile: "",
  eventDate: "2026-12-05",
  adults: 1,
  kids: 0,
  method: "RAZORPAY",
  key: "",
};
const draftSchema = z.object({
  name: z.string().trim().min(2, "Please enter your full name.").max(120),
  email: z.email("Please enter a valid email address."),
  mobile: z
    .string()
    .regex(/^[6-9]\d{9}$/, "Please enter a valid Indian mobile number."),
});
function readDraft() {
  try {
    return JSON.parse(sessionStorage.getItem("santa-draft") || "null");
  } catch {
    return null;
  }
}
function saveDraft(draft) {
  sessionStorage.setItem("santa-draft", JSON.stringify(draft));
}
export function Steps({ step }) {
  return (
    <div className="steps">
      {["Your booking", "Checkout"].map((s, i) => (
        <div key={s} className={step >= i + 1 ? "active" : ""}>
          <span>{step > i + 1 ? <Check size={13} /> : i + 1}</span>
          <small>{s}</small>
          {i < 1 && <i />}
        </div>
      ))}
    </div>
  );
}
export function BookingSidebar({ draft, children, showVenue = true }) {
  return (
    <aside className="booking-sidebar">
      <div className="sidebar-body">
        <p className="eyebrow">SANTA SOCIAL · 9TH EDITION</p>
        {showVenue && (
          <div className="event-details">
            <VenueLocation />
          </div>
        )}
        <div className="summary">
          <h3>Booking summary</h3>
          <p>
            <span>
              {eventDate(draft.eventDate).split(",")[0]},{" "}
              {draft.eventDate.endsWith("05") ? "5" : "6"} December
            </span>
            <CalendarDays size={17} />
          </p>
          <p>
            <span>{draft.adults} × Adult ticket</span>
            <b>{money(draft.adults * 20000)}</b>
          </p>
          <p>
            <span>{draft.kids} × Kids ticket</span>
            <b>Free</b>
          </p>
          <p className="summary-total">
            <span>Total</span>
            <strong>{money(draft.adults * 20000)}</strong>
          </p>
          <small>{draft.adults + draft.kids} guests · 1 group QR ticket</small>
        </div>
        {children}
        <div className="group-note">
          <Users size={20} />
          <p>
            Your whole group enters together.
            <br />
            Keep your QR ticket handy at the gate.
          </p>
        </div>
      </div>
    </aside>
  );
}
export function Register() {
  const router = useRouter();
  const [draft, setDraft] = useState(initial);
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState("");
  const [verifiedMobile, setVerifiedMobile] = useState("");
  const [verificationRevision, setVerificationRevision] = useState(0);
  const [openingCheckout, setOpeningCheckout] = useState(false);
  useEffect(() => {
    setDraft(readDraft() || { ...initial, key: crypto.randomUUID() });
    api("/events")
      .then((d) => setSettings(d.event))
      .catch((e) => setError(e.message));
  }, []);
  const update = (values) => {
    if (values.mobile !== undefined && values.mobile !== draft.mobile)
      setVerifiedMobile("");
    setDraft({ ...draft, ...values, bookingId: undefined });
  };
  async function next(e) {
    e.preventDefault();
    setError("");
    const parsed = draftSchema.safeParse(draft);
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    if (draft.adults + draft.kids < 1)
      return setError("Please select at least one guest.");
    if (!draft.adults && !settings?.allowKidsOnly)
      return setError(
        "Please include a supervising adult for children under five.",
      );
    if (!verifiedMobile || verifiedMobile !== draft.mobile)
      return setError(
        "Please verify your WhatsApp mobile number before checkout.",
      );
    setOpeningCheckout(true);
    try {
      const identity = await api("/auth/me?scope=customer");
      if (identity.mobile !== draft.mobile) {
        setVerifiedMobile("");
        setVerificationRevision((value) => value + 1);
        throw new Error("Please verify your WhatsApp mobile number again.");
      }
      saveDraft({ ...draft, ...parsed.data, key: crypto.randomUUID() });
      router.push("/checkout");
    } catch (error) {
      setError(error.message);
      if (error.status === 401) {
        setVerifiedMobile("");
        setVerificationRevision((value) => value + 1);
      }
      setOpeningCheckout(false);
    }
  }
  return (
    <main className="booking-page">
      <Steps step={1} />
      <div className="booking-layout registration-layout">
        <form className="form-card" onSubmit={next}>
          <div className="form-section">
            <div className="section-label">
              <span>01</span>
              <div>
                <h2>Pick your day</h2>
              </div>
            </div>
            <div className="event-details">
              <VenueLocation />
            </div>
            <div className="date-options">
              {[
                ["2026-12-05", "SATURDAY", "05"],
                ["2026-12-06", "SUNDAY", "06"],
              ].map(([date, day, n]) => (
                <button
                  type="button"
                  className={`date-option ${draft.eventDate === date ? "selected" : ""}`}
                  key={date}
                  onClick={() => update({ eventDate: date })}
                >
                  <span className="date-number">{n}</span>
                  <span>
                    <small>{day}</small>
                    <b>Dec 2026</b>
                    <em>11:00 AM – 9:00 PM</em>
                  </span>
                  <span className="radio-dot" />
                </button>
              ))}
            </div>
            <p className="field-hint">
              Coming on both days? Make a separate booking for each day.
            </p>
          </div>
          <div className="form-section">
            <div className="section-label">
              <span>02</span>
              <div>
                <h2>Registration Details</h2>
              </div>
            </div>
            <label>
              Full name <span>*</span>
              <input
                autoComplete="name"
                required
                value={draft.name}
                onChange={(e) => update({ name: e.target.value })}
                placeholder="Your full name"
                maxLength={120}
              />
            </label>
            <MobileVerification
              key={verificationRevision}
              mobile={draft.mobile}
              onChange={(mobile) => update({ mobile })}
              onVerified={setVerifiedMobile}
              disabled={openingCheckout}
            />
            <label>
              Email address <span>*</span>
              <input
                type="email"
                autoComplete="email"
                required
                value={draft.email}
                onChange={(e) => update({ email: e.target.value })}
                placeholder="you@example.com"
                maxLength={190}
              />
            </label>
          </div>
          <div className="form-section">
            <div className="section-label">
              <span>03</span>
              <div>
                <h2>Bring your favourite people</h2>
              </div>
            </div>
            {["adults", "kids"].map((kind) => (
              <div className="quantity-row" key={kind}>
                <div className="quantity-icon">
                  {kind === "adults" ? <Ticket /> : <Users />}
                </div>
                <div>
                  <h3>
                    {kind === "adults" ? "Adults" : "Little ones"}{" "}
                    <b>{kind === "adults" ? "₹200" : "Free"}</b>
                  </h3>
                  <p>
                    {kind === "adults"
                      ? "Ages 5 years and above"
                      : "Children below 5 years"}
                  </p>
                </div>
                <div className="quantity-control">
                  <button
                    type="button"
                    aria-label={`Remove ${kind}`}
                    disabled={draft[kind] === 0}
                    onClick={() =>
                      update({ [kind]: Math.max(0, draft[kind] - 1) })
                    }
                  >
                    <Minus size={15} />
                  </button>
                  <output aria-label={`${kind} quantity`}>{draft[kind]}</output>
                  <button
                    type="button"
                    aria-label={`Add ${kind}`}
                    disabled={
                      draft.adults + draft.kids >= (settings?.maxGroup || 20)
                    }
                    onClick={() => update({ [kind]: draft[kind] + 1 })}
                  >
                    <Plus size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
          {error && <Notice>{error}</Notice>}
          <button
            className="button full"
            type="submit"
            disabled={
              !settings ||
              !verifiedMobile ||
              verifiedMobile !== draft.mobile ||
              openingCheckout
            }
          >
            {openingCheckout ? "Opening checkout…" : "Checkout"}{" "}
            <ArrowRight size={18} />
          </button>
          <p className="secure-note">
            <ShieldCheck size={15} /> Your details are safe with us.
          </p>
        </form>
      </div>
    </main>
  );
}
export function OtpVerification({ mobile, onVerified, onChange }) {
  const [challenge, setChallenge] = useState("");
  const [otp, setOtp] = useState("");
  const [demoCode, setDemoCode] = useState("");
  const [resend, setResend] = useState(0);
  const [expiry, setExpiry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const t = setInterval(() => {
      setResend((n) => Math.max(0, n - 1));
      setExpiry((n) => Math.max(0, n - 1));
    }, 1000);
    return () => clearInterval(t);
  }, []);
  async function send() {
    setBusy(true);
    setError("");
    try {
      const r = await post("/otp/send", { mobile });
      setChallenge(r.challengeId);
      setDemoCode(r.demoCode || "");
      setResend(60);
      setExpiry(r.expiresIn);
      setOtp("");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function verify(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await post("/otp/verify", { mobile, challengeId: challenge, otp });
      onVerified();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="otp-content">
      <div className="round-icon">
        <MessageCircle size={28} />
      </div>
      <h1>A quick hello on WhatsApp.</h1>
      <p>
        Verify <b>+91 {mobile}</b> to keep your tickets safe.
      </p>
      {onChange && (
        <button type="button" className="text-button" onClick={onChange}>
          Change mobile number
        </button>
      )}
      {demoCode && (
        <div className="demo-code">
          Development simulation · Your demo code is <b>{demoCode}</b>
          <br />
          <small>No WhatsApp message was sent.</small>
        </div>
      )}
      {!challenge ? (
        <button className="button full" disabled={busy} onClick={send}>
          {busy ? "Sending…" : "Send WhatsApp verification code"}
          <ArrowRight size={18} />
        </button>
      ) : (
        <form onSubmit={verify}>
          <label htmlFor="otp">Enter your 6-digit code</label>
          <input
            id="otp"
            className="otp-input"
            value={otp}
            onChange={(e) =>
              setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))
            }
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            minLength={6}
            required
            autoFocus
            placeholder="• • • • • •"
          />
          <p className="field-hint">
            {expiry
              ? `Code expires in ${Math.floor(expiry / 60)}:${String(expiry % 60).padStart(2, "0")}`
              : "Code expired. Request a new code."}
          </p>
          <button
            className="button full"
            disabled={busy || otp.length !== 6 || !expiry}
          >
            {busy ? "Verifying…" : "Verify & continue"}
            <ArrowRight size={18} />
          </button>
          <button
            className="text-button"
            type="button"
            disabled={busy || resend > 0}
            onClick={send}
          >
            {resend ? `Resend code in ${resend}s` : "Resend verification code"}
          </button>
        </form>
      )}
      {error && <Notice>{error}</Notice>}
      <p className="secure-note">
        <LockKeyhole size={15} /> Your code expires in 5 minutes. Maximum 5
        attempts.
      </p>
    </div>
  );
}
async function loadCheckout() {
  if (window.Razorpay) return;
  await new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve();
    s.onerror = () =>
      reject(new Error("Could not load Razorpay. Please try again."));
    document.body.appendChild(s);
  });
}
export function Checkout() {
  const router = useRouter();
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [demoBooking, setDemoBooking] = useState(null);
  const [agreed, setAgreed] = useState(false);
  useEffect(() => {
    async function restore() {
      const bookingId = new URLSearchParams(location.search).get("id");
      if (bookingId) {
        try {
          const b = await api(`/bookings/${bookingId}`);
          const d = {
            name: b.name,
            email: b.email,
            mobile: b.mobile,
            eventDate: b.eventDate,
            adults: b.adults,
            kids: b.kids,
            method: b.method === "CASH" ? "CASH" : "RAZORPAY",
            bookingId: b.id,
            key: crypto.randomUUID(),
          };
          saveDraft(d);
          setDraft(d);
        } catch {
          router.replace("/retrieve-ticket");
        }
        return;
      }
      const d = readDraft();
      if (!d) {
        router.replace("/");
        return;
      }
      api("/auth/me?scope=customer")
        .then((user) => {
          if (user.mobile !== d.mobile) router.replace("/");
          else setDraft(d);
        })
        .catch(() => router.replace("/"));
    }
    void restore();
  }, [router]);
  function success(b) {
    sessionStorage.setItem("santa-last-booking", b.id);
    router.push(
      `${b.status === "PENDING_CASH" ? "/booking-pending" : "/booking-success"}?id=${b.id}`,
    );
  }
  async function start() {
    if (!draft || busy) return;
    setBusy(true);
    setError("");
    try {
      const { key, mobile, bookingId, ...input } = draft;
      const b = bookingId
        ? await api(`/bookings/${bookingId}`)
        : await post("/bookings", input, { "Idempotency-Key": key });
      const updated = { ...draft, bookingId: b.id };
      saveDraft(updated);
      setDraft(updated);
      if (
        b.status === "PENDING_CASH" ||
        b.status === "FREE" ||
        b.status === "PAID"
      ) {
        success(b);
        return;
      }
      if (b.status !== "PENDING_PAYMENT")
        throw Error(
          `Booking is ${b.status.toLowerCase().replaceAll("_", " ")}. Start a new booking or contact the organiser.`,
        );
      const order = await post("/payments/razorpay/order", { bookingId: b.id });
      if (order.demo) {
        setDemoBooking(b);
        setBusy(false);
        return;
      }
      await loadCheckout();
      const checkout = new window.Razorpay({
        key: order.keyId,
        order_id: order.orderId,
        amount: order.amount,
        currency: "INR",
        name: "Santa Social 9th Edition",
        description: `Group booking · ${b.reference}`,
        prefill: { name: b.name, email: b.email, contact: `+91${b.mobile}` },
        theme: { color: "#8a1d23" },
        modal: {
          ondismiss: () => {
            setBusy(false);
            setError(
              "Payment window closed. Your booking is saved; retry before the reservation expires.",
            );
          },
        },
        handler: async (result) => {
          try {
            await post("/payments/razorpay/verify", {
              bookingId: b.id,
              ...result,
            });
            router.push(`/booking-success?id=${b.id}`);
          } catch (e) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        },
      });
      checkout.on("payment.failed", () => {
        setError("Payment failed. Your booking is saved; please try again.");
        setBusy(false);
      });
      checkout.open();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }
  async function demoComplete() {
    if (!demoBooking) return;
    setBusy(true);
    try {
      success(
        await post("/demo/payments/complete", { bookingId: demoBooking.id }),
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
      setDemoBooking(null);
    }
  }
  if (!draft) return <Loading />;
  return (
    <main className="booking-page">
      <Steps step={2} />
      <div className="booking-layout checkout-layout">
        <div className="form-card">
          <div className="section-label">
            <span>
              <Check size={16} />
            </span>
            <div>
              <h2>You’re verified, {draft.name.split(" ")[0]}.</h2>
              <p>
                +91 {draft.mobile} · {draft.email}
              </p>
            </div>
          </div>
          <BookingSidebar draft={draft} showVenue={false} />
          <div className="form-section">
            <h2>How would you like to pay?</h2>
            <p className="muted">Choose what works for you.</p>
            {["RAZORPAY", "CASH"].map((method) => (
              <button
                type="button"
                disabled={!!draft.bookingId}
                key={method}
                className={`payment-option ${draft.method === method ? "selected" : ""}`}
                onClick={() => {
                  const d = { ...draft, method };
                  saveDraft(d);
                  setDraft(d);
                }}
              >
                {method === "RAZORPAY" ? <CreditCard /> : <Banknote />}
                <span>
                  <b>
                    {method === "RAZORPAY"
                      ? "Pay online"
                      : "Pay cash at the counter"}
                  </b>
                  <small>
                    {method === "RAZORPAY"
                      ? "UPI, cards, netbanking · Powered by Razorpay"
                      : "Get your QR now. Pay cash and get approval at the counter"}
                  </small>
                </span>
                <span className="radio-dot" />
              </button>
            ))}
          </div>
          <div className="entry-rules">
            <h3>A few things before the fun</h3>
            <ul>
              <li>
                Your booking is valid only for {eventDate(draft.eventDate)}.
              </li>
              <li>
                All {draft.adults + draft.kids} guests must arrive together.
                Partial entry and re-entry are not supported.
              </li>
              <li>
                Children under 5 must be supervised by an adult, unless an
                approved event policy applies.
              </li>
              {draft.method === "CASH" && (
                <li>
                  Cash reservations expire. Complete payment before the time
                  shown on your booking.
                </li>
              )}
            </ul>
          </div>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
            />{" "}
            I have checked my booking and agree to these entry conditions.
          </label>
          {error && <Notice>{error}</Notice>}
          <button
            className="button full"
            disabled={!agreed || busy}
            onClick={start}
          >
            {busy
              ? "Preparing your booking…"
              : draft.adults === 0
                ? "Confirm free booking"
                : draft.method === "CASH"
                  ? "Reserve & pay at counter"
                  : `Continue to payment · ${money(draft.adults * 20000)}`}
            <ArrowRight size={18} />
          </button>
          <p className="secure-note">
            <ShieldCheck size={15} /> Payments are verified securely on our
            server.
          </p>
          <Link className="back-link" href="/">
            <ArrowLeft size={16} /> Edit booking
          </Link>
        </div>
      </div>
      {demoBooking && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Simulated demo payment"
        >
          <div className="modal-card">
            <p className="eyebrow">DEMO PAYMENT · NO REAL CHARGE</p>
            <h2>Try the complete ticket journey.</h2>
            <p>
              This simulates a successful payment of {money(demoBooking.amount)}
              . The resulting ticket is for demonstration only.
            </p>
            <button
              className="button full"
              autoFocus
              onClick={demoComplete}
              disabled={busy}
            >
              {busy ? "Confirming…" : "Simulate successful payment"}
            </button>
            <button
              className="text-button"
              disabled={busy}
              onClick={() => {
                setDemoBooking(null);
                setBusy(false);
              }}
            >
              Cancel demo payment
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
export function Confirmation() {
  const [booking, setBooking] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState("");
  useEffect(() => {
    let active = true;
    setQr("");
    if (booking?.qrToken && booking.status === "PENDING_CASH")
      QRCode.toDataURL(booking.qrToken, { width: 600, margin: 4 })
        .then((value) => {
          if (active) setQr(value);
        })
        .catch(() => {
          if (active)
            setError(
              "Unable to display your QR. Refresh booking status to retry.",
            );
        });
    return () => {
      active = false;
    };
  }, [booking]);
  async function load() {
    setBusy(true);
    setError("");
    const id =
      new URLSearchParams(location.search).get("id") ||
      sessionStorage.getItem("santa-last-booking");
    if (!id) {
      setError(
        "No booking selected. Retrieve your ticket using your mobile number.",
      );
      setBusy(false);
      return;
    }
    try {
      setBooking(await api(`/bookings/${id}`));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  const active = booking && ["PAID", "FREE"].includes(booking.status);
  return (
    <main className="booking-page">
      <div className="narrow-card confirmation">
        {error && <Notice>{error}</Notice>}
        {!booking && !error ? (
          <Loading />
        ) : (
          booking && (
            <>
              <div className="round-icon">
                {active ? <Check size={30} /> : <Ticket size={30} />}
              </div>
              <p className="eyebrow">
                {active ? "LET THE COUNTDOWN BEGIN" : "YOUR BOOKING IS SAVED"}
              </p>
              <h1>
                {active
                  ? "You’re on the guest list!"
                  : booking.status === "PENDING_CASH"
                    ? "See you at the payment counter."
                    : "Let’s check your booking."}
              </h1>
              <p>
                {active
                  ? "A little joy, a lot of memories. We can’t wait to see you."
                  : booking.status === "PENDING_CASH"
                    ? "Your group QR is ready. Show it at the counter to pay and get approval."
                    : "Your entry QR will become available once payment is verified."}
              </p>
              <Status value={booking.status} />
              <div className="confirmation-reference">
                <small>BOOKING REFERENCE</small>
                <strong>{booking.reference}</strong>
              </div>
              <div className="confirmation-info">
                <p>{eventDate(booking.eventDate)}</p>
                <p>
                  {booking.adults} adults + {booking.kids} kids ·{" "}
                  {booking.people} guests
                </p>
                <p>
                  {active ? "Amount paid" : "Amount due"}:{" "}
                  <b>{money(booking.amount)}</b>
                </p>
              </div>
              {booking.status === "PENDING_CASH" && (
                <div className="notice">
                  This confirmation is not an entry ticket. Pay{" "}
                  {money(booking.amount)} at the counter before{" "}
                  {new Date(booking.holdUntil).toLocaleString("en-IN", {
                    timeZone: "Asia/Kolkata",
                  })}{" "}
                  IST. Show your group QR. Entry requires payment approval.
                </div>
              )}
              {booking.status === "PENDING_CASH" && qr && (
                <div className="ticket-qr">
                  <img
                    src={qr}
                    alt="Cash booking group QR — payment approval required"
                    width={210}
                    height={210}
                  />
                  <p>
                    One QR for all {booking.people} guests. Cash payment
                    pending.
                  </p>
                  <a
                    className="button outline"
                    href={qr}
                    download={`${booking.reference}-qr.png`}
                  >
                    Save QR image
                  </a>
                  <Link className="back-link" href={`/ticket/${booking.id}`}>
                    View or download group ticket
                  </Link>
                </div>
              )}
              {booking.status === "PAYMENT_REVIEW" && (
                <Notice>
                  Your payment was captured after your reservation became
                  unavailable. Contact the organiser with this reference for
                  capacity review or a refund. No entry ticket has been
                  activated.
                </Notice>
              )}
              {active ? (
                <Link href={`/ticket/${booking.id}`} className="button full">
                  View your group ticket <ArrowRight size={18} />
                </Link>
              ) : (
                <button className="button full" onClick={load} disabled={busy}>
                  {busy ? "Checking…" : "Refresh booking status"}
                </button>
              )}
              {booking.status === "PENDING_PAYMENT" && (
                <Link
                  className="button outline full"
                  href={`/checkout?id=${booking.id}`}
                >
                  Resume payment
                </Link>
              )}
              <Link className="back-link" href="/retrieve-ticket">
                Find all my bookings
              </Link>
              {booking.demo && (
                <div className="demo-code">
                  DEMO BOOKING · Not valid for admission.
                </div>
              )}
            </>
          )
        )}
        {!booking && error && (
          <Link className="button" href="/retrieve-ticket">
            Retrieve ticket
          </Link>
        )}
      </div>
    </main>
  );
}
export function RetrieveTicket() {
  const [mobile, setMobile] = useState("");
  const [started, setStarted] = useState(false);
  const [verified, setVerified] = useState(false);
  const [bookings, setBookings] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function retrieve() {
    setBusy(true);
    setError("");
    try {
      setBookings(await post("/tickets/retrieve", {}));
      setVerified(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="booking-page">
      <div className="page-intro">
        <p className="eyebrow">YOUR CHRISTMAS PLANS, RIGHT HERE</p>
        <h1>Let’s find your ticket.</h1>
        <p>A quick mobile verification is all it takes.</p>
      </div>
      <div className="narrow-card">
        {!started ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setStarted(true);
            }}
          >
            <div className="round-icon">
              <Ticket size={28} />
            </div>
            <h2>Enter your registered mobile number</h2>
            <label>
              WhatsApp mobile number
              <div className="phone-input">
                <span>+91</span>
                <input
                  required
                  autoComplete="tel-national"
                  inputMode="numeric"
                  pattern="[6-9][0-9]{9}"
                  maxLength={10}
                  value={mobile}
                  onChange={(e) => setMobile(e.target.value.replace(/\D/g, ""))}
                  placeholder="10-digit mobile number"
                />
              </div>
            </label>
            <button className="button full">
              Find my bookings <ArrowRight size={18} />
            </button>
          </form>
        ) : !verified ? (
          <OtpVerification
            mobile={mobile}
            onChange={() => setStarted(false)}
            onVerified={retrieve}
          />
        ) : (
          <>
            <h2>Your bookings</h2>
            <p className="muted">Verified for +91 {mobile}</p>
            {!bookings.length && (
              <p>No bookings were found for this mobile number.</p>
            )}
            {bookings.map((b) => (
              <div className="retrieved-booking" key={b.id}>
                <div>
                  <b>{b.reference}</b>
                  <p>{eventDate(b.eventDate)}</p>
                  <small>
                    {b.people} guests · {money(b.amount)}
                  </small>
                  <Status value={b.status} />
                </div>
                <Link
                  className="button"
                  href={
                    ["PAID", "FREE"].includes(b.status)
                      ? `/ticket/${b.id}`
                      : `/booking-pending?id=${b.id}`
                  }
                >
                  View <ArrowRight size={16} />
                </Link>
              </div>
            ))}
            <button className="text-button" disabled={busy} onClick={retrieve}>
              Refresh bookings
            </button>
            <Link className="back-link" href="/">
              Book another day
            </Link>
          </>
        )}
        {busy && <Loading />}
        {error && <Notice>{error}</Notice>}
      </div>
    </main>
  );
}
