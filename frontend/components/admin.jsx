"use client";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import QRCode from "qrcode";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Ticket,
  ScanLine,
  LogOut,
  ArrowUpRight,
  Search,
  Download,
  Users,
  UserCheck,
  IndianRupee,
  CheckCircle,
  Clock,
  ArrowLeft,
  Menu,
} from "lucide-react";
import { api, post, money, dateTime, eventDate } from "@/lib/api";
import {
  staffDestination,
  staffLoginUrl,
  hasStaffLogin,
  setStaffLogin,
} from "@/lib/staff";
import { Wordmark, Notice, Loading, Status, DemoBanner } from "./common";
export function StaffLogin() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setStaffLogin(false);
  }, []);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const user = await post("/auth/login", { email, password });
      setStaffLogin(true);
      router.replace(
        staffDestination(
          user.role,
          new URLSearchParams(window.location.search).get("next") || "",
        ),
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="staff-login">
      <Link href="/">
        <Wordmark />
      </Link>
      <div className="narrow-card">
        <div className="round-icon">
          <LayoutDashboard />
        </div>
        <p className="eyebrow">SANTA SOCIAL · EVENT OPERATIONS</p>
        <h1>Admin Login</h1>
        <p className="muted">Sign in to access your event management tools.</p>
        <form onSubmit={submit}>
          <label>
            Email address
            <input
              required
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            Password
            <input
              required
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error && <Notice>{error}</Notice>}
          <button className="button full" disabled={busy}>
            {busy ? "Signing in…" : "Sign in securely"}
            <ArrowUpRight size={17} />
          </button>
        </form>
        <Link className="back-link" href="/">
          Back to the celebration
        </Link>
      </div>
    </main>
  );
}
const navigation = [
  ["dashboard", "Overview", LayoutDashboard],
  ["bookings", "Bookings", Ticket],
  ["checkins", "Check-ins", UserCheck],
];
export function Admin() {
  const path = usePathname();
  const router = useRouter();
  const section = path.split("/")[2] || "dashboard";
  const id = path.split("/")[3];
  const [identity, setIdentity] = useState(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!hasStaffLogin()) {
      router.replace(staffLoginUrl(path));
      return;
    }
    api("/auth/me?scope=staff")
      .then((user) => {
        if (!["ADMIN", "CASHIER"].includes(user.role))
          router.replace(staffDestination(user.role));
        else setIdentity(user);
      })
      .catch(() => {
        setStaffLogin(false);
        setIdentity(null);
        router.replace(staffLoginUrl(path));
      });
  }, [router, path]);
  async function logout() {
    await post("/auth/logout", { scope: "staff" });
    setStaffLogin(false);
    router.replace("/login");
  }
  if (!identity) return <Loading />;
  return (
    <div className="admin-layout">
      <aside className={`admin-sidebar ${open ? "open" : ""}`}>
        <Link href="/">
          <Wordmark />
        </Link>
        <p className="eyebrow">EVENT MANAGEMENT</p>
        <nav>
          {navigation.map(([key, label, Icon]) => (
            <Link
              onClick={() => setOpen(false)}
              key={key}
              href={`/admin/${key}`}
              className={section === key ? "active" : ""}
            >
              <Icon size={19} />
              {label}
            </Link>
          ))}
          {identity.role === "ADMIN" && (
            <Link href="/scanner">
              <ScanLine size={19} />
              Open gate scanner
            </Link>
          )}
        </nav>
        <div className="admin-profile">
          <span>{identity.name?.charAt(0)}</span>
          <div>
            <b>{identity.name}</b>
            <small>{identity.role}</small>
          </div>
          <button
            aria-label="Sign out"
            onClick={() => logout().catch((e) => setError(e.message))}
          >
            <LogOut size={18} />
          </button>
        </div>
      </aside>
      <div
        className={`admin-main ${identity.role === "ADMIN" ? "admin-with-scanner-shortcut" : ""}`}
      >
        <div className="admin-topbar">
          <button
            className="menu-button"
            aria-label="Toggle menu"
            onClick={() => setOpen(!open)}
          >
            <Menu />
          </button>
          <span>
            Santa Social <b>9th Edition</b>
          </span>
          <Link href="/" target="_blank">
            View event website <ArrowUpRight size={15} />
          </Link>
        </div>
        <DemoBanner />
        <div className="admin-content">
          {error && <Notice>{error}</Notice>}
          {section === "dashboard" ? (
            <Dashboard />
          ) : section === "bookings" ? (
            id ? (
              <BookingDetail id={id} />
            ) : (
              <Bookings />
            )
          ) : section === "checkins" ? (
            <OperationsTable />
          ) : (
            <Dashboard />
          )}
        </div>
        {identity.role === "ADMIN" && (
          <Link
            className="button admin-scanner-shortcut"
            href="/scanner"
            aria-label="Open Gate Scanner"
          >
            <ScanLine size={38} aria-hidden="true" />
          </Link>
        )}
      </div>
    </div>
  );
}
function DateFilter({ value, onChange }) {
  return (
    <div className="date-filter">
      {[
        ["all", "Both days"],
        ["2026-11-09", "Nov 9"],
        ["2026-11-10", "Nov 10"],
      ].map(([v, label]) => (
        <button
          key={v}
          className={value === v ? "active" : ""}
          onClick={() => onChange(v)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
function ResourceLoading({ error, retry }) {
  if (!error) return <Loading />;
  return (
    <div className="empty">
      <button className="button outline" onClick={retry}>
        Try again
      </button>
      <Link className="back-link" href="/login">
        Admin Login
      </Link>
    </div>
  );
}
function Dashboard() {
  const [date, setDate] = useState("all");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    setError("");
    return api(`/admin/dashboard?date=${date}`)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [date]);
  useEffect(() => {
    void load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);
  return (
    <>
      <div className="admin-page-heading">
        <div>
          <p className="eyebrow">A LITTLE OVERVIEW OF THE BIG CELEBRATION</p>
          <h1>Let’s make it a merry one.</h1>
          <p>9 & 10 November 2026 · Park Grounds, CODISSIA</p>
        </div>
        <DateFilter value={date} onChange={setDate} />
      </div>
      {error && <Notice>{error}</Notice>}
      {!data ? (
        <ResourceLoading error={error} retry={load} />
      ) : (
        <>
          <div className="stat-grid">
            {[
              [
                Ticket,
                "Total bookings",
                data.bookings,
                "Across all payment states",
              ],
              [
                Users,
                "Confirmed guests",
                data.attendees,
                `${data.adults} adults · ${data.kids} kids`,
              ],
              [
                IndianRupee,
                "Captured revenue",
                money(data.revenue),
                `${money(data.cashRevenue)} cash · ${money(data.onlineRevenue)} online`,
              ],
              [
                CheckCircle,
                "People welcomed",
                data.entered,
                `${data.checkedGroups} groups checked in`,
              ],
            ].map(([Icon, label, value, sub], i) => {
              const I = Icon;
              return (
                <div className="stat-card" key={i}>
                  <div>
                    <span>{String(label)}</span>
                    <I size={20} />
                  </div>
                  <strong>{String(value)}</strong>
                  <small>{String(sub)}</small>
                </div>
              );
            })}
            <div className="stat-card follow-up-stat">
              <div>
                <span>A little follow-up.</span>
                <Clock size={20} />
              </div>
              <strong>{data.pendingCash}</strong>
              <small>Cash bookings awaiting payment</small>
              <Link
                className="follow-up-link"
                href="/admin/bookings?status=PENDING_CASH"
              >
                Review bookings <ArrowUpRight size={16} />
              </Link>
              {data.notificationFailures > 0 && (
                <p className="error-text">
                  {data.notificationFailures} messages need a delivery retry.
                </p>
              )}
            </div>
          </div>
          <Bookings compact />
        </>
      )}
    </>
  );
}
function Bookings({ compact = false }) {
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [date, setDate] = useState("all");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const value = new URLSearchParams(location.search).get("status");
    if (value) setStatus(value);
  }, []);
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(query);
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [query]);
  const params = new URLSearchParams({
    q: search,
    date,
    status,
    page: String(page),
  });
  useEffect(() => {
    let cancelled = false;
    setError("");
    api(
      `/admin/bookings?${new URLSearchParams({ q: search, date, status, page: String(page) })}`,
    )
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [search, date, status, page, revision]);
  return (
    <section className="admin-card bookings-card">
      {!compact && (
        <div className="admin-page-heading">
          <div>
            <h1>Every booking, in one place.</h1>
            <p>Manage guests, payments, and group tickets.</p>
          </div>
        </div>
      )}
      <div className="card-heading">
        <h2>
          {compact ? "Recent bookings" : "Guest bookings"}{" "}
          {data && <span className="count-badge">{data.total}</span>}
        </h2>
        {compact ? (
          <Link href="/admin/bookings">
            View all <ArrowUpRight size={15} />
          </Link>
        ) : (
          <a
            className="button outline small"
            href={`/api/admin/bookings?${params}&format=csv`}
          >
            <Download size={16} />
            Export CSV
          </a>
        )}
      </div>
      <div className="table-tools">
        <div className="search-input">
          <Search size={17} />
          <input
            aria-label="Search bookings"
            placeholder="Search name, mobile or booking reference…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {!compact && (
          <>
            <select
              aria-label="Filter payment status"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              {[
                "all",
                "PENDING_CASH",
                "PENDING_PAYMENT",
                "PAID",
                "FREE",
                "EXPIRED",
                "CANCELLED",
                "PAYMENT_REVIEW",
              ].map((s) => (
                <option key={s} value={s}>
                  {s === "all" ? "All payment states" : s.replaceAll("_", " ")}
                </option>
              ))}
            </select>
            <DateFilter
              value={date}
              onChange={(v) => {
                setDate(v);
                setPage(1);
              }}
            />
          </>
        )}
      </div>
      {error && <Notice>{error}</Notice>}
      {!data ? (
        <ResourceLoading
          error={error}
          retry={() => setRevision((value) => value + 1)}
        />
      ) : (
        <>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Booking / guest</th>
                  <th>Event date</th>
                  <th>Group</th>
                  <th>Amount</th>
                  <th>Payment</th>
                  <th>Entry</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.rows.slice(0, compact ? 5 : 25).map((b) => (
                  <tr key={b.id}>
                    <td>
                      <Link href={`/admin/bookings/${b.id}`}>
                        <b>{b.name}</b>
                        <small>{b.reference}</small>
                      </Link>
                    </td>
                    <td>
                      {new Date(
                        `${b.eventDate}T12:00:00+05:30`,
                      ).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                        timeZone: "Asia/Kolkata",
                      })}
                      <small>{b.mobile}</small>
                    </td>
                    <td>
                      {b.people} guests
                      <small>
                        {b.adults} adults · {b.kids} kids
                      </small>
                    </td>
                    <td>
                      <b>{money(b.amount)}</b>
                      <small>{b.method}</small>
                    </td>
                    <td>
                      <Status value={b.status} />
                    </td>
                    <td>
                      <span
                        className={`entry-dot ${b.checkedInAt ? "entered" : ""}`}
                      />
                      {b.checkedInAt ? "Checked in" : "Not entered"}
                    </td>
                    <td>
                      <Link
                        aria-label={`View ${b.reference}`}
                        href={`/admin/bookings/${b.id}`}
                      >
                        <ArrowUpRight size={18} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.rows.length && (
              <div className="empty">No bookings match these filters.</div>
            )}
          </div>
          {!compact && (
            <div className="pagination">
              <small>
                {data.total} bookings · Page {page} of {Math.max(1, data.pages)}
              </small>
              <div>
                <button disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  Previous
                </button>
                <button
                  disabled={page >= data.pages}
                  onClick={() => setPage(page + 1)}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
function BookingQr({ booking }) {
  const [qr, setQr] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setQr(null);
    setError("");
    if (booking.qrToken)
      QRCode.toDataURL(booking.qrToken, {
        width: 600,
        margin: 4,
        errorCorrectionLevel: "M",
        color: { dark: "#153622", light: "#ffffff" },
      })
        .then((image) => {
          if (active) setQr(image);
        })
        .catch(() => {
          if (active)
            setError(
              "Unable to display this QR code. Please reload and try again.",
            );
        });
    return () => {
      active = false;
    };
  }, [booking.qrToken]);
  if (!booking.qrToken)
    return (
      <p className="field-hint">
        {booking.status === "PENDING_PAYMENT"
          ? "The QR ticket will be available after successful payment."
          : "This booking has no active QR ticket."}
      </p>
    );
  return (
    <div className="booking-qr-content">
      {error ? (
        <Notice>{error}</Notice>
      ) : qr ? (
        <img
          src={qr}
          width={240}
          height={240}
          alt="Unique QR code for this booking"
        />
      ) : (
        <Loading />
      )}
      {booking.status === "PENDING_CASH" && (
        <p className="field-hint">
          Cash due: {money(booking.amount)}. Payment approval is required before
          entry.
        </p>
      )}
    </div>
  );
}
function BookingDetail({ id }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    setError("");
    return api(`/admin/bookings/${id}`)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);
  const b = data?.booking;
  return (
    <>
      <Link className="back-link" href="/admin/bookings">
        <ArrowLeft size={16} />
        All bookings
      </Link>
      {error && <Notice>{error}</Notice>}
      {!b ? (
        <ResourceLoading error={error} retry={load} />
      ) : (
        <>
          <div className="admin-page-heading">
            <div>
              <p className="eyebrow">{b.reference}</p>
              <h1>{b.name}</h1>
              <p>
                {b.mobile} · {b.email}
              </p>
            </div>
            <Status value={b.status} />
          </div>
          <div className="dashboard-panels">
            <div className="admin-card">
              <h2>Booking details</h2>
              <dl className="detail-list">
                <dt>Event day</dt>
                <dd>{eventDate(b.eventDate)}</dd>
                <dt>Guests</dt>
                <dd>
                  {b.adults} adults + {b.kids} kids = {b.people}
                </dd>
                <dt>Amount</dt>
                <dd>
                  {money(b.amount)} · {b.method}
                </dd>
                <dt>Created</dt>
                <dd>{dateTime(b.createdAt)}</dd>
                <dt>Entry</dt>
                <dd>
                  {b.checkedInAt ? dateTime(b.checkedInAt) : "Not entered"}
                </dd>
              </dl>
            </div>
            <div className="admin-card booking-qr-card">
              <h2>Customer QR code</h2>
              <BookingQr booking={b} />
            </div>
          </div>
        </>
      )}
    </>
  );
}
function OperationsTable() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    setError("");
    return api("/admin/checkins")
      .then(setRows)
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    setRows(null);
    void load();
  }, [load]);
  return (
    <div className="admin-card">
      <h1>Group entry history</h1>
      <p className="muted">
        All recorded group entries, displayed in Asia/Kolkata.
      </p>
      {error && <Notice>{error}</Notice>}
      {!rows ? (
        <ResourceLoading error={error} retry={load} />
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Booking</th>
                <th>Guest</th>
                <th>People</th>
                <th>Entered at</th>
                <th>Staff ID</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/admin/bookings/${r.bookingId}`}>
                      {r.reference}
                    </Link>
                  </td>
                  <td>{r.name}</td>
                  <td>{r.people}</td>
                  <td>{dateTime(r.createdAt)}</td>
                  <td>{r.staffId}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && <div className="empty">No records yet.</div>}
        </div>
      )}
    </div>
  );
}
