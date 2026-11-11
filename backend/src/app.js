import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { randomInt, randomUUID } from "node:crypto";
import { sendTicketDownload } from "./ticket-artwork.js";
import {
  adminBookingVisibility,
  hiddenSimulatedBooking,
} from "./admin-reporting.js";
import {
  config,
  demo,
  paymentDemo,
  paymentMode,
  whatsappMode,
  whatsappDemo,
  production,
  databaseDriver,
} from "./config.js";
import {
  hmac,
  hash,
  equal,
  readSession,
  signSession,
  passwordMatches,
  qrToken,
} from "./security.js";
import {
  AppError,
  fail,
  now,
  lockEvent,
  expire,
  availability,
  createBooking,
  assertBookableDate,
  replacePaymentMethod,
  getBooking,
  publicBooking,
  settleCaptured,
  approveCash,
  inspectTicket,
  hasBookingQr,
  checkin,
  audit,
} from "./services.js";
import { getMessaging, razorpay } from "./providers.js";
const mobileSchema = z
  .string()
  .regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit Indian mobile number.");
const bookingSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.union([z.email().max(190), z.literal("")]).optional().default(""),
  eventDate: z.enum(["2026-11-11", "2026-11-12"]),
  adults: z.number().int().min(0).max(100),
  kids: z.number().int().min(0).max(100),
  method: z.enum(["RAZORPAY", "CASH"]),
});
const requestKey = (req) =>
  z.string().min(16).max(100).parse(req.get("Idempotency-Key"));
