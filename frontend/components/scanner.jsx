"use client";
import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Camera,
  ScanLine,
  Check,
  Users,
  LogOut,
  History,
  ArrowLeft,
  XCircle,
  LayoutDashboard,
} from "lucide-react";
import { api, post, eventDate, dateTime, money } from "@/lib/api";
import { staffDestination, staffLoginUrl } from "@/lib/staff";
import { Wordmark, Loading, DemoBanner } from "./common";
export function Scanner({ history = false }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [identity, setIdentity] = useState(null);
  const [camera, setCamera] = useState(false);
  const [token, setToken] = useState("");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [entered, setEntered] = useState(false);
  const [rows, setRows] = useState([]);
  const [cashConfirmed, setCashConfirmed] = useState(false);
  const video = useRef(null);
  const scannerRef = useRef(null);
  const lock = useRef(false);
  const requestId = useRef("");
  useEffect(() => {
    api("/auth/me?scope=staff")
      .then((u) => {
        if (!["ADMIN", "SCANNER"].includes(u.role))
          router.replace(staffDestination(u.role));
        else {
          setIdentity(u);
          setReady(true);
        }
      })
      .catch(() =>
        router.replace(
          staffLoginUrl(history ? "/scanner/history" : "/scanner"),
        ),
      );
  }, [router, history]);
  useEffect(() => {
    if (ready && history)
      api("/admin/checkins")
        .then(setRows)
        .catch((e) => setError(e.message));
  }, [ready, history]);
  const verifyRef = useRef(async () => {});
  async function verify(value) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setResult(null);
    setError("");
    setEntered(false);
    setCashConfirmed(false);
    scannerRef.current?.stop();
    setCamera(false);
    try {
      const input = value.includes("#") ? value.split("#").pop() : value.trim();
      setToken(input);
      setResult(await post("/scanner/verify", { token: input }));
      requestId.current = crypto.randomUUID();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
      lock.current = false;
    }
  }
  verifyRef.current = verify;
  useEffect(() => {
    if (!camera || !video.current) return;
    let cancelled = false;
    let instance = null;
    async function start() {
      try {
        const { default: QrScanner } = await import("qr-scanner");
        if (cancelled || !video.current) return;
        const scanner = new QrScanner(
          video.current,
          (result) => {
            void verifyRef.current(result.data);
          },
          {
            preferredCamera: "environment",
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
  }, [camera]);
  async function confirm() {
    if (!result || busy) return;
    setBusy(true);
    setError("");
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
      setEntered(true);
      setResult(null);
      setToken("");
    } catch (e) {
      setError(e.message);
      setResult(null);
    } finally {
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
              post("/auth/logout", { scope: "staff" }).then(() =>
                router.replace("/login"),
              )
            }
          >
            <LogOut size={20} />
          </button>
        </div>
      </header>
      <DemoBanner />
      <main className="scanner-main">
        {history ? (
          <>
            <Link href="/scanner" className="back-link">
              <ArrowLeft size={16} />
              Back to scanner
            </Link>
            <h1>Groups welcomed.</h1>
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
                </div>
              </div>
            ))}
            {!rows.length && <p>No group entries yet.</p>}
          </>
        ) : (
          <>
            <p className="eyebrow scanner-heading">SANTA SOCIAL · GATE OPERATIONS</p>
            {entered && (
              <div className="entry-success" role="status">
                <Check size={48} />
                <h2>Welcome to Santa Social!</h2>
                <p>The whole group is checked in. No re-entry.</p>
              </div>
            )}
            {!result && (
              <>
                <div className="camera-frame">
                  {camera ? (
                    <video ref={video} muted playsInline />
                  ) : (
                    <div>
                      <ScanLine size={76} strokeWidth={1} />
                      <p>Position the group QR inside the frame</p>
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
                    setEntered(false);
                    setCamera(!camera);
                  }}
                >
                  <Camera size={19} />
                  {camera ? "Stop camera" : "Start camera scanner"}
                </button>
              </>
            )}
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
                <p>
                  {result.method === "CASH"
                    ? "Cash"
                    : result.method === "FREE"
                      ? "Free admission"
                      : "Online payment"}{" "}
                  · {money(result.amount)}
                </p>
                <div className="scanner-counts">
                  <div>
                    <b>{result.adults}</b>
                    <small>ADULTS</small>
                  </div>
                  <div>
                    <b>{result.kids}</b>
                    <small>KIDS</small>
                  </div>
                  <div>
                    <b>{result.people}</b>
                    <small>TOTAL GUESTS</small>
                  </div>
                </div>
                <div className="group-note">
                  <Users />
                  <p>
                    Count all {result.people} guests before confirming. Everyone
                    must enter together.
                  </p>
                </div>
                {result.paymentStatus === "DUE" &&
                  (identity?.role === "ADMIN" ? (
                    <label className="cash-collection-confirm">
                      <input
                        type="checkbox"
                        checked={cashConfirmed}
                        onChange={(e) => setCashConfirmed(e.target.checked)}
                      />
                      I have collected {money(result.amount)} in cash and
                      counted the whole group.
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
                  {busy
                    ? "Approving…"
                    : result.paymentStatus === "DUE"
                      ? "Approve cash payment & group entry"
                      : "Approve ticket & group entry"}
                  <Check size={20} />
                </button>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => {
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
            <XCircle size={28} />
            <p>{error}</p>
          </div>
        )}
      </main>
    </div>
  );
}
