"use client";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import Link from "next/link";
import { Header, DemoBanner } from "./common";
import {
  Register,
  Checkout,
  Confirmation,
  RetrieveTicket,
} from "./registration";
import { GroupTicket } from "./ticket";
import { Admin, StaffLogin } from "./admin";
import { Scanner } from "./scanner";
export function Application() {
  const path = usePathname();
  useEffect(() => {
    if (
      path.startsWith("/admin") ||
      path.startsWith("/scanner") ||
      path.startsWith("/ticket") ||
      path === "/login"
    ) {
      const meta = document.createElement("meta");
      meta.name = "robots";
      meta.content = "noindex, nofollow";
      document.head.appendChild(meta);
      return () => meta.remove();
    }
  }, [path]);
  if (path === "/login" || path === "/admin/login" || path === "/scanner/login")
    return <StaffLogin />;
  if (path.startsWith("/admin")) return <Admin />;
  if (path.startsWith("/scanner"))
    return <Scanner history={path === "/scanner/history"} />;
  let page;
  switch (path) {
    case "/":
    case "/register":
      page = <Register />;
      break;
    case "/checkout":
      page = <Checkout />;
      break;
    case "/booking-pending":
    case "/booking-success":
      page = <Confirmation />;
      break;
    case "/retrieve-ticket":
      page = <RetrieveTicket />;
      break;
    default:
      page = path.startsWith("/ticket/") ? (
        <GroupTicket id={path.split("/")[2]} />
      ) : (
        <div className="empty">
          <h1>This page wandered off.</h1>
          <Link className="button" href="/">
            Back to Santa Social
          </Link>
        </div>
      );
  }
  return (
    <>
      <Header />
      {path !== "/" && path !== "/register" && path !== "/checkout" && (
        <DemoBanner />
      )}
      {page}
    </>
  );
}
