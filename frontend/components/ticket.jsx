"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import QRCode from "qrcode";
import {
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
  const [qr, setQr] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  useEffect(() => {
    const token = location.hash.slice(1);
    api(`/tickets/${id}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(async (b) => {
        setBooking(b);
        if (b.qrToken)
          setQr(
            await QRCode.toDataURL(b.qrToken, {
              width: 600,
              margin: 2,
              errorCorrectionLevel: "M",
              color: { dark: "#153622", light: "#ffffff" },
            }),
          );
      })
      .catch((e) => setError(e.message));
  }, [id]);
  async function ticketFile(format) {
    const response = await fetch(
      `/api/tickets/${booking.id}/download?format=${format}`,
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
      `${booking.reference}${format === "png" ? "-ticket.png" : ".pdf"}`,
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
          title: "Santa Social group ticket",
          files: [file],
        });
      else if (navigator.share)
        await navigator.share({
          title: "Santa Social group ticket",
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
      <article className="digital-ticket">
        <div className="ticket-top">
          <Wordmark />
        </div>
        {booking.demo && (
          <div className="ticket-demo">DEMO ONLY · NOT VALID FOR ADMISSION</div>
        )}
        <div className="ticket-body">
          <p className="eyebrow">{booking.reference}</p>
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
          <div
            className={`ticket-status ${booking.status === "PENDING_CASH" ? "ticket-cash-due" : ""}`}
          >
            <CheckCircle size={15} />
            {booking.status === "PENDING_CASH"
              ? `CASH DUE · ${money(booking.amount)} · APPROVAL REQUIRED`
              : booking.checkedInAt
                ? "CHECKED IN · NO RE-ENTRY"
                : `CONFIRMED · ${money(booking.amount)} PAID`}
          </div>
        </div>
        <div className="ticket-perforation" />
        <div className="ticket-qr">
          {qr ? (
            <img
              src={qr}
              alt="One secure QR code for this entire group booking"
              width={210}
              height={210}
            />
          ) : (
            <Loading />
          )}
          <small>
            Everyone must arrive together.
            <br />
            {booking.status === "PENDING_CASH"
              ? "Pay cash at the counter. Approval required before entry."
              : "Valid only for the selected date. No re-entry."}
          </small>
        </div>
      </article>
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
