import { useState } from "react";
import { PieChart } from "lucide-react";

const colors = ["var(--green)", "var(--red)", "#946f39", "#537359", "#6d5261"];
const number = new Intl.NumberFormat("en-IN");
const percent = new Intl.NumberFormat("en-IN", {
  style: "percent",
  maximumFractionDigits: 1,
});
const responseTotal = (count) =>
  `${number.format(count)} ${count === 1 ? "booking" : "bookings"}`;

const point = (fraction) => {
  const angle = fraction * Math.PI * 2;
  return `${100 + 96 * Math.sin(angle)} ${100 - 96 * Math.cos(angle)}`;
};

export function DiscoveryChart({ sources, total }) {
  const [selected, setSelected] = useState(null);
  const [hovered, setHovered] = useState(null);
  const hasResponses = total > 0 && sources.some(({ label }) => label !== "Not specified");
  const active = sources.find(({ label }) => label === (hovered ?? selected));
  const describe = (count) => `${responseTotal(count)} (${percent.format(count / total)})`;
  let cumulative = 0;

  return (
    <section className="admin-card discovery-card" aria-labelledby="discovery-heading">
      <div className="card-heading">
        <h2 id="discovery-heading">How did you hear about us?</h2>
        <PieChart size={20} aria-hidden="true" />
      </div>
      {hasResponses ? (
        <div className="discovery-content">
          <div className="discovery-visual">
            <svg
              className="discovery-pie"
              viewBox="0 0 200 200"
              aria-hidden="true"
              onPointerLeave={() => setHovered(null)}
            >
              {sources.map(({ label, count }, index) => {
                const start = cumulative / total;
                cumulative += count;
                const end = cumulative / total;
                const segment = {
                  fill: colors[index % colors.length],
                  className: active?.label === label ? "active" : undefined,
                  onPointerEnter: (event) => {
                    if (event.pointerType === "mouse") setHovered(label);
                  },
                  onClick: () => setSelected(label),
                };
                return count === total ? (
                  <circle key={label} cx="100" cy="100" r="96" {...segment} />
                ) : (
                  <path
                    key={label}
                    d={`M 100 100 L ${point(start)} A 96 96 0 ${end - start > 0.5 ? 1 : 0} 1 ${point(end)} Z`}
                    {...segment}
                  />
                );
              })}
            </svg>
            <div className="discovery-detail" role="status">
              {active && <><b>{active.label}</b><span>{describe(active.count)}</span></>}
            </div>
          </div>
          <ul className="discovery-legend" aria-label="Discovery response counts and percentages">
            {sources.map(({ label, count }, index) => (
              <li key={label}>
                <button
                  type="button"
                  aria-pressed={selected === label}
                  onClick={() => setSelected(selected === label ? null : label)}
                >
                  <span className="discovery-swatch" style={{ backgroundColor: colors[index % colors.length] }} />
                  <span>{label}<small>{describe(count)}</small></span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p>No customer discovery data available yet.</p>
      )}
      {total > 0 && (
        <p className="discovery-total">
          Total responses <b>{number.format(total)}</b>
          {!hasResponses && (
            <span> · {responseTotal(total)} not specified</span>
          )}
        </p>
      )}
    </section>
  );
}
