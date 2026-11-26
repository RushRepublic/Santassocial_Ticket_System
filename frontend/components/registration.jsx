"use client";
import { EVENT_DATES, EVENT_HOURS_LABEL } from "../../config/event-dates.js";
import { readLandingSignals, resolveLeadAttribution } from "../../config/lead-attribution.js";
import { useState, useEffect, useRef } from "react";
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
import { GroupTicket } from "./ticket";
import { TicketPolicies } from "./ticket-policies";
import { api, post, money, eventDate, eventMonthYear } from "@/lib/api";
import { discoverySources } from "@/lib/discovery-source";
import { VenueLocation, Notice, Loading, Status } from "./common";
import { MobileVerification } from "./mobile-verification";
import {
  ADULT_TICKET_PAISE,
  PLATFORM_FEE_PERCENT,
  quoteBooking,
  quoteSubtotal,
} from "../../backend/src/pricing.js";
const initial = {
  name: "",
  mobile: "",
  discoverySource: "",
  eventDate: EVENT_DATES[0],
  adults: 1,
  kids: 0,
  method: "RAZORPAY",
  key: "",
};
const draftSchema = z.object({
  eventDate: z.enum(EVENT_DATES, {
    error: "Please select an event date.",
  }),
  name: z.string().trim().min(2, "Please enter your full name.").max(120),
  mobile: z
    .string()
    .regex(/^[6-9]\d{9}$/, "Please enter a valid Indian mobile number."),
});
const discoverySourceSchema = z.enum(Object.keys(discoverySources));
const discoverySourceMessage = "Please select how you heard about Santa Social.";
const verifyMobileMessage = "Please verify your WhatsApp mobile number before continuing.";

function registrationIssue(draft, parsed, settings, verifiedMobile) {
  const invalid = parsed.success ? null : parsed.error.issues[0];
  if (invalid?.path[0] === "eventDate")
    return { field: "eventDate", message: invalid.message };
  if (!settings?.days.some((day) => day.date === draft.eventDate && day.bookable))
    return { field: "eventDate", message: "Please choose an available event date." };
  if (invalid) return { field: invalid.path[0], message: invalid.message };
  if (verifiedMobile !== draft.mobile)
    return { field: "verification", message: verifyMobileMessage };
  if (!discoverySourceSchema.safeParse(draft.discoverySource).success)
    return { field: "discoverySource", message: discoverySourceMessage };
  if (draft.adults + draft.kids < 1)
    return { field: "tickets", message: "Please select at least one guest." };
  if (draft.adults + draft.kids > settings.maxGroup)
    return { field: "tickets", message: `Choose no more than ${settings.maxGroup} guests.` };
  if (!draft.adults && !settings.allowKidsOnly)
    return { field: "tickets", message: "Please include a supervising adult for children under five." };
  return null;
}

function focusRegistrationField(field) {
  const selectors = {
    eventDate: ["#registration-date button:not(:disabled)", "#registration-date"],
    name: ["#registration-name"],
    mobile: ["#booking-mobile:not(:disabled)", ".mobile-verification"],
    verification: ["#booking-otp:not(:disabled)", ".mobile-verify-button:not(:disabled)", ".mobile-verification"],
    discoverySource: [".discovery-options input"],
    tickets: ['#registration-tickets button[aria-label="Add adults"]:not(:disabled)', "#registration-tickets button:not(:disabled)"],
  };
  const target = selectors[field].map((selector) => document.querySelector(selector)).find(Boolean);
  if (!target) return;
  target.focus({ preventScroll: true });
  requestAnimationFrame(() => {
    if (document.activeElement !== target) return;
    const group = target.closest("[data-registration-field]") || target;
    const viewport = window.visualViewport;
    const height = viewport?.height ?? window.innerHeight;
    const offset = viewport?.offsetTop ?? 0;
    const fullyVisible = (element) => {
      const { top, bottom } = element.getBoundingClientRect();
      return top >= offset + 16 && bottom <= offset + height - 16;
    };
    const message = group.querySelector(".error-text");
    if (fullyVisible(target) && (!message || fullyVisible(message))) return;
    const area = group.getBoundingClientRect().height < height - 48 ? group : target;
    area.scrollIntoView({
      block: "center",
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
    });
  });
}
function readDraft() {
  try {
    const draft = JSON.parse(sessionStorage.getItem("santa-draft") || "null");
    if (draft && !EVENT_DATES.includes(draft.eventDate))
      return {
        ...draft,
        eventDate: "",
        bookingId: undefined,
        key: crypto.randomUUID(),
      };
    return draft;
  } catch {
    return null;
  }
}
function saveDraft(draft) {
  sessionStorage.setItem("santa-draft", JSON.stringify(draft));
}
const leadSessionKey = "santa-lead-signals";
let readLandingReferrer = false;

