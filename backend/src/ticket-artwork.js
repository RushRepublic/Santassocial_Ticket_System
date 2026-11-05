import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { openSync } from "fontkit";
import sharp from "sharp";
import QRCode from "qrcode";
import PDFDocument from "pdfkit";
import { qrToken } from "./security.js";

const logo = readFileSync(
  new URL("../assets/santa-social-9th-edition.png", import.meta.url),
).toString("base64");
const fonts = {
  regular: openSync(
    fileURLToPath(
      new URL(
        "../../frontend/public/brand/roboto-condensed-400.ttf",
        import.meta.url,
      ),
    ),
  ),
  bold: openSync(
    fileURLToPath(
      new URL(
        "../../frontend/public/brand/roboto-condensed-700.ttf",
        import.meta.url,
      ),
    ),
  ),
};
const colors = {
  red: "#8a1d23",
  green: "#15351e",
  ink: "#20251f",
  muted: "#727467",
  line: "#e7e2d7",
};

// Render the actual brand font as vector paths. PNG/PDF exports don't depend on
// fonts installed on the hosting server, external URLs or the recipient's device.
function text(
  value,
  x,
  y,
  size,
  { bold = false, color = colors.ink, align = "center", maxWidth = 740 } = {},
) {
  const font = bold ? fonts.bold : fonts.regular;
  const run = font.layout(String(value));
  const advance = run.positions.reduce((sum, p) => sum + p.xAdvance, 0);
  const scale = Math.min(
    size / font.unitsPerEm,
    maxWidth / Math.max(1, advance),
  );
  let offset =
    align === "right" ? -advance : align === "left" ? 0 : -advance / 2;
  return `<g fill="${color}">${run.glyphs
    .map((glyph, i) => {
      const p = run.positions[i];
      const path = `<path d="${glyph.path.toSVG()}" transform="translate(${x + (offset + p.xOffset) * scale},${y - p.yOffset * scale}) scale(${scale},${-scale})"/>`;
      offset += p.xAdvance;
      return path;
    })
    .join("")}</g>`;
}

export async function renderTicketPng(booking) {
  const pending = booking.status === "PENDING_CASH";
  const date = new Intl.DateTimeFormat("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(new Date(`${booking.eventDate}T12:00:00+05:30`));
  const amount = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(booking.amount / 100);
  const qr = await QRCode.toDataURL(qrToken(booking), {
    width: 780,
    margin: 4,
    errorCorrectionLevel: "M",
    color: { dark: colors.green, light: "#ffffff" },
  });
  const status = pending
    ? `CASH DUE · ${amount} · APPROVAL REQUIRED`
    : booking.checkedInAt
      ? "CHECKED IN · NO RE-ENTRY"
      : `CONFIRMED · ${amount} PAID`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="860" height="1740" viewBox="0 0 860 1740">
    <rect x="1" y="1" width="858" height="1738" rx="22" fill="white" stroke="${colors.line}" stroke-width="2"/>
    <defs><clipPath id="card"><rect width="860" height="1740" rx="22"/></clipPath></defs>
    <g clip-path="url(#card)">
      <rect width="860" height="280" fill="${colors.red}"/>
      <image href="data:image/png;base64,${logo}" x="50" y="48" width="210" height="187"/>
      ${text("GROUP", 760, 130, 25, { color: "#fffaf0", align: "right" })}
      ${text("ADMISSION", 760, 168, 25, { color: "#fffaf0", align: "right" })}
      ${booking.demo ? `<rect y="280" width="860" height="60" fill="#f9e8bf"/>${text("DEMO ONLY · NOT VALID FOR ADMISSION", 430, 319, 22, { color: "#775c22" })}` : ""}
      ${text(booking.reference, 430, 395, 24, { color: colors.red })}
      ${text(booking.name, 430, 477, 64, { bold: true })}
      ${text(date, 430, 541, 30)}
      ${text("11:00 AM – 9:00 PM", 430, 589, 27)}
      ${text("Park Grounds – CODISSIA, Coimbatore", 430, 637, 27)}
      <path d="M300 690V810M560 690V810" stroke="${colors.line}" stroke-width="2"/>
      ${[booking.adults, booking.kids, booking.people].map((count, i) => text(count, 170 + 260 * i, 751, 65, { bold: true, color: colors.green })).join("")}
      ${["ADULTS", "KIDS UNDER 5", "TOTAL GUESTS"].map((label, i) => text(label, 170 + 260 * i, 797, 20, { color: colors.muted, maxWidth: 220 })).join("")}
      ${text(status, 430, 869, 26, { color: pending ? colors.red : colors.green, maxWidth: 780 })}
      <path d="M0 910H860" stroke="${colors.line}" stroke-width="3" stroke-dasharray="12 9"/>
      <image href="${qr}" x="130" y="953" width="600" height="600"/>
      ${text("One QR = One group", 430, 1585, 30, { color: colors.green })}
      ${text("Everyone must arrive together.", 430, 1635, 25, { color: colors.muted })}
      ${text(pending ? "Pay cash at the counter. Approval required before entry." : "Valid only for the selected date. No re-entry.", 430, 1680, 23, { color: pending ? colors.red : colors.muted })}
      ${pending ? text(`Pay before ${new Date(booking.holdUntil).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST`, 430, 1714, 18, { color: colors.muted }) : ""}
    </g>
  </svg>`;
  return sharp(Buffer.from(svg), { density: 144 })
    .resize({ width: 1290 })
    .png()
    .toBuffer();
}

export async function sendTicketDownload(res, booking, format) {
  const png = await renderTicketPng(booking);
  if (format === "png")
    return res
      .type("png")
      .attachment(`${booking.reference}-ticket.png`)
      .send(png);
  res.type("pdf").attachment(`${booking.reference}.pdf`);
  const pdf = new PDFDocument({
    size: [430, 870],
    margin: 0,
    info: { Title: `Santa Social · ${booking.reference}` },
  });
  pdf.pipe(res);
  pdf.image(png, 0, 0, { width: 430, height: 870 });
  pdf.end();
}
