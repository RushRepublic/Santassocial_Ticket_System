import {
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
  createHash,
  createHmac,
} from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { config } from "./config.js";
export const hash = (value) => createHash("sha256").update(value).digest("hex");
export const hmac = (value, secret) =>
  createHmac("sha256", secret).update(value).digest("hex");
export function equal(a, b) {
  return (
    /^[a-f\d]{64}$/i.test(a) &&
    /^[a-f\d]{64}$/i.test(b) &&
    timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"))
  );
}
export function passwordHash(password) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
export function passwordMatches(password, stored) {
  const [salt, key] = stored.split(":");
  if (!salt || !key) return false;
  const a = scryptSync(password, salt, 64);
  const b = Buffer.from(key, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
export const signSession = (identity, staff = false) =>
  new SignJWT(identity)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("santa-social")
    .setAudience("santa-social-web")
    .setIssuedAt()
    .setJti(randomUUID())
    .setExpirationTime(staff ? "24h" : "30m")
    .sign(new TextEncoder().encode(config.sessionSecret));
export async function readSession(token) {
  return (
    await jwtVerify(token, new TextEncoder().encode(config.sessionSecret), {
      issuer: "santa-social",
      audience: "santa-social-web",
      algorithms: ["HS256"],
    })
  ).payload;
}
export function qrToken(booking) {
  return `ss_${hmac(`${booking.id}:${booking.ticketNonce}`, config.ticketSecret)}`;
}