function registrationLeadSignals() {
  const navigation = performance.getEntriesByType("navigation")[0];
  const referrer = !readLandingReferrer && navigation?.type !== "reload"
    ? document.referrer
    : "";
  readLandingReferrer = true;
  const host = location.hostname;
  const signals = readLandingSignals(location.search, referrer, host);
  const attribution = resolveLeadAttribution(signals, host);
  try {
    if (attribution && (attribution.method !== "unknown" || !sessionStorage.getItem(leadSessionKey))) {
      sessionStorage.setItem(leadSessionKey, JSON.stringify(signals));
      return signals;
    }
    return JSON.parse(sessionStorage.getItem(leadSessionKey));
  } catch {
    return attribution ? signals : null;
  }
}

function bookingPricing({ ticketSubtotal, platformFee, amount, method, status }) {
  return { ticketSubtotal, platformFee, amount, method, status };
}
export function BookingSidebar({ draft, pricing, children, showVenue = true }) {
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
            <span>{eventDate(draft.eventDate).replace(/, \d{4}$/, "")}</span>
            <CalendarDays size={17} />
          </p>
          <p>
            <span>{draft.adults} × Adult ticket</span>
            <b>{money(pricing.ticketSubtotal)}</b>
          </p>
          <p>
            <span>{draft.kids} × Kids ticket</span>
            <b>Free</b>
          </p>
          {pricing.platformFee > 0 && (
            <p>
              <span>Platform Fee ({PLATFORM_FEE_PERCENT}%)</span>
              <b>{money(pricing.platformFee)}</b>
            </p>
          )}
          <p className="summary-total">
            <span>Total</span>
            <strong>{money(pricing.amount)}</strong>
          </p>
        </div>
        {children}
      </div>
    </aside>
  );
}
export function Register() {
  const router = useRouter();
  const [draft, setDraft] = useState(initial);
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState("");
  const [attemptedField, setAttemptedField] = useState(null);
  const [verifiedMobile, setVerifiedMobile] = useState("");
  const [verificationRevision, setVerificationRevision] = useState(0);
  const [openingCheckout, setOpeningCheckout] = useState(false);
  const submitting = useRef(false);
  const leadSignals = useRef(null);
  const parsed = draftSchema.safeParse(draft);
  const issue = registrationIssue(draft, parsed, settings, verifiedMobile);
  const activeField = issue?.field === attemptedField ? attemptedField : null;
  function fieldError(field) {
    return activeField === field && (
      <p className="field-hint error-text" id={`registration-${field}-error`} role="alert">
        {issue.message}
      </p>
    );
  }
  function fieldStatus(field) {
    return activeField === field ? {
      "aria-invalid": true,
      "aria-describedby": `registration-${field}-error`,
    } : {};
  }
  useEffect(() => {
    if (attemptedField && !activeField) setAttemptedField(null);
  }, [attemptedField, activeField]);
  useEffect(() => {
    leadSignals.current = registrationLeadSignals();
    setDraft(readDraft() || { ...initial, key: crypto.randomUUID() });
    api("/events")
      .then((d) => {
        setSettings(d.event);
        setDraft((current) => {
          const saved = readDraft();
          const available = d.event.days.filter((day) => day.bookable);
          if (!saved)
            return { ...current, eventDate: available[0]?.date || "" };
          if (!available.some((day) => day.date === current.eventDate))
            return {
              ...current,
              eventDate: "",
              bookingId: undefined,
              key: crypto.randomUUID(),
            };
          return current;
        });
      })
      .catch((e) => setError(e.message));
  }, []);
  const update = (values) => {
    if (values.mobile !== undefined && values.mobile !== draft.mobile)
      setVerifiedMobile("");
    setDraft({ ...draft, ...values, bookingId: undefined });
  };
  async function next(e) {
    e.preventDefault();
    if (submitting.current) return;
    setError("");
    if (issue) {
      setAttemptedField(issue.field);
      focusRegistrationField(issue.field);
      return;
    }
    submitting.current = true;
    setOpeningCheckout(true);
    try {
      const identity = await api("/auth/me?scope=customer");
      if (identity.mobile !== draft.mobile) {
        throw Object.assign(new Error(verifyMobileMessage), { status: 401 });
      }
      saveDraft({
        ...draft,
        ...parsed.data,
        leadSignals: leadSignals.current || undefined,
        key: crypto.randomUUID(),
      });
      router.push("/checkout");
    } catch (error) {
      submitting.current = false;
      setOpeningCheckout(false);
      if (error.status === 401) {
        setVerifiedMobile("");
        setVerificationRevision((value) => value + 1);
        setAttemptedField("verification");
        requestAnimationFrame(() => focusRegistrationField("verification"));
      } else setError(error.message);
    }
  }
  return (
    <main className="booking-page">
      <h1 className="sr-only">Your booking</h1>
      <h2 className="welcome-heading">Your Pass to Coimbatore’s Largest Christmas Carnival</h2>
      <div className="booking-layout registration-layout">
        <form className="form-card" noValidate onSubmit={next}>
          <div className="form-section" data-registration-field>
            <div className="section-label">
              <span>01</span>
              <div>
                <h2 id="registration-date-heading">Pick your day</h2>
              </div>
            </div>
            <div className="event-details">
              <VenueLocation />
            </div>
            <div className="date-options" id="registration-date" role="group"
              aria-labelledby="registration-date-heading" tabIndex={-1} {...fieldStatus("eventDate")}>
              {EVENT_DATES.map((date) => (
                <button
                  type="button"
                  aria-pressed={draft.eventDate === date}
                  className={`date-option ${draft.eventDate === date ? "selected" : ""}`}
                  key={date}
                  disabled={
                    !settings?.days.some(
                      (day) => day.date === date && day.bookable,
                    )
                  }
                  onClick={() => update({ eventDate: date })}
                >
                  <span className="date-number">{Number(date.slice(-2))}</span>
                  <span>
                    <small>{eventDate(date).split(",")[0].toUpperCase()}</small>
                    <b>{eventMonthYear(date)}</b>
                    <em>{EVENT_HOURS_LABEL}</em>
                  </span>
                  <span className="radio-dot" />
                </button>
              ))}
            </div>
            {fieldError("eventDate")}
          </div>
          <div className="form-section">
            <div className="section-label">
              <span>02</span>
              <div>
                <h2>Registration Details</h2>
              </div>
            </div>
            <div data-registration-field>
              <label>
                Full name <span>*</span>
                <input
                  id="registration-name"
                  {...fieldStatus("name")}
                  autoComplete="name"
                  required
                  value={draft.name}
                  onChange={(e) => update({ name: e.target.value })}
                  placeholder="Your full name"
                  maxLength={120}
                />
              </label>
              {fieldError("name")}
            </div>
            <MobileVerification
              key={verificationRevision}
              mobile={draft.mobile}
              onChange={(mobile) => update({ mobile })}
              onVerified={setVerifiedMobile}
              disabled={openingCheckout}
              invalidField={["mobile", "verification"].includes(activeField) ? activeField : null}
              validationMessage={["mobile", "verification"].includes(activeField) ? issue.message : ""}
            />
          </div>
          <div className="form-section" data-registration-field>
            <div className="section-label">
              <span>03</span>
              <div>
                <h2 id="discovery-source-heading">
                  How did you hear about{" "}
                  <span className="required-label-end">
                    us?<span className="required-mark" aria-hidden="true">*</span>
                  </span>
                </h2>
              </div>
            </div>
            <div
              className="discovery-options"
              role="radiogroup"
              aria-labelledby="discovery-source-heading"
              aria-required="true"
              {...fieldStatus("discoverySource")}
            >
              {Object.entries(discoverySources).map(([value, label]) => (
                <label key={value}>
                  <input
                    type="radio"
                    name="discoverySource"
                    value={value}
                    checked={draft.discoverySource === value}
                    onChange={() => {
                      const updated = {
                        ...draft,
                        discoverySource: value,
                        bookingId: undefined,
                      };
                      setDraft(updated);
                      saveDraft(updated);
                    }}
                  />
                  {label}
                </label>
              ))}
            </div>
            {fieldError("discoverySource")}
          </div>
          <div className="form-section registration-tickets" data-registration-field
            id="registration-tickets" role="group" aria-labelledby="registration-tickets-heading" {...fieldStatus("tickets")}>
            <div className="section-label">
              <span>04</span>
              <div>
                <h2 id="registration-tickets-heading">Tickets</h2>
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
                    <b>{kind === "adults" ? money(ADULT_TICKET_PAISE) : "Free"}</b>
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
            {fieldError("tickets")}
          </div>
          {error && <Notice>{error}</Notice>}
          <button
            className={`button full${issue ? " registration-checkout-incomplete" : ""}`}
            type="submit"
            disabled={openingCheckout}
            aria-describedby={issue ? "registration-checkout-hint" : undefined}
          >
            {openingCheckout ? "Opening checkout…" : "Checkout"}{" "}
            <ArrowRight size={18} />
          </button>
          {issue && <p id="registration-checkout-hint" className="sr-only">
            Activate Checkout to find the first field that needs attention.
          </p>}
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
function EntryAgreement({ agreed, onChange }) {
  const dialog = useRef(null);
  return (
    <>
      <div className="checkbox-label checkout-entry-agreement">
        <input
          id="checkout-entry-conditions"
          type="checkbox"
          checked={agreed}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span>
          <label htmlFor="checkout-entry-conditions">
            I have checked my booking and agree to these entry conditions.
          </label>{" "}
          <button
            type="button"
            className="terms-link"
            onClick={() => {
              dialog.current.showModal();
              dialog.current.querySelector("h2").focus();
              dialog.current.querySelector(".terms-policy-body").scrollTop = 0;
            }}
          >
            Terms and Conditions.
          </button>
        </span>
      </div>
      <dialog
        ref={dialog}
        className="terms-dialog"
        aria-labelledby="checkout-terms-title"
        onClick={(event) => {
          if (event.target === dialog.current) dialog.current.close();
        }}
      >
        <h2 id="checkout-terms-title" tabIndex={-1}>
          Santa Social | Terms &amp; Conditions
        </h2>
        <div
          className="terms-policy-body"
          tabIndex={0}
          role="region"
          aria-label="Ticket cancellation and refund policies"
        >
          <TicketPolicies />
        </div>
        <button
          type="button"
          className="button full"
          onClick={() => dialog.current.close()}
        >
          Close
        </button>
      </dialog>
    </>
  );
}
function existingCashDestination({ id, status }) {
  if (status === "PENDING_CASH") return `/booking-pending?id=${id}`;
  if (status === "PAID") return `/ticket/${id}`;
  return "/retrieve-ticket";
}

export function Checkout() {
  const router = useRouter();
  const [draft, setDraft] = useState(null);
  const [cashEnabled, setCashEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [demoBooking, setDemoBooking] = useState(null);
  const [checkingPayment, setCheckingPayment] = useState(false);
  const [pendingPaymentId, setPendingPaymentId] = useState(null);
  const [agreed, setAgreed] = useState(false);
  const checkoutRef = useRef(null);
  const navigating = useRef(false);
  useEffect(() => {
    async function restore() {
      let allowCash;
      try {
        const event = await api("/events", { cache: "no-store" });
        allowCash = event.publicCashPaymentEnabled === true;
        setCashEnabled(allowCash);
      } catch {
        router.replace("/");
        return;
      }
      function redirectExistingCash(booking) {
        if (allowCash || booking.method !== "CASH") return false;
        router.replace(existingCashDestination(booking));
        return true;
      }
      const params = new URLSearchParams(location.search);
      const bookingId = params.get("id");
      if (params.get("payment") === "failed")
        setError(
          "Payment could not be confirmed. If your account was debited, check payment status before paying again.",
        );
      if (bookingId && params.has("payment")) setPendingPaymentId(bookingId);
      if (bookingId) {
        try {
          const b = await api(`/bookings/${bookingId}`);
          if (redirectExistingCash(b)) return;
          const d = {
            name: b.name,
            email: b.email,
            mobile: b.mobile,
            discoverySource: b.discoverySource,
            eventDate: b.eventDate,
            adults: b.adults,
            kids: b.kids,
            method: b.method === "CASH" ? "CASH" : "RAZORPAY",
            bookingId: b.id,
            pricing: bookingPricing(b),
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
      if (
        !d ||
        !EVENT_DATES.includes(d.eventDate) ||
        (!d.bookingId &&
          !discoverySourceSchema.safeParse(d.discoverySource).success)
      ) {
        router.replace("/");
        return;
      }
      api("/auth/me?scope=customer")
        .then(async (user) => {
          if (user.mobile !== d.mobile) {
            router.replace("/");
            return;
          }
          const b = d.bookingId ? await api(`/bookings/${d.bookingId}`) : null;
          if (b && redirectExistingCash(b)) return;
          let restored = b ? { ...d, pricing: bookingPricing(b) } : d;
          if (!allowCash && d.method !== "RAZORPAY") {
            restored = { ...restored, method: "RAZORPAY", key: crypto.randomUUID() };
            saveDraft(restored);
          }
          setDraft(restored);
        })
        .catch(() => router.replace("/"));
    }
    void restore();
  }, [router]);
  const hasDraft = Boolean(draft);
  useEffect(() => {
    if (!hasDraft || busy || checkingPayment || demoBooking) return;
    let stopped = false;
    let reading = false;
    async function refreshCashAvailability() {
      if (reading || document.hidden) return;
      reading = true;
      try {
        const event = await api("/events", { cache: "no-store" });
        if (!stopped) setCashEnabled(event.publicCashPaymentEnabled === true);
      } catch {
        // The booking API still verifies the setting if a refresh fails.
      } finally {
        reading = false;
      }
    }
    const timer = setInterval(refreshCashAvailability, 15000);
    window.addEventListener("focus", refreshCashAvailability);
    document.addEventListener("visibilitychange", refreshCashAvailability);
    return () => {
      stopped = true;
      clearInterval(timer);
      window.removeEventListener("focus", refreshCashAvailability);
      document.removeEventListener("visibilitychange", refreshCashAvailability);
    };
  }, [hasDraft, busy, checkingPayment, demoBooking]);
  useEffect(() => {
    if (
      cashEnabled || draft?.method !== "CASH" ||
      busy || checkingPayment || navigating.current
    ) return;
    if (draft.bookingId && draft.pricing?.method === "CASH") {
      router.replace(existingCashDestination({ id: draft.bookingId, status: draft.pricing.status }));
      return;
    }
    const updated = { ...draft, method: "RAZORPAY", key: crypto.randomUUID() };
    saveDraft(updated);
    setDraft(updated);
    setAgreed(false);
    setError("Cash at the counter is currently unavailable. Review the online total before continuing.");
  }, [cashEnabled, draft, busy, checkingPayment, router]);
  useEffect(() => {
    if (!draft?.bookingId || draft.method !== "RAZORPAY") return;
    let stopped = false;
    let inFlight = false;
    let until = Date.now() + 600000;
    async function recover() {
      // Some phones keep browser timers running while a UPI app is open.
      // Recover then too; suspended browsers retry immediately on resume.
      if (stopped || inFlight || navigating.current || Date.now() > until) return;
      inFlight = true;
      try {
        const b = await post("/payments/razorpay/status", {
          bookingId: draft.bookingId,
        });
        if (!stopped && ["PAID", "FREE"].includes(b.status)) success(b);
      } catch {
        // Keep checkout retryable during a temporary connection loss.
      } finally {
        inFlight = false;
      }
    }
    const resume = () => {
      until = Date.now() + 600000;
      void recover();
    };
    void recover();
    const timer = setInterval(recover, 4000);
    window.addEventListener("focus", resume);
    window.addEventListener("pageshow", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      stopped = true;
      clearInterval(timer);
      window.removeEventListener("focus", resume);
      window.removeEventListener("pageshow", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [draft?.bookingId, draft?.method]);
  function success(b) {
    if (navigating.current) return;
    navigating.current = true;
    checkoutRef.current?.close?.();
    setBusy(false);
    setCheckingPayment(false);
    setDemoBooking(null);
    sessionStorage.setItem("santa-last-booking", b.id);
    sessionStorage.removeItem(leadSessionKey);
    router.push(
      b.status === "PENDING_CASH"
        ? `/booking-pending?id=${b.id}`
        : `/ticket/${b.id}`,
    );
  }
  async function confirmOnlinePayment(id, verified) {
    setCheckingPayment(true);
    setPendingPaymentId(id);
    let booking = verified;
    try {
      // A provider callback or HTTP 202 is not proof of captured payment.
      // Only a server-confirmed paid/free booking can open the admission QR.
      for (let attempt = 0; attempt < 8; attempt++) {
        if (attempt) await new Promise((resolve) => setTimeout(resolve, 1200));
        if (!booking || attempt)
          booking = await post("/payments/razorpay/status", { bookingId: id });
        if (booking?.status === "PAID" || booking?.status === "FREE") {
          setPendingPaymentId(null);
          success(booking);
          return;
        }
        if (
          booking?.status === "PAYMENT_REVIEW" ||
          booking?.status === "CANCELLED"
        )
          throw Error(
            "Payment could not be approved. Please contact the organiser with your booking reference.",
          );
      }
      setError(
        "Payment is not confirmed yet. If your account was debited, check payment status before paying again. Your ticket will appear after confirmation.",
      );
    } finally {
      setCheckingPayment(false);
    }
  }
  function demoUnsuccessful(cancelled = false) {
    setDemoBooking(null);
    setBusy(false);
    setError(
      cancelled
        ? "Payment cancelled. No successful payment was confirmed. Please try again."
        : "Payment unsuccessful. No successful payment was confirmed. Please try again.",
    );
  }
  async function start() {
    if (!draft || busy) return;
    setBusy(true);
    setError("");
    setPendingPaymentId(null);
    try {
      const { key, mobile, bookingId, pricing: _savedPricing, ...input } = draft;
      let b = bookingId
        ? await api(`/bookings/${bookingId}`)
        : await post("/bookings", input, { "Idempotency-Key": key });
      if (
        bookingId &&
        b.method !== draft.method &&
        !["PAID", "FREE"].includes(b.status)
      ) {
        b = await post(
          `/bookings/${bookingId}/payment-method`,
          { method: draft.method },
          { "Idempotency-Key": key },
        );
        if (new URLSearchParams(location.search).has("id"))
          router.replace(`/checkout?id=${b.id}`);
      }
      const updated = { ...draft, bookingId: b.id, pricing: bookingPricing(b) };
      saveDraft(updated);
      setDraft(updated);
      if (
        b.amount !== pricing.amount &&
        ["PENDING_CASH", "PENDING_PAYMENT"].includes(b.status)
      ) {
        setAgreed(false);
        throw Error("The booking total has changed. Review the amount before continuing.");
      }
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
      let paymentSubmitted = false;
      const checkout = new window.Razorpay({
        key: order.keyId,
        order_id: order.orderId,
        amount: order.amount,
        currency: "INR",
        name: "Santa Social 9th Edition",
        description: `Group booking · ${b.reference}`,
        prefill: {
          name: b.name,
          ...(b.email ? { email: b.email } : {}),
          contact: `+91${b.mobile}`,
        },
        theme: { color: "#8a1d23" },
        // Standard browser checkout uses the success handler on phones too.
        // callback_url/redirect bypass it; retain the signed backend return
        // endpoint for legacy redirects, not this JavaScript checkout flow.
        modal: {
          ondismiss: () => {
            if (paymentSubmitted || navigating.current) return;
            setBusy(false);
            setError(
              "Payment cancelled. No successful payment was confirmed. Your booking is saved; please try again.",
            );
          },
        },
        handler: async (result) => {
          paymentSubmitted = true;
          try {
            const verified = await post("/payments/razorpay/verify", {
              bookingId: b.id,
              ...result,
            });
            await confirmOnlinePayment(b.id, verified);
          } catch (e) {
            setPendingPaymentId(b.id);
            setError(
              `Payment confirmation could not be completed. ${e.message} If your account was debited, check payment status before paying again.`,
            );
          } finally {
            setBusy(false);
          }
        },
      });
      checkout.on("payment.failed", () => {
        setError(
          "Payment unsuccessful. No successful payment was confirmed. Your booking is saved; please try again.",
        );
        setBusy(false);
      });
      checkoutRef.current = checkout;
      checkout.open();
    } catch (e) {
      if (e.details?.code === "PUBLIC_CASH_UNAVAILABLE") setCashEnabled(false);
      setError(e.message);
      setBusy(false);
    }
  }
  async function demoComplete() {
    if (!demoBooking) return;
    setBusy(true);
    try {
      await confirmOnlinePayment(
        demoBooking.id,
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
  const savedPricing = draft.bookingId ? draft.pricing : null;
  let pricing = savedPricing || quoteBooking(draft.adults, draft.method);
  if (
    savedPricing &&
    ["PENDING_CASH", "PENDING_PAYMENT"].includes(savedPricing.status) &&
    savedPricing.method !== draft.method
  ) {
    pricing = quoteSubtotal(savedPricing.ticketSubtotal, draft.method);
  }
  return (
    <main className="booking-page">
      <h1 className="sr-only">Checkout</h1>
      <div className="booking-layout checkout-layout">
        <div className="form-card">
          <div className="section-label">
            <span>
              <Check size={16} />
            </span>
            <div className="checkout-verified-details">
              <div className="checkout-verified-title">
                <h2>You’re verified, {draft.name.split(" ")[0]}.</h2>
                <Link className="back-link" href="/">
                  <ArrowLeft size={16} /> Edit
                </Link>
              </div>
              <p>
                +91 {draft.mobile}
                {draft.email ? ` · ${draft.email}` : ""}
              </p>
            </div>
          </div>
          <BookingSidebar draft={draft} pricing={pricing} showVenue={false} />
          <div className="form-section">
            <h2>How would you like to pay?</h2>
            {(cashEnabled ? ["RAZORPAY", "CASH"] : ["RAZORPAY"]).map((method) => (
              <button
                type="button"
                disabled={busy || checkingPayment || !!demoBooking}
                key={method}
                aria-pressed={draft.method === method}
                className={`payment-option ${draft.method === method ? "selected" : ""}`}
                onClick={() => {
                  if (method === draft.method) return;
                  const d = { ...draft, method, key: crypto.randomUUID() };
                  saveDraft(d);
                  setDraft(d);
                  setError("");
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
                      : pricing.amount
                        ? `Get your QR now. Pay ${money(pricing.amount)} at the counter and get approval`
                        : "Get your QR now. No payment is due"}
                  </small>
                </span>
                <span className="radio-dot" />
              </button>
            ))}
          </div>
          <EntryAgreement agreed={agreed} onChange={setAgreed} />
          {error && <Notice>{error}</Notice>}
          {pendingPaymentId && (
            <button
              className="button outline full"
              disabled={busy || checkingPayment}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await confirmOnlinePayment(pendingPaymentId);
                } catch (e) {
                  setError(e.message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {checkingPayment
                ? "Checking payment status…"
                : "Check payment status"}
            </button>
          )}
          <button
            className="button full"
            disabled={!agreed || busy || checkingPayment || (!cashEnabled && draft.method === "CASH")}
            onClick={start}
          >
            {busy
              ? checkingPayment
                ? "Verifying payment…"
                : "Preparing your booking…"
              : pricing.amount === 0
                ? "Confirm free booking"
                : draft.method === "CASH"
                  ? "Reserve & pay at counter"
                  : `Continue to payment · ${money(pricing.amount)}`}
            <ArrowRight size={18} />
          </button>
          <p className="secure-note">
            <ShieldCheck size={15} /> Payments are verified securely on our
            server.
          </p>
          <div className="entry-rules">
            <h3>Before the Fun Kicks Off!</h3>
            <ul>
              <li>
                Tickets are valid for the respective booked date(s) of Santa
                Social, scheduled for 5th &amp; 6th December 2026.
              </li>
              <li>All attendees under a group booking must enter together.</li>
              <li>
                Children under five must be accompanied by an adult, unless
                otherwise permitted under an approved event policy.
              </li>
              <li>
                By completing your purchase, you acknowledge and accept these
                terms and conditions.
              </li>
              <li>
                For group bookings, all tickets must be collected in a single
                QR scan and shared with attendees arriving separately.
              </li>
            </ul>
            <p>
              For booking assistance or payment-related queries, please contact
              the Rush Republic management team through the official
              communication channels listed on our website.
            </p>
          </div>
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
              className="button outline full"
              disabled={busy}
              onClick={() => demoUnsuccessful()}
            >
              Simulate unsuccessful payment
            </button>
            <button
              className="text-button"
              disabled={busy}
              onClick={() => demoUnsuccessful(true)}
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
  if (booking?.qrToken && (active || booking.method === "CASH"))
    return <GroupTicket id={booking.id} />;
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
                    ? "Show your booking QR at the counter to pay and get approval."
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
                  {money(booking.amount)} at the counter. Show a ticket QR.
                  Entry requires payment approval.
                </div>
              )}
              {booking.status === "PAYMENT_REVIEW" && (
                <Notice>
                  Your payment was captured after your reservation became
                  unavailable. Contact the organiser with this reference for
                  payment review or a refund. No entry ticket has been
                  activated.
                </Notice>
              )}
              {active ? (
                <Link href={`/ticket/${booking.id}`} className="button full">
                  View your tickets <ArrowRight size={18} />
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
