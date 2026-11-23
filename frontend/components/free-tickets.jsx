"use client";
import { EVENT_HOURS_LABEL } from "../../config/event-dates.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Minus, Plus, Ticket, Users } from "lucide-react";
import { api, eventDate, eventMonthYear, money, post } from "@/lib/api";
import { Loading, Notice, VenueLocation } from "./common";

const endpoint = "/admin/free-tickets";
const categories = [
  ["adults", "Adults", "Ages 5 years and above", Ticket],
  ["kids", "Little ones", "Children below 5 years", Users],
];

export function FreeTickets() {
  const router = useRouter();
  const [settings, setSettings] = useState(null);
  const [form, setForm] = useState({
    name: "",
    mobile: "",
    eventDate: "",
    adults: 1,
    kids: 0,
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const lastRequest = useRef(null);
  const load = useCallback(() => {
    setError("");
    api(endpoint)
      .then((data) => {
        setSettings(data);
        setForm((current) => ({
          ...current,
          eventDate: data.days.find((day) => day.bookable)?.date || "",
        }));
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const guests = form.adults + form.kids;
  const name = form.name.trim();
  const dateAvailable = settings?.days.some(
    ({ date, bookable }) => date === form.eventDate && bookable,
  );
  const valid =
    dateAvailable &&
    name.length >= 2 &&
    /^[6-9]\d{9}$/.test(form.mobile) &&
    guests > 0 &&
    guests <= settings.maxGroup &&
    (form.adults > 0 || Boolean(settings.allowKidsOnly));

  function update(change) {
    setForm((current) => ({ ...current, ...change }));
    setError("");
  }

  async function generate(event) {
    event.preventDefault();
    if (!valid || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    const input = { ...form, name };
    const fingerprint = JSON.stringify(input);
    if (lastRequest.current?.fingerprint !== fingerprint) {
      lastRequest.current = { fingerprint, key: crypto.randomUUID() };
    }
    try {
      const { id, qrToken } = await post(endpoint, input, {
        "Idempotency-Key": lastRequest.current.key,
      });
      router.push(`/ticket/${id}#${qrToken}`);
    } catch (e) {
      setError(e.message);
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="free-tickets">
      <div className="admin-page-heading">
        <h1>Free Tickets</h1>
      </div>
      {!settings ? (
        error ? (
          <>
            <Notice>{error}</Notice>
            <button className="button" type="button" onClick={load}>
              Retry
            </button>
          </>
        ) : (
          <Loading />
        )
      ) : (
        <form className="form-card" onSubmit={generate} aria-busy={busy}>
          <section className="form-section" aria-labelledby="free-ticket-day">
            <div className="section-label">
              <span>01</span>
              <h2 id="free-ticket-day">Pick a day</h2>
            </div>
            <div className="event-details">
              <VenueLocation />
            </div>
            <div className="date-options">
              {settings.days.map(({ date, bookable }) => (
                <button
                  key={date}
                  type="button"
                  aria-pressed={form.eventDate === date}
                  className={`date-option ${form.eventDate === date ? "selected" : ""}`}
                  disabled={!bookable || busy}
                  onClick={() => update({ eventDate: date })}
                >
                  <span className="date-number">{Number(date.slice(-2))}</span>
                  <span>
                    <small>{eventDate(date).split(",")[0].toUpperCase()}</small>
                    <b>
                      {eventMonthYear(date)}
                    </b>
                    <em>{EVENT_HOURS_LABEL}</em>
                  </span>
                  <span className="radio-dot" />
                </button>
              ))}
            </div>
            {!settings.days.some((day) => day.bookable) && (
              <p className="field-hint">
                There are no dates available for booking.
              </p>
            )}
          </section>
          <section
            className="form-section"
            aria-labelledby="free-ticket-details"
          >
            <div className="section-label">
              <span>02</span>
              <h2 id="free-ticket-details">Registration Details</h2>
            </div>
            <label htmlFor="free-ticket-name">
              Full Name <span>*</span>
            </label>
            <input
              id="free-ticket-name"
              autoComplete="name"
              required
              maxLength={120}
              minLength={2}
              disabled={busy}
              value={form.name}
              onChange={(e) => update({ name: e.target.value })}
            />
            <label htmlFor="free-ticket-mobile">
              Mobile Number <span>*</span>
            </label>
            <div className="phone-input">
              <span aria-hidden="true">+91</span>
              <input
                id="free-ticket-mobile"
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                required
                maxLength={10}
                pattern="[6-9][0-9]{9}"
                disabled={busy}
                value={form.mobile}
                onChange={(e) =>
                  update({ mobile: e.target.value.replace(/\D/g, "") })
                }
              />
            </div>
            {form.mobile.length === 10 && !/^[6-9]\d{9}$/.test(form.mobile) && (
              <p className="field-hint">
                Enter a valid 10-digit Indian mobile number.
              </p>
            )}
          </section>
          <section
            className="form-section"
            aria-labelledby="free-ticket-quantities"
          >
            <div className="section-label">
              <span>03</span>
              <h2 id="free-ticket-quantities">Tickets</h2>
            </div>
            {categories.map(([kind, title, description, Icon]) => (
              <div className="quantity-row" key={kind}>
                <div className="quantity-icon">
                  <Icon aria-hidden="true" />
                </div>
                <div>
                  <h3>
                    {title} <b>{money(0)}</b>
                  </h3>
                  <p>{description}</p>
                </div>
                <div className="quantity-control">
                  <button
                    type="button"
                    aria-label={`Remove ${kind}`}
                    disabled={busy || form[kind] === 0}
                    onClick={() => update({ [kind]: form[kind] - 1 })}
                  >
                    <Minus size={15} />
                  </button>
                  <output aria-label={`${kind} quantity`}>{form[kind]}</output>
                  <button
                    type="button"
                    aria-label={`Add ${kind}`}
                    disabled={busy || guests >= settings.maxGroup}
                    onClick={() => update({ [kind]: form[kind] + 1 })}
                  >
                    <Plus size={15} />
                  </button>
                </div>
              </div>
            ))}
            {guests === 0 ? (
              <p className="field-hint">Select at least one guest.</p>
            ) : form.adults === 0 && !settings.allowKidsOnly ? (
              <p className="field-hint">
                A supervising adult is required for children under five.
              </p>
            ) : null}
          </section>
          {error && <Notice>{error}</Notice>}
          <div className="free-ticket-action">
            <button className="button" type="submit" disabled={!valid || busy}>
              {busy ? "Generating Ticket..." : "Generate Ticket"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
