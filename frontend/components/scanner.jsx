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
import {
  staffDestination,
  staffLoginUrl,
  hasStaffLogin,
  setStaffLogin,
} from "@/lib/staff";
import { Wordmark, Loading, DemoBanner } from "./common";
export function Scanner({ history = false }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [identity, setIdentity] = useState(null);
  const [camera, setCamera] = useState(true);
  const [token, setToken] = useState("");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dateError, setDateError] = useState(null);
  const [entered, setEntered] = useState(false);
  const [rows, setRows] = useState([]);
  const [cashConfirmed, setCashConfirmed] = useState(false);
  const video = useRef(null);
  const scannerRef = useRef(null);
  const lock = useRef(false);
  const reviewing = useRef(false);
  const lastCode = useRef("");
  const lastSeenAt = useRef(0);
  const requestId = useRef("");
  useEffect(() => {
    const loginUrl = staffLoginUrl(history ? "/scanner/history" : "/scanner");
    if (!hasStaffLogin()) {
      router.replace(loginUrl);
      return;
    }
    api("/auth/me?scope=staff")
      .then((u) => {
        if (!["ADMIN", "SCANNER"].includes(u.role))
          router.replace(staffDestination(u.role));
        else {
          setIdentity(u);
          setReady(true);
        }
      })
      .catch(() => {
        setStaffLogin(false);
        setReady(false);
        setIdentity(null);
        router.replace(loginUrl);
      });
  }, [router, history]);
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
  }, [camera, ready, history]);
  async function confirm() {
    if (!result || busy) return;
    setBusy(true);
    setError("");
    setDateError(null);
    try {
      await post(
        "/scanner/checkin",
        {
          token,
          ...(result.paymentStatus === "DUE"
            ? { amountReceived: result.amount }
            : {}),
        },
        { "Idempotency-Key": requestId.current },
      );
      setEntered(
        result.ticket
          ? "This ticket is approved. Remaining tickets can enter separately."
          : "The whole group is checked in. No re-entry.",
      );
      setResult(null);
      setToken("");
    } catch (e) {
      setError(e.message);
      setDateError(e.details || null);
      setResult(null);
    } finally {
      reviewing.current = false;
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
          {identity?.role === "ADMIN" && (
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
                setStaffLogin(false);
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
                    ? `Collect Rs. ${result.amount / 100} & Approve the Ticket.`
                    : `Paid Rs. ${result.amount / 100}. Approve the Ticket.`}
                </h3>
                <h2>{result.name}</h2>
                <p>{result.reference}</p>
                <p>{eventDate(result.eventDate)}</p>
                <p>
                  {result.mobile} · {result.email}
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
                  <ScannerCounts counts={result} />
                )}
                {result.paymentStatus === "DUE" &&
                  (identity?.role === "ADMIN" ? (
                    <label className="cash-collection-confirm">
                      <input
                        type="checkbox"
                        checked={cashConfirmed}
                        onChange={(e) => setCashConfirmed(e.target.checked)}
                      />
                      I have collected {money(result.amount)} in cash and
                      {result.ticket
                        ? "will admit only this ticket holder. This settles the entire booking payment."
                        : "counted the whole group."}
                    </label>
                  ) : (
                    <p role="alert">
                      An admin must collect cash and approve this ticket before
                      entry.
                    </p>
                  ))}
                <button
                  className={`button ${result.paymentStatus === "DUE" ? "" : "green"} full`}
                  disabled={
                    busy ||
                    (result.paymentStatus === "DUE" &&
                      (identity?.role !== "ADMIN" || !cashConfirmed))
                  }
                  onClick={confirm}
                >
                  {busy ? "Approving…" : "Approve ticket"}
                  <Check size={20} />
                </button>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => {
                    reviewing.current = false;
                    setResult(null);
                    setToken("");
                  }}
                >
                  Cancel & scan another ticket
                </button>
              </div>
            )}
          </>
        )}
        {error && (
          <div className="scanner-error" role="alert">
            {dateError?.eventDate ? (
              <>
                <h2>Invalid Ticket</h2>
                <p>Registered Event Date: {eventDate(dateError.eventDate)}</p>
              </>
            ) : (
              <>
                {dateError?.code === "ALREADY_APPROVED" ? (
                  <>
                    <h2>Already Approved</h2>
                    <p>Ticket Number: {dateError.ticketNumber}</p>
                    <p>Entry Status: Approved</p>
                    <p>Entry Time: {dateTime(dateError.approvedAt)}</p>
                  </>
                ) : (
                  <p>{error}</p>
                )}
                {dateError?.code === "ALREADY_CHECKED_IN" && (
                  <ScannerCounts counts={dateError} entered />
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