const param = (req, name = "id") => String(req.params[name]);
const cookieOptions = {
  httpOnly: true,
  secure: production,
  sameSite: "lax",
  path: "/api",
};
export function createApp(db, { paymentGateway = razorpay, notify } = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", "loopback");
  app.use(helmet());
  if (notify)
    app.use("/api", (req, res, next) => {
      res.once("finish", () => {
        if (
          req.method === "POST" &&
          res.statusCode >= 200 &&
          res.statusCode < 300
        )
          Promise.resolve()
            .then(notify)
            .catch(() => {
              console.error(
                "Queued WhatsApp notifications will retry in the background.",
              );
            });
      });
      next();
    });
  app.use(
    "/api",
    rateLimit({
      windowMs: 60000,
      limit: 300,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { error: "Too many requests. Please wait a minute." },
    }),
  );
  // Raw webhook bytes must be read before the JSON parser or CSRF middleware.
  app.post(
    "/api/webhooks/razorpay",
    express.raw({ type: "application/json", limit: "256kb" }),
    async (req, res) => {
      if (paymentDemo) fail(400, "Live webhooks are disabled in demo mode.");
      const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
      if (!secret) fail(503, "Webhook verification is not configured.");
      const signature = req.get("x-razorpay-signature") || "";
      if (
        !Buffer.isBuffer(req.body) ||
        !equal(hmac(req.body.toString("utf8"), secret), signature)
      )
        fail(400, "Invalid webhook signature.");
      const event = JSON.parse(req.body.toString("utf8"));
      const id = z
        .string()
        .min(1)
        .max(100)
        .parse(req.get("x-razorpay-event-id"));
      if (event.event === "payment.captured") {
        const p = event.payload?.payment?.entity;
        if (p?.status !== "captured") fail(400, "Payment is not captured.");
        await settleCaptured(db, p.order_id, p.id, p.amount, p.currency, {
          id,
          type: event.event,
        });
      }
      res.json({ received: true });
    },
  );
  app.use(express.json({ limit: "32kb" }), cookieParser());
  app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.get("origin") !== config.origin
    )
      return res.status(403).json({ error: "Request origin is not allowed." });
    next();
  });
  app.use("/api", async (req, res, next) => {
    async function identity(token) {
      try {
        if (!token) return undefined;
        const value = await readSession(token);
        if (value.userId) {
          const user = (
            await db.all(
              "SELECT id,role,name FROM users WHERE id = ? AND active = 1",
              [value.userId],
            )
          )[0];
          return user
            ? { ...value, role: user.role, name: user.name }
            : undefined;
        }
        return value.mobile ? value : undefined;
      } catch {
        return undefined;
      }
    }
    const customerOrLegacyStaff = await identity(req.cookies.santa_session);
    const staff = await identity(req.cookies.santa_staff_session);
    req.legacyStaff = Boolean(customerOrLegacyStaff?.userId);
    req.customerIdentity = customerOrLegacyStaff?.userId
      ? undefined
      : customerOrLegacyStaff;
    req.staffIdentity = staff?.userId
      ? staff
      : req.legacyStaff
        ? customerOrLegacyStaff
        : undefined;
    if (req.legacyStaff && !staff?.userId)
      res.cookie("santa_staff_session", req.cookies.santa_session, {
        ...cookieOptions,
        maxAge: Math.max(
          0,
          Number(customerOrLegacyStaff.exp) * 1000 - Date.now(),
        ),
      });
    const staffRoute = /^\/api\/(admin|scanner)(\/|$)/.test(req.originalUrl);
    req.identity = staffRoute
      ? req.staffIdentity || req.customerIdentity
      : req.customerIdentity || req.staffIdentity;
    next();
  });
  const auth = (roles) => (req, _res, next) => {
    if (!req.identity)
      return next(
        new AppError(401, "Please sign in or verify your mobile number."),
      );
    if (roles && !roles.includes(req.identity.role || ""))
      return next(
        new AppError(403, "Your account cannot perform this action."),
      );
    next();
  };
  const own = async (req, id) => {
    const b = await getBooking(db, id);
    if (
      req.identity?.mobile !== b.mobile &&
      !["ADMIN", "CASHIER"].includes(req.staffIdentity?.role || "")
    )
      fail(403, "This booking belongs to another customer.");
    return b;
  };
  const otpLimit = rateLimit({
    windowMs: 15 * 60000,
    limit: 10,
    message: { error: "Too many OTP requests. Try again in 15 minutes." },
  });
  app.get("/api/health", async (_req, res) => {
    await db.all("SELECT 1 AS ok");
    res.json({
      ok: true,
      mode: demo ? "demo" : "live",
      paymentMode,
      otpMode: whatsappMode,
      whatsappMode,
      database: databaseDriver,
      release: "automatic-ticket-whatsapp-1",
    });
  });
  app.get("/api/events", async (_req, res) =>
    res.json({
      event: await availability(db),
      demo: paymentDemo,
      demoEventDate: paymentDemo ? config.demoDate : undefined,
    }),
  );
  app.get("/api/events/:id/availability", async (_req, res) =>
    res.json(await availability(db)),
  );
  app.post("/api/otp/send", otpLimit, async (req, res) => {
    const mobile = mobileSchema.parse(req.body.mobile);
    const latest = (
      await db.all(
        "SELECT createdAt FROM otp_verifications WHERE mobile = ? ORDER BY createdAt DESC LIMIT 1",
        [mobile],
      )
    )[0];
    if (latest && Date.now() - Date.parse(latest.createdAt) < 60000)
      fail(429, "Please wait 60 seconds before requesting another code.");
    const id = randomUUID(),
      otp = String(randomInt(100000, 1000000));
    await (await getMessaging()).sendOtp(mobile, otp);
    await db.transaction(async (tx) => {
      await tx.run(
        "UPDATE otp_verifications SET expiresAt = ? WHERE mobile = ? AND verifiedAt IS NULL",
        [now(), mobile],
      );
      await tx.run(
        "INSERT INTO otp_verifications (id,mobile,otpHash,expiresAt,createdAt) VALUES (?,?,?,?,?)",
        [
          id,
          mobile,
          hmac(`${id}:${mobile}:${otp}`, config.otpSecret),
          new Date(Date.now() + 5 * 60000).toISOString(),
          now(),
        ],
      );
    });
    res.json({
      challengeId: id,
      expiresIn: 300,
      resendIn: 60,
      demo: whatsappDemo,
      ...(whatsappDemo ? { demoCode: otp } : {}),
    });
  });
  app.post("/api/otp/verify", otpLimit, async (req, res) => {
    const input = z
      .object({
        challengeId: z.uuid(),
        mobile: mobileSchema,
        otp: z.string().regex(/^\d{6}$/),
      })
      .parse(req.body);
    const result = await db.transaction(async (tx) => {
      const otp = (
        await tx.all(
          "SELECT * FROM otp_verifications WHERE id = ? FOR UPDATE",
          [input.challengeId],
        )
      )[0];
      if (
        !otp ||
        otp.mobile !== input.mobile ||
        otp.verifiedAt ||
        otp.expiresAt <= now() ||
        otp.attempts >= 5
      )
        return false;
      await tx.run(
        "UPDATE otp_verifications SET attempts = attempts + 1 WHERE id = ?",
        [otp.id],
      );
      if (
        !equal(
          otp.otpHash,
          hmac(`${otp.id}:${input.mobile}:${input.otp}`, config.otpSecret),
        )
      )
        return false;
      await tx.run("UPDATE otp_verifications SET verifiedAt = ? WHERE id = ?", [
        now(),
        otp.id,
      ]);
      return true;
    });
    if (!result)
      fail(
        400,
        "Incorrect, expired, or exhausted verification code. Request a new code.",
      );
    res
      .cookie("santa_session", await signSession({ mobile: input.mobile }), {
        ...cookieOptions,
        maxAge: 30 * 60000,
      })
      .json({ verified: true });
  });
  app.post(
    "/api/auth/login",
    rateLimit({
      windowMs: 15 * 60000,
      limit: 15,
      message: { error: "Too many sign-in attempts. Try again later." },
    }),
    async (req, res) => {
      const input = z
        .object({ email: z.email(), password: z.string().max(200) })
        .parse(req.body);
      const user = (
        await db.all("SELECT * FROM users WHERE email = ? AND active = 1", [
          input.email.toLowerCase(),
        ])
      )[0];
      if (!user || !passwordMatches(input.password, user.passwordHash))
        fail(401, "Incorrect email or password.");
      res.cookie(
        "santa_staff_session",
        await signSession(
          { userId: user.id, role: user.role, name: user.name },
          true,
        ),
        { ...cookieOptions, maxAge: 8 * 3600000 },
      );
      if (req.legacyStaff) res.clearCookie("santa_session", cookieOptions);
      res.json({ role: user.role, name: user.name });
    },
  );
  app.post("/api/auth/logout", (req, res) => {
    const scope = z
      .enum(["staff", "customer", "all"])
      .parse(req.body?.scope || "all");
    if (scope !== "customer")
      res.clearCookie("santa_staff_session", cookieOptions);
    if (scope !== "staff" || req.legacyStaff)
      res.clearCookie("santa_session", cookieOptions);
    res.json({ ok: true });
  });
  app.get(
    "/api/auth/me",
    (req, _res, next) => {
      const scope = z
        .enum(["staff", "customer", "auto"])
        .parse(req.query.scope || "auto");
      req.identity =
        scope === "staff"
          ? req.staffIdentity
          : scope === "customer"
            ? req.customerIdentity
            : req.staffIdentity || req.customerIdentity;
      next();
    },
    auth(),
    (req, res) => res.json(req.identity),
  );
  app.post("/api/bookings", auth(), async (req, res) => {
    if (!req.identity?.mobile) fail(403, "Verify your mobile number first.");
    const b = await createBooking(
      db,
      bookingSchema.parse(req.body),
      req.identity.mobile,
      requestKey(req),
    );
    res.status(201).json(publicBooking(b));
  });
  app.get("/api/bookings/:id", auth(), async (req, res) => {
    await db.transaction(async (tx) => {
      await lockEvent(tx);
      await expire(tx);
    });
    res.json(publicBooking(await own(req, param(req))));
  });
  app.post("/api/bookings/:id/payment-method", auth(), async (req, res) => {
    if (!req.identity?.mobile) fail(403, "Verify your mobile number first.");
    const { method } = z
      .object({ method: z.enum(["RAZORPAY", "CASH"]) })
      .parse(req.body);
    res.json(
      publicBooking(
        await replacePaymentMethod(
          db,
          param(req),
          req.identity.mobile,
          method,
          requestKey(req),
        ),
      ),
    );
  });
  app.post("/api/tickets/retrieve", auth(), async (req, res) => {
    if (!req.identity?.mobile) fail(403, "Verify your mobile number first.");
    res.json(
      (
        await db.all(
          "SELECT b.*,p.orderId AS gatewayOrderId,p.paymentId AS gatewayPaymentId FROM bookings b LEFT JOIN payments p ON p.bookingId=b.id WHERE b.mobile = ? ORDER BY b.createdAt DESC",
          [req.identity.mobile],
        )
      ).map(publicBooking),
    );
  });
  app.post("/api/payments/razorpay/order", auth(), async (req, res) => {
    const b = await own(req, z.uuid().parse(req.body.bookingId));
    if (b.method !== "RAZORPAY" || b.status !== "PENDING_PAYMENT")
      fail(409, "This booking cannot accept an online payment.");
    assertBookableDate(b.eventDate);
    let payment = (
      await db.all("SELECT * FROM payments WHERE bookingId = ?", [b.id])
    )[0];
    if (!payment.orderId) {
      // Claim order creation first; never hold an inventory transaction over network I/O.
      const claim = `creating_${randomUUID()}`;
      const won = await db.run(
        "UPDATE payments SET orderId = ? WHERE id = ? AND orderId IS NULL",
        [claim, payment.id],
      );
      if (won.changes) {
        try {
          const order = paymentDemo
            ? { id: `order_demo_${randomUUID()}` }
            : await paymentGateway().orders.create({
                amount: b.amount,
                currency: "INR",
                receipt: b.reference,
              });
          await db.run(
            "UPDATE payments SET orderId = ? WHERE id = ? AND orderId = ?",
            [order.id, payment.id, claim],
          );
        } catch (e) {
          await db.run(
            "UPDATE payments SET orderId = NULL WHERE id = ? AND orderId = ?",
            [payment.id, claim],
          );
          throw e;
        }
      }
      payment = (
        await db.all("SELECT * FROM payments WHERE bookingId = ?", [b.id])
      )[0];
    }
    if (
      payment.orderId &&
      !payment.orderId.startsWith("creating_") &&
      payment.orderId.startsWith("order_demo_") !== paymentDemo
    )
      fail(
        409,
        "This booking was started in a different payment mode. Please create a new booking.",
      );
    if (payment.orderId?.startsWith("creating_"))
      fail(409, "Payment order is being created. Please retry shortly.");
    res.json({
      orderId: payment.orderId,
      amount: b.amount,
      currency: "INR",
      keyId: paymentDemo ? null : process.env.RAZORPAY_KEY_ID,
      demo: paymentDemo,
    });
  });
  app.post("/api/payments/razorpay/verify", auth(), async (req, res) => {
    if (paymentDemo) fail(400, "Use the labelled demo payment endpoint.");
    const input = z
      .object({
        bookingId: z.uuid(),
        razorpay_order_id: z.string(),
        razorpay_payment_id: z.string(),
        razorpay_signature: z.string(),
      })
      .parse(req.body);
    const b = await own(req, input.bookingId);
    const p = (
      await db.all("SELECT * FROM payments WHERE bookingId = ?", [b.id])
    )[0];
    if (
      p.orderId !== input.razorpay_order_id ||
      !equal(
        hmac(
          `${p.orderId}|${input.razorpay_payment_id}`,
          process.env.RAZORPAY_KEY_SECRET || "",
        ),
        input.razorpay_signature,
      )
    )
      fail(400, "Payment signature is invalid.");
    if (p.orderId?.startsWith("order_demo_"))
      fail(400, "A simulated order cannot accept live payments.");
    const evidence = await paymentGateway().payments.fetch(
      input.razorpay_payment_id,
    );
    if (evidence.status !== "captured")
      return res.status(202).json({
        pending: true,
        message:
          "Your payment is awaiting capture. Return here shortly to check its status.",
      });
    if (evidence.order_id !== p.orderId) fail(400, "Payment order mismatch.");
    await settleCaptured(
      db,
      p.orderId,
      evidence.id,
      Number(evidence.amount),
      evidence.currency,
    );
    res.json(publicBooking(await getBooking(db, b.id)));
  });
  app.post("/api/demo/payments/complete", auth(), async (req, res) => {
    if (!paymentDemo) fail(404, "Not found.");
    const b = await own(req, z.uuid().parse(req.body.bookingId));
    const p = (
      await db.all("SELECT * FROM payments WHERE bookingId = ?", [b.id])
    )[0];
    if (!p.orderId?.startsWith("order_demo_"))
      fail(400, "Create a demo order first.");
    await settleCaptured(db, p.orderId, `pay_demo_${p.id}`, b.amount, "INR");
    res.json(publicBooking(await getBooking(db, b.id)));
  });
  app.get("/api/tickets/:id", async (req, res) => {
    const b = await getBooking(db, param(req));
    const bearer = req.get("authorization")?.replace(/^Bearer /, "");
    if (!bearer || bearer !== qrToken(b)) {
      await own(req, b.id);
    }
    if (!hasBookingQr(b))
      fail(403, "Your ticket will be available after payment approval.");
    res.json(publicBooking(b));
  });
  app.get("/api/tickets/:id/download", async (req, res) => {
    const b = await getBooking(db, param(req));
    const bearer = req.get("authorization")?.replace(/^Bearer /, "");
    if (
      !bearer?.startsWith("ss_") ||
      !equal(bearer.slice(3), qrToken(b).slice(3))
    )
      await own(req, b.id);
    if (!hasBookingQr(b)) fail(403, "Ticket is not active.");
    await sendTicketDownload(
      res,
      { ...b, demo: publicBooking(b).demo },
      req.query.format,
    );
  });
  const staff = auth(["ADMIN", "CASHIER"]);
  app.post("/api/admin/bookings/:id/approve", staff, async (req, res) =>
    res.json(
      await approveCash(
        db,
        param(req),
        z.number().int().nonnegative().parse(req.body.amountReceived),
        req.identity.userId,
      ),
    ),
  );
  app.post("/api/admin/bookings/:id/restore", staff, async (req, res) => {
    res.json(
      await db.transaction(async (tx) => {
        await lockEvent(tx);
        await expire(tx);
        const b = await getBooking(tx, param(req));
        if (b.method !== "CASH" || b.status !== "EXPIRED")
          fail(409, "Only expired cash bookings can be restored.");
        await tx.run(
          "UPDATE bookings SET status = 'PENDING_CASH', holdUntil = ?, updatedAt = ?, qrHash = ? WHERE id = ?",
          [now(), now(), hash(qrToken(b)), b.id],
        );
        await audit(tx, req.identity.userId, "RESTORE_CASH", b.id);
        return publicBooking(await getBooking(tx, b.id));
      }),
    );
  });
  app.post(
    "/api/admin/bookings/:id/cancel",
    auth(["ADMIN"]),
    async (req, res) => {
      await db.transaction(async (tx) => {
        await lockEvent(tx);
        const b = await getBooking(tx, param(req));
        if (b.checkedInAt)
          fail(409, "A checked-in booking cannot be cancelled.");
        if (["PAID", "FREE", "PAYMENT_REVIEW"].includes(b.status))
          fail(
            409,
            "Paid bookings require a verified refund workflow. Contact the payment operator.",
          );
        await tx.run(
          "UPDATE bookings SET status = 'CANCELLED', updatedAt = ? WHERE id = ?",
          [now(), b.id],
        );
        await audit(tx, req.identity.userId, "CANCEL_BOOKING", b.id);
      });
      res.json({ ok: true });
    },
  );
  app.post("/api/admin/bookings/:id/notify", staff, async (req, res) => {
    await db.run(
      "UPDATE notification_logs SET status = 'QUEUED', attempts = 0, nextAttemptAt = ? WHERE bookingId = ?",
      [now(), param(req)],
    );
    await audit(db, req.identity.userId, "RESEND_NOTIFICATION", param(req));
    res.json({ queued: true });
  });
  app.get("/api/admin/bookings/:id", staff, async (req, res) => {
    const b = await getBooking(db, param(req));
    if (hiddenSimulatedBooking(b)) fail(404, "Booking not found.");
    res.json({
      booking: publicBooking(b),
      payments: await db.all("SELECT * FROM payments WHERE bookingId = ?", [
        b.id,
      ]),
      notifications: await db.all(
        "SELECT * FROM notification_logs WHERE bookingId = ?",
        [b.id],
      ),
      checkins: await db.all("SELECT * FROM checkins WHERE bookingId = ?", [
        b.id,
      ]),
    });
  });
  app.get("/api/admin/bookings", staff, async (req, res) => {
    const q = z
      .string()
      .max(100)
      .parse(req.query.q || "");
    const date = z
      .union([z.literal("all"), z.iso.date()])
      .parse(req.query.date || "all");
    const status = z
      .string()
      .max(30)
      .parse(req.query.status || "all");
    const page = Math.max(1, Number(req.query.page) || 1);
    // Decide optional filters in JavaScript. Comparing a bound string with a
    // SQL literal can conflict with the host's connection/literal collations.
    const clauses = ["(reference LIKE ? OR name LIKE ? OR mobile LIKE ?)"];
    const values = [`%${q}%`, `%${q}%`, `%${q}%`];
    const visibility = adminBookingVisibility("bookings");
    clauses.push(visibility.sql);
    values.push(...visibility.values);
    if (date !== "all") {
      clauses.push("eventDate = ?");
      values.push(date);
    }
    if (status !== "all") {
      clauses.push("status = ?");
      values.push(status);
    }
    const where = `WHERE ${clauses.join(" AND ")}`;
    const total = Number(
      (await db.all(`SELECT COUNT(*) AS n FROM bookings ${where}`, values))[0]
        .n,
    );
    const rows = await db.all(
      `SELECT bookings.*,(SELECT orderId FROM payments WHERE bookingId=bookings.id) AS gatewayOrderId,(SELECT paymentId FROM payments WHERE bookingId=bookings.id) AS gatewayPaymentId FROM bookings ${where} ORDER BY createdAt DESC LIMIT 25 OFFSET ${Math.floor((page - 1) * 25)}`,
      values,
    );
    if (req.query.format === "csv") {
      const all = await db.all(
        `SELECT * FROM bookings ${where} ORDER BY createdAt DESC`,
        values,
      );
      const columns = [
        "reference",
        "name",
        "mobile",
        "email",
        "eventDate",
        "adults",
        "kids",
        "people",
        "amount",
        "method",
        "status",
        "checkedInAt",
        "createdAt",
      ];
      const quote = (v) =>
        `"${String(v ?? "")
          .replace(/^[=+@\-\t\r]/, "'$&")
          .replace(/"/g, '""')}"`;
      res
        .type("text/csv")
        .attachment("santa-social-bookings.csv")
        .send(
          [
            columns.join(","),
            ...all.map((r) => columns.map((c) => quote(r[c])).join(",")),
          ].join("\r\n"),
        );
    } else
      res.json({
        rows: rows.map(publicBooking),
        total,
        page,
        pages: Math.ceil(total / 25),
      });
  });
  app.get("/api/admin/dashboard", staff, async (req, res) => {
    const date = z
      .union([z.literal("all"), z.iso.date()])
      .parse(req.query.date || "all");
    const visibility = adminBookingVisibility("b");
    const rows = await db.all(
      "SELECT b.*,p.status AS paymentStatus FROM bookings b JOIN payments p ON p.bookingId = b.id" +
        ` WHERE ${visibility.sql}` +
        (date === "all" ? "" : " AND b.eventDate = ?"),
      [...visibility.values, ...(date === "all" ? [] : [date])],
    );
    const sum = (rs, key) => rs.reduce((s, r) => s + Number(r[key]), 0);
    const confirmed = rows.filter((r) => ["PAID", "FREE"].includes(r.status));
    const entered = rows.filter((r) => r.checkedInAt);
    const captured = rows.filter((r) => r.paymentStatus === "CAPTURED");
    res.json({
      bookings: rows.length,
      attendees: sum(confirmed, "people"),
      adults: sum(confirmed, "adults"),
      kids: sum(confirmed, "kids"),
      revenue: sum(captured, "amount"),
      cashRevenue: sum(
        captured.filter((r) => r.method === "CASH"),
        "amount",
      ),
      onlineRevenue: sum(
        captured.filter((r) => r.method === "RAZORPAY"),
        "amount",
      ),
      pendingCash: rows.filter((r) => r.status === "PENDING_CASH").length,
      confirmed: confirmed.length,
      checkedGroups: entered.length,
      entered: sum(entered, "people"),
      availability: await availability(db),
      demo: paymentDemo,
      notificationFailures: Number(
        (
          await db.all(
            `SELECT COUNT(*) AS n FROM notification_logs n JOIN bookings b ON b.id = n.bookingId WHERE n.status = 'FAILED' AND ${visibility.sql}`,
            visibility.values,
          )
        )[0].n,
      ),
    });
  });
  app.get("/api/admin/payments", staff, async (_req, res) => {
    const visibility = adminBookingVisibility("b");
    res.json(
      await db.all(
        `SELECT p.*,b.reference,b.name,b.method FROM payments p JOIN bookings b ON b.id = p.bookingId WHERE ${visibility.sql} ORDER BY b.createdAt DESC LIMIT 500`,
        visibility.values,
      ),
    );
  });
  app.get(
    "/api/admin/checkins",
    auth(["ADMIN", "CASHIER", "SCANNER"]),
    async (req, res) => {
      const allStaff = ["ADMIN", "CASHIER"].includes(req.identity.role);
      const visibility = adminBookingVisibility("b");
      res.json(
        await db.all(
          "SELECT c.*,b.reference,b.name FROM checkins c JOIN bookings b ON b.id = c.bookingId" +
            ` WHERE ${visibility.sql}` +
            (allStaff ? "" : " AND c.staffId = ?") +
            " ORDER BY c.createdAt DESC LIMIT 100",
          [...visibility.values, ...(allStaff ? [] : [req.identity.userId])],
        ),
      );
    },
  );
  app.get("/api/admin/settings", auth(["ADMIN"]), async (_req, res) =>
    res.json(await availability(db)),
  );
  app.put("/api/admin/settings", auth(["ADMIN"]), async (req, res) => {
    const input = z
      .object({
        capacity: z
          .number()
          .int()
          .min(0)
          .max(1000000)
          .nullable()
          .transform(() => 0),
        day5Capacity: z
          .number()
          .int()
          .positive()
          .nullable()
          .transform(() => null),
        day6Capacity: z
          .number()
          .int()
          .positive()
          .nullable()
          .transform(() => null),
        maxGroup: z.number().int().min(1).max(100),
        holdMinutes: z
          .number()
          .int()
          .min(0)
          .max(1440)
          .nullable()
          .transform(() => 0),
        cashHoldMinutes: z
          .number()
          .int()
          .min(0)
          .max(10080)
          .nullable()
          .transform(() => 0),
        allowKidsOnly: z.number().int().min(0).max(1),
      })
      .parse(req.body);
    await db.transaction(async (tx) => {
      await lockEvent(tx);
      await tx.run(
        `UPDATE events SET ${Object.keys(input)
          .map((k) => `${k} = ?`)
          .join(",")} WHERE id = ?`,
        [...Object.values(input), "santa-2026"],
      );
      await audit(tx, req.identity.userId, "UPDATE_SETTINGS", "santa-2026");
    });
    res.json(await availability(db));
  });
  app.post(
    "/api/scanner/verify",
    auth(["ADMIN", "SCANNER"]),
    async (req, res) => {
      const b = await inspectTicket(
        db,
        z
          .string()
          .regex(/^ss_[a-f0-9]{64}$/)
          .parse(req.body.token),
      );
      res.json({
        id: b.id,
        reference: b.reference,
        name: b.name,
        adults: b.adults,
        kids: b.kids,
        people: b.people,
        eventDate: b.eventDate,
        amount: b.amount,
        method: b.method,
        status: b.status,
        mobile: b.mobile,
        email: b.email,
        paymentStatus: b.status === "PENDING_CASH" ? "DUE" : "PAID",
        demo: paymentDemo,
      });
    },
  );
  app.post(
    "/api/scanner/checkin",
    auth(["ADMIN", "SCANNER"]),
    async (req, res) =>
      res.json(
        await checkin(
          db,
          z
            .string()
            .regex(/^ss_[a-f0-9]{64}$/)
            .parse(req.body.token),
          req.identity.userId,
          requestKey(req),
          req.body.amountReceived === undefined
            ? undefined
            : z.number().int().nonnegative().parse(req.body.amountReceived),
        ),
      ),
  );
  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "API endpoint not found." }),
  );
  app.use((error, req, res, _next) => {
    if (error instanceof z.ZodError)
      return res.status(400).json({
        error: error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
      });
    if (error instanceof AppError)
      return res.status(error.status).json({
        error: error.message,
        ...(error.details ? { details: error.details } : {}),
      });
    if (error instanceof SyntaxError)
      return res.status(400).json({ error: "Invalid request body." });
    const requestId = randomUUID();
    const diagnostic = (value) =>
      typeof value === "string" && /^[A-Za-z0-9_]{1,80}$/.test(value)
        ? value
        : undefined;
    console.error(
      "API request failed:",
      JSON.stringify({
        requestId,
        method: req.method,
        route: req.route?.path || "/api",
        name: diagnostic(error?.name),
        code: diagnostic(error?.code),
        errno: Number.isInteger(error?.errno) ? error.errno : undefined,
        sqlState: diagnostic(error?.sqlState),
      }),
    );
    res.status(500).json({
      error: "The service could not complete your request. Please try again.",
      requestId,
    });
  });
  return app;
}
