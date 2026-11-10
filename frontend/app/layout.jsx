import "./globals.css";
export const metadata = {
  title: {
    default: "Santa Social 9th Edition | Coimbatore, December 5 & 6",
    template: "%s | Santa Social",
  },
  description:
    "Two days of Christmas cheer at Park Grounds, CODISSIA, Coimbatore. December 5 & 6, 2026, 11 AM–9 PM. Book your Santa Social group tickets.",
  robots: { index: true, follow: true },
};
export default function Layout({ children }) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>{children}</body>
    </html>
  );
}
