"use client";
import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import QRCode from "qrcode";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Share2,
  ImageDown,
  CalendarDays,
  MapPin,
  CheckCircle,
} from "lucide-react";
import { api, eventDate, money } from "@/lib/api";
import { Wordmark, Notice, Loading } from "./common";
export function GroupTicket({ id }) {
  const [booking, setBooking] = useState(null);
  const [qrs, setQrs] = useState({});
  const [selected, setSelected] = useState(0);
  const carousel = useRef(null);
  const order = useRef(null);
  const tickets = booking?.tickets?.length
    ? booking.tickets
    : booking
      ? [{ id: booking.id, qrToken: booking.qrToken }]
      : [];
  const qr = qrs[tickets[selected]?.id];
  function navigate(index) {
    if (!carousel.current) return;
    carousel.current.scrollTo({
      left: carousel.current.clientWidth * index,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  }
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  useEffect(() => {
    let active = true;
    order.current = null;
    setSelected(0);
    const token = location.hash.slice(1);
    async function refresh() {
      try {
        const b = await api(`/tickets/${id}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!active) return;
        if (b.tickets?.length) {
          if (!order.current)
            order.current = [...b.tickets]
              .sort(
                (a, b) =>
                  Number(a.status === "APPROVED") -
                    Number(b.status === "APPROVED") || a.ordinal - b.ordinal,
              )
              .map((t) => t.id);
          b.tickets.sort(
            (a, b) => order.current.indexOf(a.id) - order.current.indexOf(b.id),
          );
        }
        const images = await Promise.all(
          (b.tickets?.length
            ? b.tickets
            : [{ id: b.id, qrToken: b.qrToken }]
          ).map(async (t) => [
            t.id,
            await QRCode.toDataURL(t.qrToken, {
              width: 600,
              margin: 4,
              errorCorrectionLevel: "M",
              color: { dark: "#153622", light: "#ffffff" },
            }),
          ]),
        );
        if (active) {
          setBooking(b);
          setQrs(Object.fromEntries(images));
          setError("");
        }
      } catch (e) {
        if (active) setError(e.message);
      }
    }
    void refresh();
    const timer = setInterval(refresh, 15000);
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [id]);
  async function ticketFile(format) {
    const response = await fetch(
      `/api/tickets/${booking.id}/download?format=${format}${booking.tickets?.length ? `&ticketId=${encodeURIComponent(tickets[selected].id)}` : ""}`,
      {
        credentials: "include",
        cache: "no-store",
        headers: { Authorization: `Bearer ${booking.qrToken}` },
      },
    );
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(
        body.error || "Unable to prepare your ticket. Please try again.",
      );
    }
    return new File(
      [await response.blob()],
      `${tickets[selected]?.number || booking.reference}${format === "png" ? "-ticket.png" : ".pdf"}`,
      { type: format === "png" ? "image/png" : "application/pdf" },
    );
  }
  function saveFile(file) {
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  async function download(format) {
    if (!booking || !qr || busy) return;
    setBusy(format);
    setError("");
    try {
      saveFile(await ticketFile(format));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  }
  async function share() {
    if (!booking || !qr || busy) return;
    setBusy("share");
    setError("");
    const url = `${location.origin}/ticket/${booking.id}#${booking.qrToken}`;
    try {
      const file = await ticketFile("png");
      if (navigator.share && navigator.canShare?.({ files: [file] }))
        await navigator.share({
          title: "Santa Social ticket",
          files: [file],
        });
      else if (navigator.share)
        await navigator.share({
          title: "Santa Social ticket",
          text: `Santa Social · ${eventDate(booking.eventDate)} · ${booking.people} guests`,
          url,
        });
      else {
        await navigator.clipboard.writeText(url);
        setMessage("Secure ticket link copied. Share it only with your group.");
      }
    } catch (e) {
      if (e.name !== "AbortError")
        setError("Sharing was unavailable. Download your ticket to save it.");
    } finally {
      setBusy("");
    }
  }
  if (error && !booking)
    return (
      <main className="booking-page">
        <div className="narrow-card">
          <Notice>{error}</Notice>
          <Link className="button" href="/retrieve-ticket">
            Verify mobile & retrieve ticket
          </Link>
        </div>
      </main>
    );
  if (!booking) return <Loading />;
  return (
    <main className="ticket-page">
      <h1 className="sr-only">Your Santa Social ticket</h1>
      {booking.entryMode === "INDIVIDUAL" && (
        <p role="status">
          {booking.entryStatus === "FULLY_ENTERED"
            ? "Fully entered"
            : `${booking.pendingTicketCount} tickets remaining`}
        </p>
      )}
      <nav className="ticket-navigation" aria-label="Ticket navigation">
        <button
          className="button outline"
          aria-label="Previous ticket"
          disabled={selected === 0}
          onClick={() => navigate(selected - 1)}
        >
          <ChevronLeft />
        </button>
        <span aria-live="polite">
          Ticket {selected + 1} of {tickets.length}
        </span>
        <button
          className="button outline"
          aria-label="Next ticket"
          disabled={selected === tickets.length - 1}
          onClick={() => navigate(selected + 1)}
        >
          <ChevronRight />
        </button>
      </nav>
      <div
        className="ticket-carousel"
        ref={carousel}
        tabIndex={0}
        role="region"
        aria-label="Your tickets. Swipe or use arrow keys."
        onKeyDown={(e) => {
          if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
            e.preventDefault();
            navigate(
              Math.max(
                0,
                Math.min(
                  tickets.length - 1,
                  selected + (e.key === "ArrowRight" ? 1 : -1),
                ),
              ),
            );
          }
        }}
        onScroll={(e) =>
          setSelected(
            Math.round(
              e.currentTarget.scrollLeft / e.currentTarget.clientWidth,
            ),
          )
        }
      >
        {tickets.map((ticket) => (
          <div className="ticket-slide" key={ticket.id}>
            <article className="digital-ticket">
              <div className="ticket-top">
                <Wordmark />
              </div>
              {booking.demo && (
                <div className="ticket-demo">
                  DEMO ONLY · NOT VALID FOR ADMISSION
                </div>
              )}
              <div className="ticket-body">
                <p className="eyebrow">{ticket.number || booking.reference}</p>
                {ticket.category && (
                  <>
                    <h3>
                      {ticket.category === "ADULT" ? "Adult" : "Kids"} Ticket
                    </h3>
                    <p className="ticket-entry-status">
                      Status:{" "}
                      {ticket.status === "APPROVED"
                        ? "Approved / Already Used"
                        : "Not Scanned"}
                    </p>
                  </>
                )}
                <h2>{booking.name}</h2>
                <p className="ticket-event-date">
                  <CalendarDays size={18} />
                  {eventDate(booking.eventDate)}
                </p>
                <p>11:00 AM – 9:00 PM</p>
                <p>
                  <MapPin size={18} />
                  Park Grounds – CODISSIA, Coimbatore
                </p>
                {!ticket.category && (
                  <div className="ticket-counts">
                    <div>
                      <strong>{booking.adults}</strong>
                      <small>ADULTS</small>
                    </div>
                    <div>
                      <strong>{booking.kids}</strong>
                      <small>KIDS UNDER 5</small>
                    </div>
                    <div>
                      <strong>{booking.people}</strong>
                      <small>TOTAL GUESTS</small>
                    </div>
                  </div>
                )}
                <div
                  className={`ticket-status ${booking.status === "PENDING_CASH" ? "ticket-cash-due" : ""}`}
                >
                  <CheckCircle size={15} />
                  {booking.status === "PENDING_CASH"
                    ? `CASH DUE · ${money(booking.amount)} · APPROVAL REQUIRED`
                    : (
                          ticket.category
                            ? ticket.status === "APPROVED"
                            : booking.checkedInAt
                        )
                      ? "CHECKED IN · NO RE-ENTRY"
                      : `CONFIRMED · ${money(booking.amount)} PAID`}
                </div>
              </div>
              <div className="ticket-perforation" />
              <div className="ticket-qr">
                {qrs[ticket.id] ? (
                  <img
                    src={qrs[ticket.id]}
                    alt={
                      ticket.category
                        ? `Unique QR for ${ticket.number}`
                        : "Secure group booking QR"
                    }
                    width={210}
                    height={210}
                  />
                ) : (
                  <Loading />
                )}
                <small>
                  {ticket.category
                    ? "One ticket admits one person."
                    : "Everyone must arrive together."}
                  <br />
                  {booking.status === "PENDING_CASH"
                    ? "Pay cash at the counter. Approval required before entry."
                    : "Valid only for the selected date. No re-entry."}
                </small>
              </div>
            </article>
          </div>
        ))}
      </div>
      <div className="ticket-actions">
        <button
          className="button"
          onClick={() => download("pdf")}
          disabled={!qr || !!busy}
        >
          <Download size={17} />
          Download PDF
        </button>
        <button
          className="button outline"
          onClick={() => download("png")}
          disabled={!qr || !!busy}
        >
          <ImageDown size={17} />
          Save QR image
        </button>
        <button
          className="button outline"
          onClick={share}
          disabled={!qr || !!busy}
        >
          <Share2 size={17} />
          Share ticket
        </button>
      </div>
      {booking.status === "PENDING_CASH" && (
        <button
          className="text-button"
          onClick={() => window.location.reload()}
        >
          Refresh payment status
        </button>
      )}
      {message && <Notice success>{message}</Notice>}
      {error && <Notice>{error}</Notice>}
    </main>
  );
}
