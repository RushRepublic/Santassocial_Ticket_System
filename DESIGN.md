# Santa Social reference design

## Approved 9th Edition logo update

The owner supplied the exact current artwork as root `santa.png`. The app uses byte-identical copies at `frontend/public/brand/santa-social-9th-edition.png`, `backend/assets/santa-social-9th-edition.png` and `frontend/app/icon.png`. This replaces the earlier text fallback in public/customer, admin, scanner and ticket screens and in browser/server PDF exports. Preserve the artwork's full aspect ratio and existing background; do not reconstruct the logo from text or use the legacy 8th Edition mark. Booking form styling remains intact; only logo rendering and its responsive sizing are updated.

Current customer entry: `/` serves the existing Book Tickets form directly; `/register` redirects to it. The promotional homepage implementation has been removed. The form's CSS, typography, images, spacing and responsive layout are unchanged. The reference-homepage analysis below records original design provenance, not the current customer navigation.

Source: https://santassocial.com/ · captured November 2, 2026, using Firecrawl branding, HTML, markdown, images and a full-page desktop screenshot. Original HTML and downloaded page CSS are in `docs/reference.html`, `docs/reference-home.css`, and `docs/reference-page.css`. The inspected reference capture is `docs/reference-desktop.png`.

## Observed tokens

| Role                      | Value                        | Evidence                                                                           |
| ------------------------- | ---------------------------- | ---------------------------------------------------------------------------------- |
| Primary site background   | `#8A1D23`                    | Page CSS `post-1359.css` and inspected screenshot                                  |
| Cream sections            | `#FFFAF0`                    | Page CSS and inspected screenshot                                                  |
| Forest green cards/footer | `#15351E`                    | Page CSS; experience card artwork                                                  |
| Brand/logo red            | `#A2032D`                    | Firecrawl brand extraction and supplied logo                                       |
| Primary light text        | `#FFFFFF`                    | Page CSS                                                                           |
| Display and body type     | Roboto Condensed, sans-serif | Computed branding extraction, theme CSS, inspected screenshot                      |
| Desktop section headings  | About 34px / bold            | Branding font size and screenshot                                                  |
| Intro paragraph           | About 20px                   | Branding extraction and screenshot                                                 |
| Boxed content maximum     | 1300px                       | Elementor kit `post-3049.css`                                                      |
| Component corner radius   | Around 5–8px; hero larger    | Captured components and screenshot; exact per-component spacing not fully measured |

The automatic branding extractor suggested `#EF3F56` as an accent, but it is not the dominant section color. Implementation follows the actual page CSS/screenshot. A malformed Geometos font URL occurs in the HTML; observed headings and body use Roboto Condensed. Geometos is not substituted into the implementation.

## Observed page sequence

1. Red page surround, rounded full-width media hero, logo at top left and countdown at top right.
2. Centered red introduction with white heading, descriptive paragraph, date/location row, and white directions button.
3. Cream experience section: five rectangular image/artwork cards in a three-plus-two arrangement.
4. Horizontally scrolling gallery with rounded images.
5. Cream section with three feature artwork cards.
6. Red short-video content area, followed by a map.
7. Red brand/organiser/social footer with a green copyright strip.

The scrape text contained sponsors, but these were not visible in the inspected rendered screenshot; no current sponsorship claims have been invented. Gallery carousel state changes the initially visible images. A desktop capture does not establish exact source mobile breakpoints, transitions, or hover states.

## Downloaded assets

Assets remain local so the page does not depend on third-party hotlinks for fonts or gallery images.

| Local file                                  | Original source / use                                                                     |
| ------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `frontend/public/brand/shopping.webp`       | `/wp-content/uploads/2025/11/1-5-1.webp` · shopping card                                  |
| `fun.webp`                                  | `/wp-content/uploads/2025/11/2-5-1.webp` · activities card                                |
| `food.webp`                                 | `/wp-content/uploads/2025/11/3-3-1.webp` · food card                                      |
| `music.webp`                                | `/wp-content/uploads/2025/11/3-2-1.webp` · music card                                     |
| `workshops.webp`                            | `/wp-content/uploads/2025/11/4-3-1.webp` · workshops card                                 |
| `space.webp`, `brands.webp`, `moments.webp` | `/wp-content/uploads/2025/11/Frame-26-2.webp`, `2-6-1.webp`, `3-4-1.webp` · feature cards |
| `gallery-*.webp`                            | `/wp-content/uploads/2025/11/Frame-*.webp` · actual event photography                     |
| `roboto-condensed-400/500/600/700.ttf`      | Google Fonts Roboto Condensed v31 · local font faces                                      |
| `docs/reference-logo.png`                   | `/wp-content/uploads/2022/11/SS-logo-1.png` · legacy reference only                       |

Full URLs use `https://santassocial.com` for relative original sources above. Re-download helper: `node scripts/assets.mjs` (network access required).

## Implementation and fidelity

The homepage preserves the reference palette, font family, image cards, red/cream section rhythm, gallery, rounded media, and footer. Registration, tickets, dashboard and scanner extend those tokens with readable forms and clear state colors. Base grid spacing and mobile breakpoints are implementation choices, not measured source CSS.

The earlier promotional implementation was **not a pixel-identical clone**: it used an event photograph and temporary text masthead rather than the old site's video/8th Edition logo. That promotional page and its video callout are now removed from the customer journey. `/` serves the original booking form, and the owner-supplied 9th Edition artwork replaces the temporary wordmark. The brief’s 2026 event hours are 11 AM–10 PM IST. The legacy logo and homepage capture in `docs/` are historical references only.

Verified implementation screenshots: `docs/home-desktop.png`, `docs/home-mobile.png`, `docs/register-mobile.png`, `docs/ticket-desktop.png`, `docs/admin-desktop.png`, `docs/admin-mobile.png`. They are visual evidence of this implementation, not proof of pixel equivalence. External Google Maps loading depends on browser/network access.
