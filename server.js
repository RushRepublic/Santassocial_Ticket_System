// One Node.js process serves Next.js and Express on the Hostinger app's port.
process.env.NODE_ENV ||= "production";
import("./backend/src/fullstack.js").catch((error) => {
  console.error("Santa Social startup failed:", error.message);
  process.exit(1);
});
