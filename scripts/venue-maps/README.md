# Venue maps: how they're built

The app's venue map (`src/app/shared/map-viewer.component.ts`) draws the hotel's real floor
plans with BGG.CON's rooms colored on top, and the exhibit hall's booths with exhibitor logos.
Everything comes from PDFs, converted once and checked in:

| Output | What it is |
|---|---|
| `public/maps/<convention>/floor-*.svg` | One drawing per level (Third, Atrium, Lobby, Exhibition), 10–25 KB each |
| `public/maps/logos/<exhibitor>.webp` + `index.json` | Exhibitor logos by name (~10 KB each); `index.json` lists name → file → booth |
| `src/app/config/venue-maps.ts` | Rooms, booths, landmarks and schedule-room names, generated |

## Sources

- **Hyatt Regency Dallas floor plan** (`Hyatt-Regency-Dallas-Floor-Plan-English.pdf`): page 2 =
  Third + Atrium levels, page 3 = Lobby + Exhibition levels. Vector drawing, so outlines and room
  shapes are exact.
- **BGG.CON hall map** (from the attendee email, e.g. `Exibit hall_ Marsalis_2026.pdf`): booth
  tables, booth numbers, the directory, and exhibitor logos (as images).
- **BGG.CON hotel map** (`BGGCON26 Main Map.pdf`): which room is used for what (Open gaming,
  Scheduled games, Library…). Copied by hand into `build-floors.mjs`.

## Rebuilding (new year or another convention)

Needs Node 20+, `npm i --no-save pdfjs-dist@4.10.38`, and Chrome/Edge for the logo step. Work in a
scratch folder that has `maps-src/` (the PDFs) and run the scripts from there.

1. `node pdf2svg.mjs <hyatt.pdf> 2 floors/hyatt-p2` and `... 3 floors/hyatt-p3`, then
   `node pdf2svg.mjs maps-src/exhibit-hall.pdf 1 floors/hall-con`: each page's vector drawing as
   SVG plus a JSON of its shapes and labels.
2. `node build-floors.mjs`: splits the pages into floors, cuts rooms along the PDF's own dashed
   dividers and assigns each room's use (edit the `add(...)` lines for a new year's map). It also
   drops the not-to-scale Reunion Tower column illustration.
3. Logos: serve the folder (`node static-server.js`), start a headless browser with
   `--remote-debugging-port=9333`, then `node --experimental-websocket cdp-logos.js` (extracts every
   image with its position) and `node hall-booths.mjs` (matches each to the booth it's drawn in).
   `cdp-resize.js` shrinks them to WebP named by exhibitor. **Reuse:** keep last year's `logos/`
   folder; any exhibitor whose name matches already has a logo.
4. Update the booth rectangles and directory in `hall-booths.mjs` for the new hall map.
5. `node build-hall.mjs`: puts the hall's tables and booths into the Hyatt Exhibition level with a
   perspective transform fitted on the hall's four corners (`fit-homography.mjs`; check the four
   corner pairs if the hall layout changed).
6. `node gen-venue-ts.mjs <repo>/src/app/config/venue-maps.ts`, and copy `floors/floor-*.svg`
   (use `floor-exhibition-hall.svg` as `floor-exhibition.svg`) and `logos/` into `public/maps/`.

Schedule room names (`TTE` in `gen-venue-ts.mjs`) must match Tabletop.Events exactly, typos
included ("Ariel Queen", "Pegagus B").
