"use client";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, MessageCircle } from "lucide-react";
import { api, post } from "@/lib/api";
import { Notice } from "./common";

const MAX_ATTEMPTS = 5;
export function MobileVerification({
  mobile,
  onChange,
  onVerified,
  disabled = false,
  invalidField,
  validationMessage,
}) {
  const [challenge, setChallenge] = useState(null);
  const [otp, setOtp] = useState("");
  const [verifiedUntil, setVerifiedUntil] = useState(0);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now);
  const [failures, setFailures] = useState(0);
  const generation = useRef(0);
  const inFlight = useRef(false);
  const otpInput = useRef(null);
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
    setFailures(0);
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
      setFailures(0);
    } catch (error) {
      if (current === generation.current) setError(error.message);
    } finally {
      if (current === generation.current) setBusy("");
    }
  }

  async function verify(code) {
    if (
      !challenge ||
      code.length !== 6 ||
      busy ||
      disabled ||
      inFlight.current ||
      failures >= MAX_ATTEMPTS
    )
      return;
    if (Date.now() >= challenge.expiresAt) {
      setOtp("");
      setError("OTP expired. Please request a new code.");
      return;
    }
    const current = generation.current;
    inFlight.current = true;
    setBusy("verify");
    setError("");
    try {
      await post("/otp/verify", {
        mobile,
        challengeId: challenge.id,
        otp: code,
      });
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
      if (current === generation.current) {
        setOtp("");
        if (error.status === 400) {
          const used = failures + 1;
          setFailures(used);
          setError(
            Date.now() >= challenge.expiresAt
              ? "OTP expired. Please request a new code."
              : used >= MAX_ATTEMPTS
                ? "Maximum verification attempts reached. Please request a new OTP."
                : "Incorrect OTP. Please try again.",
          );
        } else setError(error.message);
      }
    } finally {
      inFlight.current = false;
      if (current === generation.current) {
        setBusy("");
        otpInput.current?.focus();
      }
    }
  }

  function changeOtp(event) {
    const next = event.target.value.replace(/\D/g, "").slice(0, 6);
    if (busy || inFlight.current) return;
    setOtp(next);
    if (next.length === 6) void verify(next);
  }

  return (
    <div className="mobile-verification" data-registration-field tabIndex={-1}
      role="group" aria-label="WhatsApp verification" aria-invalid={invalidField ? true : undefined}
      aria-describedby={invalidField ? "booking-mobile-error" : undefined}>
      <label htmlFor="booking-mobile">
        WhatsApp mobile number <span>*</span>
      </label>
      <div className="phone-input phone-verification-input">
        <span>+91</span>
        <input
          id="booking-mobile"
          aria-invalid={invalidField === "mobile" ? true : undefined}
          aria-describedby={invalidField === "mobile" ? "booking-mobile-error" : undefined}
          type="tel"
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
            aria-describedby={invalidField === "verification" ? "booking-mobile-error" : undefined}
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
        <MessageCircle size={14} />
        <strong>Verify this number to receive your ticket on WhatsApp.</strong>
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
              aria-describedby={invalidField === "verification" ? "booking-mobile-error" : undefined}
              ref={otpInput}
              value={otp}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              autoFocus
              placeholder="6-digit OTP"
              onChange={changeOtp}
              readOnly={!!busy}
              aria-busy={busy === "verify"}
              disabled={
                disabled || !remaining || failures >= MAX_ATTEMPTS
              }
            />
          </div>
          <p className="field-hint" role="status">
            {busy === "verify" ? (
              <>
                <span className="spinner spinner-sm" aria-hidden="true" />{" "}
                Verifying OTP...
              </>
            ) : (
              <>
                {remaining
                  ? `Code expires in ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`
                  : "Code expired. Request a new code."}{" "}
                · Maximum 5 attempts.
              </>
            )}
          </p>
        </div>
      )}
      {verified && <Notice success>Mobile Number Verified</Notice>}
      {invalidField ? (
        <p className="field-hint error-text" id="booking-mobile-error" role="alert">
          {invalidField === "verification" && error ? error : validationMessage}
        </p>
      ) : error && !verified && <Notice>{error}</Notice>}
    </div>
  );
}
