"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import QRCode from "qrcode";
import {
  Download,
  Share2,
  ImageDown,
  Users,
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
  async function pdf() {
    if (!booking || !qr) return;
    try {
      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF({ format: "a5", unit: "mm" });
      doc.setFillColor("#FFFAF0");
      doc.rect(0, 0, 148, 210, "F");
      const logoResponse = await fetch("/brand/santa-social-9th-edition.png");
      if (!logoResponse.ok) throw new Error("Brand logo could not be loaded.");
      const logo = new Uint8Array(await logoResponse.arrayBuffer());
      doc.addImage(logo, "PNG", 56.5, 5, 35, (35 * 1184) / 1328);
      doc.setTextColor("#8A1D23");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text("GROUP TICKET", 74, 39, { align: "center" });
      doc.setTextColor("#153622");
      doc.setFontSize(12);
      const lines = [
        booking.reference,
        booking.name,
        eventDate(booking.eventDate),
        "11:00 AM - 9:00 PM IST",
        "Park Grounds - CODISSIA, Coimbatore",
        `${booking.adults} adults + ${booking.kids} kids | ${booking.people} guests`,
        `${booking.status === "PENDING_CASH" ? "CASH DUE" : "Paid"}: INR ${booking.amount / 100}`,
      ];
      lines.forEach((s, i) => doc.text(s, 74, 49 + i * 7, { align: "center" }));
      doc.addImage(qr, "PNG", 44, 98, 60, 60);
      doc.setFontSize(10);
      doc.text("One QR. Your whole group. Please arrive together.", 74, 172, {
        align: "center",
      });
      doc.text(
        booking.status === "PENDING_CASH"
          ? "Pay cash at the counter. Approval required before entry."
          : "Single entry only. No partial entry or re-entry.",
        74,
        180,
        {
          align: "center",
        },
      );
      if (booking.demo) {
        doc.setTextColor("#8A1D23");
        doc.text("DEMO ONLY - NOT VALID FOR ADMISSION", 74, 193, {
          align: "center",
        });
      }
      doc.save(`${booking.reference}.pdf`);
    } catch {
      setError("Unable to generate your PDF. Please try again.");
    }
  }
  async function share() {
    if (!booking) return;
    const url = `${location.origin}/ticket/${booking.id}#${booking.qrToken}`;
    try {
      if (navigator.share)
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
      <div className="page-intro">
        <p className="eyebrow">YOUR PASS TO THE CHRISTMAS CHEER</p>
        <h1>One ticket. All your people.</h1>
        <p>Download it now. Make memories later.</p>
      </div>
      <article className="digital-ticket">
        <div className="ticket-top">
          <Wordmark />
          <span>
            {booking.status === "PENDING_CASH" ? "CASH" : "GROUP"}
            <br />
            {booking.status === "PENDING_CASH" ? "PENDING" : "ADMISSION"}
          </span>
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
          <p>11:00 AM – 9:00 PM · Asia/Kolkata</p>
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
          <div className="ticket-status">
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
          <p>
            <Users size={17} /> One QR = One group
          </p>
          <small>
            Everyone must arrive together.
            <br />
            Valid only for the selected date. No re-entry.
          </small>
        </div>
      </article>
      <div className="ticket-actions">
        <button className="button" onClick={pdf} disabled={!qr}>
          <Download size={17} />
          Download PDF
        </button>
        <a
          className="button outline"
          href={qr}
          download={`${booking.reference}-qr.png`}
        >
          <ImageDown size={17} />
          Save QR image
        </a>
        <button className="button outline" onClick={share}>
          <Share2 size={17} />
          Share ticket
        </button>
      </div>
      {message && <Notice success>{message}</Notice>}
      {error && <Notice>{error}</Notice>}
      <Link className="back-link" href="/retrieve-ticket">
        View all my bookings
      </Link>
    </main>
  );
}
