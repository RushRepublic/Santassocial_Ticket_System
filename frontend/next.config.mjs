const config = {
  devIndicators: false,
  async redirects() {
    return [
      { source: "/register", destination: "/", permanent: true },
      { source: "/verify-otp", destination: "/", permanent: true },
      { source: "/admin/login", destination: "/login", permanent: true },
      { source: "/scanner/login", destination: "/login", permanent: true },
      {
        source: "/admin/payments/:path*",
        destination: "/admin/dashboard",
        permanent: false,
      },
      {
        source: "/admin/settings/:path*",
        destination: "/admin/dashboard",
        permanent: false,
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.API_ORIGIN || "http://127.0.0.1:4000"}/api/:path*`,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
      {
        source: "/admin/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
      {
        source: "/scanner/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
      ...[
        "/ticket/:path*",
        "/checkout",
        "/verify-otp",
        "/booking-success",
        "/booking-pending",
        "/retrieve-ticket",
        "/login",
      ].map((source) => ({
        source,
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      })),
    ];
  },
};
export default config;
