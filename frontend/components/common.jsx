"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  MapPin,
  CalendarDays,
  Clock,
  Ticket,
  Menu,
  X,
} from "lucide-react";
import { api } from "@/lib/api";
export const directions =
  "https://www.google.com/maps/search/?api=1&query=Park+Grounds+CODISSIA+Coimbatore";
export function Wordmark({ large = false }) {
  return (
    <span className={`wordmark ${large ? "wordmark-large" : ""}`}>
      <img
        src="/brand/santa-social-9th-edition.png"
        alt="Santa’s Social — 9th Edition"
        width={1328}
        height={1184}
      />
    </span>
  );
}
export function Header({ overlay = false }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  const isBookingPage = path === "/" || path === "/register";
  return (
    <header className={`site-header ${overlay ? "overlay" : ""}`}>
      <Link href="/" aria-label="Santa Social booking form">
        <Wordmark />
      </Link>
      {path !== "/checkout" && (
        <>
          <button
            className="menu-button"
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen(!open)}
          >
            {open ? <X /> : <Menu />}
          </button>
          <nav className={open ? "open" : ""}>
            {path !== "/retrieve-ticket" && (
              <Link onClick={() => setOpen(false)} href="/retrieve-ticket">
                Find my ticket
              </Link>
            )}
            {!isBookingPage && (
              <Link
                className="button light"
                onClick={() => setOpen(false)}
                href="/"
              >
                <Ticket size={17} /> Book tickets <ArrowUpRight size={17} />
              </Link>
            )}
          </nav>
        </>
      )}
    </header>
  );
}
export function DemoBanner() {
  const [demo, setDemo] = useState(false);
  useEffect(() => {
    api("/events")
      .then((d) => setDemo(d.demo))
      .catch(() => {});
  }, []);
  return demo ? (
    <div className="demo-banner">
      DEMO MODE · OTP and online payments are simulated. No real charge or
      admission.
    </div>
  ) : null;
}
export function VenueLocation() {
  return (
    <p>
      <MapPin />
      <span>
        Park Grounds – CODISSIA
        <br />
        <small>Coimbatore, Tamil Nadu</small>
      </span>
    </p>
  );
}
export function EventDetails({ showVenue = true }) {
  return (
    <div className="event-details">
      <p>
        <CalendarDays />
        <span>5 & 6 December 2026</span>
      </p>
      <p>
        <Clock />
        <span>11:00 AM – 9:00 PM</span>
      </p>
      {showVenue && <VenueLocation />}
    </div>
  );
}
export function Notice({ children, success = false }) {
  return (
    <div
      className={`notice ${success ? "success" : "error"}`}
      role={success ? "status" : "alert"}
    >
      {children}
    </div>
  );
}
export function Loading() {
  return (
    <div className="loading" role="status">
      <span className="spinner" /> Getting things ready…
    </div>
  );
}
export function Status({ value }) {
  return (
    <span className={`status status-${value.toLowerCase()}`}>
      {value.replaceAll("_", " ")}
    </span>
  );
}
