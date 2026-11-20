import "./globals.css";
import { EVENT_DATE_DAYS } from "../../config/event-dates.js";
export const metadata = {
  title: {
    default: `Santa Social 9th Edition | Coimbatore, November ${EVENT_DATE_DAYS}`,
    template: "%s | Santa Social",
  },
  description:
    `Two days of Christmas cheer at Park Grounds, CODISSIA, Coimbatore. November ${EVENT_DATE_DAYS}, 2026, 11 AM–9 PM. Book your Santa Social group tickets.`,
  robots: { index: true, follow: true },
};
export default function Layout({ children }) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>{children}</body>
    </html>
  );
}
