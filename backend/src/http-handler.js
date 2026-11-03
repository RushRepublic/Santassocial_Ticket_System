// Preserve API paths, cookies and raw webhook bodies when routing to Express.
export function createHttpHandler(api, pages) {
  return async (req, res) => {
    try {
      if (/^\/api(?:\/|\?|$)/.test(req.url || "/")) return api(req, res);
      await pages(req, res);
    } catch {
      console.error("Unable to serve application request.");
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("The service could not complete your request.");
      } else res.destroy();
    }
  };
}
