"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "./api";
import { staffLoginUrl, staffDestination } from "./staff";

// Cookies remain HttpOnly. Only the backend can restore or authorize a session.
export function notifyStaffLogout() {
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel("santa-staff-auth");
  channel.postMessage("logout");
  channel.close();
}
export function useStaffSession(path, roles) {
  const router = useRouter();
  const [identity, setIdentity] = useState(null);
  const roleKey = roles.join(",");
  useEffect(() => {
    let cancelled = false;
    let expiryTimer;
    let checking = false;
    const login = () => {
      setIdentity(null);
      router.replace(`${staffLoginUrl(path)}&expired=1`);
    };
    const check = async () => {
      if (checking || cancelled) return;
      checking = true;
      try {
        const user = await api("/auth/me?scope=staff");
        if (cancelled) return;
        if (!roleKey.split(",").includes(user.role)) {
          router.replace(staffDestination(user.role));
          return;
        }
        setIdentity(user);
        clearTimeout(expiryTimer);
        expiryTimer = setTimeout(check, Math.max(100, user.sessionExpiresIn));
      } catch {
        if (!cancelled) login();
      } finally {
        checking = false;
      }
    };
    const onVisible = () => {
      if (!document.hidden) void check();
    };
    const channel =
      typeof BroadcastChannel !== "undefined"
        ? new BroadcastChannel("santa-staff-auth")
        : null;
    if (channel)
      channel.onmessage = (event) => {
        if (event.data === "logout") login();
      };
    void check();
    const interval = setInterval(check, 30000);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearTimeout(expiryTimer);
      clearInterval(interval);
      channel?.close();
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [path, roleKey, router]);
  return identity;
}
