import "./globals.css";
export const metadata = {
  title: {
    default: "Santa Social 9th Edition | Coimbatore, November 13 & 14",
    template: "%s | Santa Social",
  },
  description:
    "Two days of Christmas cheer at Park Grounds, CODISSIA, Coimbatore. November 13 & 14, 2026, 11 AM–9 PM. Book your Santa Social group tickets.",
  robots: { index: true, follow: true },
};
export default function Layout({ children }) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>{children}</body>
    </html>
  );
}
