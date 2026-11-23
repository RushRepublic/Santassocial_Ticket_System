"use client";
import { EVENT_DATE_LABEL, EVENT_HOURS_LABEL } from "../../config/event-dates.js";
import Link from "next/link";
import { useEffect, useState } from "react";
import { MapPin, CalendarDays, Clock } from "lucide-react";
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
  return (
    <header className={`site-header ${overlay ? "overlay" : ""}`}>
      <Link href="/" aria-label="Santa Social booking form">
        <Wordmark />
      </Link>
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
        <span>{EVENT_DATE_LABEL}</span>
      </p>
      <p>
        <Clock />
        <span>{EVENT_HOURS_LABEL}</span>
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
      {value === "FREE" ? "Free Ticket" : value.replaceAll("_", " ")}
    </span>
  );
}
