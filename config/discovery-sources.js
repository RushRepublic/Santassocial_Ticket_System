export const discoverySources = {
  instagram: "Instagram",
  word_of_mouth: "Friends & Referrals",
  google: "Google",
  previous_visitor: "Already visited Santa's Social",
};

const normalize = (value) =>
  value.trim().toLowerCase().replace(/’/g, "'").replace(/[\s_-]+/g, " ");

const responseLabels = new Map(
  Object.entries(discoverySources).flatMap(([key, label]) => [
    [normalize(key), label],
    [normalize(label), label],
  ]),
);

export function discoveryResponseLabel(value) {
  return typeof value === "string"
    ? responseLabels.get(normalize(value)) ?? "Not specified"
    : "Not specified";
}
