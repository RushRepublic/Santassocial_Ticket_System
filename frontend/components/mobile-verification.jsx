"use client";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, MessageCircle } from "lucide-react";
import { api, post } from "@/lib/api";
import { Notice } from "./common";

export function MobileVerification({
  mobile,
  onChange,
  onVerified,
  disabled = false,
}) {
  const [challenge, setChallenge] = useState(null);
  const [otp, setOtp] = useState("");
  const [verifiedUntil, setVerifiedUntil] = useState(0);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now);
  const generation = useRef(0);
  const validMobile = /^[6-9]\d{9}$/.test(mobile);
  const verified = verifiedUntil > now;
  const remaining = Math.max(
    0,
    Math.ceil(((challenge?.expiresAt || 0) - now) / 1000),
  );
  const resendIn = Math.max(
    0,
    Math.ceil(((challenge?.resendAt || 0) - now) / 1000),
  );

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const current = ++generation.current;
    setChallenge(null);
    setOtp("");
    setVerifiedUntil(0);
    setBusy("");
    setError("");
    onVerified("");
    if (/^[6-9]\d{9}$/.test(mobile)) {
      api("/auth/me?scope=customer")
        .then((identity) => {
          const expiresAt = Number(identity.exp) * 1000;
          if (
            generation.current === current &&
            identity.mobile === mobile &&
            expiresAt > Date.now()
          ) {
            setVerifiedUntil(expiresAt);
            onVerified(mobile);
          }
        })
        .catch(() => {});
    }
    return () => {
      generation.current++;
    };
  }, [mobile, onVerified]);

  useEffect(() => {
    if (verifiedUntil && verifiedUntil <= now) {
      setVerifiedUntil(0);
      onVerified("");
      setError(
        "Your mobile verification session expired. Please verify again.",
      );
    }
  }, [now, verifiedUntil, onVerified]);

  async function send() {
    if (!validMobile || busy || disabled || verified || resendIn) return;
    const current = generation.current;
    setBusy("send");
    setError("");
    try {
      const result = await post("/otp/send", { mobile });
      if (current !== generation.current) return;
      const receivedAt = Date.now();
      setNow(receivedAt);
      setChallenge({
        id: result.challengeId,
        expiresAt: receivedAt + result.expiresIn * 1000,
        resendAt: receivedAt + result.resendIn * 1000,
        demoCode: result.demoCode || "",
      });
      setOtp("");
    } catch (error) {
      if (current === generation.current) setError(error.message);
    } finally {
      if (current === generation.current) setBusy("");
    }
  }

  async function verify() {
    if (!challenge || otp.length !== 6 || busy || disabled) return;
    if (Date.now() >= challenge.expiresAt) {
      setError("Your code expired. Request a new code.");
      return;
    }
    const current = generation.current;
    setBusy("verify");
    setError("");
    try {
      await post("/otp/verify", { mobile, challengeId: challenge.id, otp });
      const identity = await api("/auth/me?scope=customer");
      if (current !== generation.current) return;
      const expiresAt = Number(identity.exp) * 1000;
      if (identity.mobile !== mobile || expiresAt <= Date.now())
        throw new Error("Please verify this mobile number again.");
      setNow(Date.now());
      setVerifiedUntil(expiresAt);
      setChallenge(null);
      setOtp("");
      onVerified(mobile);
    } catch (error) {
      if (current === generation.current) setError(error.message);
    } finally {
      if (current === generation.current) setBusy("");
    }
  }

  return (
    <div className="mobile-verification">
      <label htmlFor="booking-mobile">
        WhatsApp mobile number <span>*</span>
      </label>
      <div className="phone-input phone-verification-input">
        <span>+91</span>
        <input
          id="booking-mobile"
          autoComplete="tel-national"
          inputMode="numeric"
          pattern="[6-9][0-9]{9}"
          required
          maxLength={10}
          value={mobile}
          disabled={!!busy || disabled}
          onChange={(event) => onChange(event.target.value.replace(/\D/g, ""))}
          placeholder="10-digit mobile number"
        />
        {verified ? (
          <span className="mobile-verified" role="status">
            <CheckCircle2 size={17} />
            Verified
          </span>
        ) : (
          <button
            type="button"
            className="mobile-verify-button"
            onClick={send}
            disabled={!validMobile || !!busy || disabled || resendIn > 0}
          >
            {busy === "send"
              ? "Sending…"
              : resendIn
                ? `Resend in ${resendIn}s`
                : challenge
                  ? "Resend OTP"
                  : "Verify"}
          </button>
        )}
      </div>
      <p className="field-hint">
        <MessageCircle size={14} /> Verify this number to receive your ticket on
        WhatsApp.
      </p>
      {challenge && !verified && (
        <div className="inline-otp">
          {challenge.demoCode && (
            <div className="demo-code">
              Development simulation · Your demo code is{" "}
              <b>{challenge.demoCode}</b>
              <br />
              <small>No WhatsApp message was sent.</small>
            </div>
          )}
          <label htmlFor="booking-otp">Enter your 6-digit code</label>
          <div className="inline-otp-controls">
            <input
              id="booking-otp"
              value={otp}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              autoFocus
              placeholder="6-digit OTP"
              onChange={(event) =>
                setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))
              }
              disabled={!!busy || disabled || !remaining}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void verify();
                }
              }}
            />
            <button
              type="button"
              className="button"
              onClick={verify}
              disabled={!!busy || disabled || otp.length !== 6 || !remaining}
            >
              {busy === "verify" ? "Verifying…" : "Verify OTP"}
            </button>
          </div>
          <p className="field-hint" role="status">
            {remaining
              ? `Code expires in ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`
              : "Code expired. Request a new code."}{" "}
            · Maximum 5 attempts.
          </p>
        </div>
      )}
      {error && <Notice>{error}</Notice>}
    </div>
  );
}
