"use client";
import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Camera,
  ScanLine,
  Check,
  LogOut,
  History,
  ArrowLeft,
  LayoutDashboard,
} from "lucide-react";
import { api, post, eventDate, dateTime, money } from "@/lib/api";
import { useStaffSession, notifyStaffLogout } from "@/lib/use-staff-session";
import { Wordmark, Loading, DemoBanner } from "./common";
const groupCashSuccess =
  "Cash payment confirmed and the whole group is checked in. No re-entry.";

export function Scanner({ history = false }) {
  const router = useRouter();
  const identity = useStaffSession(history ? "/scanner/history" : "/scanner", [
    "ADMIN",
    "SCANNER",
    "staff",
  ]);
  const ready = Boolean(identity);
  const [camera, setCamera] = useState(true);
  const [cameraRun, setCameraRun] = useState(0);
  const [token, setToken] = useState("");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dateError, setDateError] = useState(null);
  const [entered, setEntered] = useState(false);
  const [rows, setRows] = useState([]);
  const [cashConfirmed, setCashConfirmed] = useState(false);
  const groupCashDue = result?.paymentStatus === "DUE" && !result.ticket;
  const video = useRef(null);
  const scannerRef = useRef(null);
  const lock = useRef(false);
  const reviewing = useRef(false);
  const lastCode = useRef("");
  const lastSeenAt = useRef(0);
  const requestId = useRef("");
  useEffect(() => {
    if (ready && history)
      api("/admin/checkins")
        .then(setRows)
        .catch((e) => setError(e.message));
  }, [ready, history]);
  const verifyRef = useRef(async () => {});
  async function verify(value) {
    if (lock.current || reviewing.current) return;
    lock.current = true;
    reviewing.current = true;
    setBusy(true);
    setResult(null);
    setError("");
    setDateError(null);
    setEntered(false);
    setCashConfirmed(false);
    try {
      const input = value.includes("#") ? value.split("#").pop() : value.trim();
      setToken(input);
      setResult(await post("/scanner/verify", { token: input }));
      requestId.current = crypto.randomUUID();
    } catch (e) {
      reviewing.current = false;
      setError(e.message);
      setDateError(e.details || null);
    } finally {
      setBusy(false);
      lock.current = false;
    }
  }
  verifyRef.current = verify;
  useEffect(() => {
    if (!ready || history || !camera || !video.current) return;
    let cancelled = false;
    let instance = null;
    async function start() {
      try {
        const { default: QrScanner } = await import("qr-scanner");
        if (cancelled || !video.current) return;
        const scanner = new QrScanner(
          video.current,
          (result) => {
            lastSeenAt.current = Date.now();
            if (
              lock.current ||
              reviewing.current ||
              lastCode.current === result.data
            )
              return;
            lastCode.current = result.data;
            void verifyRef.current(result.data);
          },
          {
            preferredCamera: "environment",
            onDecodeError: () => {
              // Re-arm the same QR only after it has left the frame. This keeps
              // continuous video from repeatedly submitting one held ticket.
              if (Date.now() - lastSeenAt.current > 1500) lastCode.current = "";
            },
            highlightScanRegion: true,
            highlightCodeOutline: true,
          },
        );
        instance = scanner;
        scannerRef.current = scanner;
        await scanner.start();
        if (cancelled) scanner.destroy();
      } catch (e) {
        if (!cancelled) {
          setCamera(false);
          setError(
            `Camera unavailable. Allow camera access and use HTTPS or localhost, then start the camera again. ${e.message || ""}`,
          );
        }
      }
    }
    void start();
    return () => {
      cancelled = true;
      instance?.destroy();
      scannerRef.current = null;
    };
  }, [camera, cameraRun, ready, history]);
  useEffect(() => {
    if (entered !== groupCashSuccess) return;
    const timer = setTimeout(() => setEntered(false), 4000);
    return () => clearTimeout(timer);
  }, [entered]);
  useEffect(() => {
    const preview = video.current;
    if (entered !== groupCashSuccess || !camera || !preview) return;
    // The preview was hidden during review. Reuse its stream when possible.
    if (!preview.srcObject?.active) {
      setCameraRun((run) => run + 1);
      return;
    }
    if (!preview.paused) return;
    let cancelled = false;
    preview.play().catch(() => {
      if (cancelled) return;
      setCamera(false);
      setError("Camera could not resume automatically. Tap Start camera scanner.");
    });
    return () => {
      cancelled = true;
    };
  }, [entered, camera]);
  async function confirm() {
    if (!result || busy || lock.current) return;
    const due = result.paymentStatus === "DUE";
    if (due && !cashConfirmed) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setDateError(null);
    try {
      await post(
        "/scanner/checkin",
        {
          token,
          ...(due ? { amountReceived: result.amount } : {}),
          ...(groupCashDue ? { cashAcknowledged: cashConfirmed } : {}),
        },
        { "Idempotency-Key": requestId.current },
      );
      setEntered(
        result.ticket
          ? "This ticket is approved. Remaining tickets can enter separately."
          : groupCashDue
            ? groupCashSuccess
            : "The whole group is checked in. No re-entry.",
      );
      setResult(null);
      setToken("");
      setCashConfirmed(false);
      reviewing.current = false;
    } catch (e) {
      setError(e.message);
      setDateError(e.details || null);
      if (
        !groupCashDue ||
        e.details?.eventDate ||
        e.details?.code === "ALREADY_CHECKED_IN"
      ) {
        setResult(null);
        setToken("");
        setCashConfirmed(false);
        reviewing.current = false;
      }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  if (!ready) return <Loading />;
  return (
    <div className="scanner-app">
      <header>
        <Link href="/">
          <Wordmark />
        </Link>
        <div>
          {["ADMIN", "staff"].includes(identity?.role) && (
            <Link href="/admin/dashboard" aria-label="Back to dashboard">
              <LayoutDashboard size={20} />
            </Link>
          )}
          <Link
            aria-label="Entry history"
            href={history ? "/scanner" : "/scanner/history"}
          >
            {history ? <ScanLine /> : <History />}
          </Link>
          <button
            aria-label="Sign out"
            onClick={() =>
              post("/auth/logout", { scope: "staff" }).then(() => {
                notifyStaffLogout();
                router.replace("/login");
              })
            }
          >
            <LogOut size={20} />
          </button>
        </div>
      </header>
      <DemoBanner />
      <main className="scanner-main">
        {!history && <h1 className="sr-only">Gate scanner</h1>}
        {history ? (
          <>
            <Link href="/scanner" className="back-link">
              <ArrowLeft size={16} />
              Back to scanner
            </Link>
            <h1>Ticket entry history</h1>
            <p className="muted">Your recent check-ins · Asia/Kolkata</p>
            {rows.map((r) => (
              <div className="history-entry" key={r.id}>
                <Check />
                <div>
                  <b>{r.name}</b>
                  <p>
                    {r.reference} · {r.people} people
                  </p>
                  <small>{dateTime(r.createdAt)}</small>
                  {r.ticketNumber && (
                    <p>
                      {r.ticketNumber} /{" "}
                      {r.category === "ADULT" ? "Adult" : "Kid"}
                    </p>
                  )}
                </div>
              </div>
            ))}
            {!rows.length && <p>No ticket entries yet.</p>}
          </>
        ) : (
          <>
            {entered && (
              <div className="entry-success" role="status">
                <Check size={28} aria-hidden="true" />
                <h2>Welcome to Santa Social!</h2>
                <p>{entered}</p>
              </div>
            )}
            <div hidden={Boolean(result)}>
              <div className="camera-frame">
                {camera ? (
                  <video ref={video} muted playsInline />
                ) : (
                  <div>
                    <ScanLine size={76} strokeWidth={1} />
                    <p>Position the ticket QR inside the frame</p>
                  </div>
                )}
                <i />
                <i />
                <i />
                <i />
              </div>
              <button
                className="button full"
                disabled={busy}
                onClick={() => {
                  setError("");
                  setDateError(null);
                  setEntered(false);
                  setCamera(!camera);
                }}
              >
                <Camera size={19} />
                {camera ? "Stop camera" : "Start camera scanner"}
              </button>
            </div>
            {result && (
              <div
                className={`scan-result ${result.paymentStatus === "DUE" ? "cash-due" : "payment-paid"}`}
              >
                <div
                  className={`valid-ticket ${result.paymentStatus === "DUE" ? "cash-due-banner" : ""}`}
                >
                  <Check />
                  {result.paymentStatus === "DUE"
                    ? "CASH PAYMENT PENDING"
                    : "PAYMENT VERIFIED"}
                </div>
                <h3 className="scan-payment-heading">
                  {result.paymentStatus === "DUE"
                    ? result.ticket
                      ? `Collect ${money(result.amount)} and approve the ticket.`
                      : `Collect ${money(result.amount)} before approving group entry.`
                    : result.ticket
                      ? `Payment of ${money(result.amount)} received. Approve the ticket.`
                      : `Payment of ${money(result.amount)} received.`}
                </h3>
                <h2>{result.name}</h2>
                <p>
                  {result.ticket ? result.reference : `Booking ID: ${result.reference}`}
                </p>
                <p>{eventDate(result.eventDate)}</p>
                <p>
                  {result.mobile}
                  {result.email ? ` · ${result.email}` : ""}
                </p>
                <p className="scanner-payment-highlight">
                  {result.method === "CASH"
                    ? "Cash"
                    : result.method === "FREE"
                      ? "Free admission"
                      : "Online payment"}{" "}
                  · {money(result.amount)}
                </p>
                {result.ticket ? (
                  <>
                    <h3>Valid Ticket</h3>
                    <p>
                      Ticket Type:{" "}
                      {result.ticket.category === "ADULT" ? "Adult" : "Kid"}
                    </p>
                    <p>Ticket Number: {result.ticket.number}</p>
                    <p>Entry Status: Not Scanned</p>
                    <p>
                      Total Tickets: {result.people} | Approved:{" "}
                      {result.approvedTickets} | Pending:{" "}
                      {result.pendingTickets.length}
                    </p>
                    <details className="pending-ticket-list">
                      <summary>Pending tickets</summary>
                      <ul>
                        {result.pendingTickets.map((t) => (
                          <li key={t.id}>
                            {t.number} /{" "}
                            {t.category === "ADULT" ? "Adult" : "Kid"} / Not
                            Scanned
                          </li>
                        ))}
                      </ul>
                    </details>
                  </>
                ) : (
                  <>
                    <h3>{groupCashDue ? "Group Ticket" : "Valid Group Ticket"}</h3>
                    <p>Entry Status: Not Approved</p>
                    <ScannerCounts counts={result} />
                    {result.paymentStatus !== "DUE" && (
                      <p>
                        Confirm all {result.people} guests are present before approving.
                      </p>
                    )}
                  </>
                )}
                {result.paymentStatus === "DUE" &&
                  (["ADMIN", "staff"].includes(identity?.role) ? (
                    <label className="cash-collection-confirm">
                      <input
                        type="checkbox"
                        checked={cashConfirmed}
                        disabled={busy}
                        onChange={(e) => setCashConfirmed(e.target.checked)}
                      />
                      <span>
                        I have collected {money(result.amount)} in cash
                        {result.ticket
                          ? " and will admit only this ticket holder. This settles the payment for the entire booking."
                          : "."}
                      </span>
                    </label>
                  ) : (
                    <p role="alert">
                      An admin must collect cash and approve this ticket before
                      entry.
                    </p>
                  ))}
                {error && (
                  <div className="scanner-error" role="alert">{error}</div>
                )}
                <button
                  className={`button ${result.paymentStatus === "DUE" ? "" : "green"} full`}
                  disabled={
                    busy ||
                    (result.paymentStatus === "DUE" &&
                      (!["ADMIN", "staff"].includes(identity?.role) ||
                        !cashConfirmed))
                  }
                  onClick={confirm}
                >
                  {groupCashDue
                    ? busy ? "Approving Group Ticket..." : "Approve Group Ticket"
                    : busy ? "Approving…" : result.ticket ? "Approve ticket" : "Approve Group Entry"}
                  <Check size={20} />
                </button>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => {
                    reviewing.current = false;
                    setResult(null);
                    setToken("");
                    setCashConfirmed(false);
                    setError("");
                    setDateError(null);
                  }}
                >
                  Cancel and scan another ticket
                </button>
              </div>
            )}
          </>
        )}
        {error && !result && (
          <div className="scanner-error" role="alert">
            {dateError?.eventDate ? (
              <>
                <h2>Invalid Ticket</h2>
                <p>Registered Event Date: {eventDate(dateError.eventDate)}</p>
              </>
            ) : (
              <>
                {dateError?.code === "ALREADY_CHECKED_IN" ? (
                  <>
                    <h2>Already Approved</h2>
                    <p>Booking ID: {dateError.reference}</p>
                    <p>Entry Status: Approved</p>
                    <p>Approved At: {dateTime(dateError.approvedAt)}</p>
                    <ScannerCounts counts={dateError} entered />
                  </>
                ) : dateError?.code === "ALREADY_APPROVED" ? (
                  <>
                    <h2>Already Approved</h2>
                    <p>Ticket Number: {dateError.ticketNumber}</p>
                    <p>Entry Status: Approved</p>
                    <p>Entry Time: {dateTime(dateError.approvedAt)}</p>
                  </>
                ) : (
                  <p>{error}</p>
                )}
              </>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function ScannerCounts({ counts, entered = false }) {
  return (
    <div
      className="scanner-counts"
      aria-label={
        entered ? "Previously entered guests" : "Guests in this booking"
      }
    >
      <div>
        <b>{counts.adults}</b>
        <small>ADULTS</small>
      </div>
      <div>
        <b>{counts.kids}</b>
        <small>KIDS</small>
      </div>
      <div>
        <b>{counts.people}</b>
        <small>TOTAL GUESTS</small>
      </div>
    </div>
  );
}
