import "./globals.css";
import { metaPixelBootstrap } from "@/components/meta-pixel";
import { EVENT_DATE_LABEL, EVENT_HOURS_LABEL } from "../../config/event-dates.js";
export const metadata = {
  title: {
    default: `Santa Social 9th Edition | Coimbatore, ${EVENT_DATE_LABEL}`,
    template: "%s | Santa Social",
  },
  description:
    `Two days of Christmas cheer at Park Grounds, CODISSIA, Coimbatore. ${EVENT_DATE_LABEL}, ${EVENT_HOURS_LABEL} IST. Book your Santa Social group tickets.`,
  robots: { index: true, follow: true },
};
export default function Layout({ children }) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <head>
        <script
          id="santa-meta-pixel"
          dangerouslySetInnerHTML={{ __html: metaPixelBootstrap }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
