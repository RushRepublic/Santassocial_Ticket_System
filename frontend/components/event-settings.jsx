import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { Loading, Notice } from "./common";

const endpoint = "/admin/event-settings";

export function EventSettings() {
  const [enabled, setEnabled] = useState(null);
  const [saving, setSaving] = useState(false);
  const [retry, setRetry] = useState(0);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saved, setSaved] = useState(false);
  const savingRef = useRef(false);

  useEffect(() => {
    if (saving) return;
    let stopped = false;
    let reading = false;
    async function load() {
      if (reading || savingRef.current) return;
      reading = true;
      try {
        const setting = await api(endpoint, { cache: "no-store" });
        if (!stopped && !savingRef.current) {
          setEnabled(setting.publicCashPaymentEnabled);
          setLoadError("");
        }
      } catch (error) {
        if (!stopped && !savingRef.current) setLoadError(error.message);
      } finally {
        reading = false;
      }
    }
    void load();
    const timer = setInterval(load, 15000);
    window.addEventListener("focus", load);
    return () => {
      stopped = true;
      clearInterval(timer);
      window.removeEventListener("focus", load);
    };
  }, [retry, saving]);

  async function toggle() {
    if (enabled === null || savingRef.current || loadError) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError("");
    setSaved(false);
    try {
      const setting = await api(endpoint, {
        method: "PUT",
        body: JSON.stringify({ publicCashPaymentEnabled: !enabled }),
      });
      setEnabled(setting.publicCashPaymentEnabled);
      setSaved(true);
    } catch (error) {
      setSaveError(error.message);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <>
      <div className="admin-page-heading"><h1>Event Settings</h1></div>
      <section className="admin-card event-settings" aria-labelledby="payment-settings-title">
        <h2 id="payment-settings-title">Payment Settings</h2>
        <div className="cash-setting-row">
          <div className="cash-setting-copy">
            <h3>Cash Payment</h3>
            <p id="cash-payment-help">
              Enable or disable the Cash Payment option on the public checkout page.
            </p>
            {enabled !== null && (
              <p id="cash-payment-status">
                {enabled ? "ON — Cash Payment Enabled" : "OFF — Cash Payment Disabled"}
              </p>
            )}
          </div>
          {enabled !== null && (
            <button
              type="button"
              role="switch"
              className="cash-payment-switch"
              aria-label="Cash Payment"
              aria-checked={enabled}
              aria-describedby="cash-payment-help cash-payment-status"
              disabled={saving || Boolean(loadError)}
              onClick={toggle}
            >
              <span className="cash-payment-track" aria-hidden="true" />
            </button>
          )}
        </div>
        {enabled === null && !loadError && <Loading />}
        {loadError && (
          <>
            <Notice>{loadError}</Notice>
            <button className="button outline" type="button" onClick={() => setRetry((count) => count + 1)}>
              Retry
            </button>
          </>
        )}
        {saveError && <Notice>{saveError}</Notice>}
        <div className="cash-setting-feedback" role="status">
          {saving ? "Saving payment settings…" : saved ? "Payment settings saved." : ""}
        </div>
      </section>
    </>
  );
}
