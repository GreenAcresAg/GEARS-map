# GEARS Groundwater Extraction Map

Interactive web map of California **GEARS** (Groundwater Extraction Accounting &
Reporting System) data for the **Tulare Lake (5-022.12)** and **Tule (5-022.13)**
subbasins. Built by Green Acres Consulting, Inc., adapting the SFKGSA Well Completion
Report map (MapLibre GL JS, static site).

## What it shows
- **5,968 GEARS wells** (deduplicated) plotted from reported coordinates.
- **"Color Wells By" view switcher** — one well layer, four symbologies:
  - **Extraction Volume (AF)** — graduated size + color by reported groundwater extraction.
  - **Purpose of Use** — Irrigated Ag / Household / Livestock / Public Supply / Industrial / Other.
  - **Status** — Active / Inactive / Destroyed / Observation.
  - **Measurement Method** — Certified Meter / ET / Unmetered-Estimated / Not reported.
- **Filters:** subbasin, county, status, purpose, method, de minimis, extraction-volume
  range, year pumping began, total depth, "only wells with extraction data".
- **Density heatmap** (optionally weighted by extraction volume).
- **Click a well** → detail panel: attributes, place-of-use (purpose/acreage/irrigation
  method), extraction by water year, an 18-month extraction sparkline, and owner totals
  (personal info redacted in source).
- **Context layers** (reused from the SFKGSA map): Kings County parcels & crops,
  Corcoran clay thickness/depth, subbasin GSA boundaries.

## Data
`data/gears_wells.csv` is built by `prep_gears_data.py`, which joins the five CA GEARS
portal CSVs (portal export 2026-07-13):
- `well_locations` (coordinates + well attributes) — base table
- `places_of_gw_use` — purpose, irrigated acreage, irrigation method (join by Well ID)
- `extractions_at_pous_well` + `_et` — monthly extraction AF (join by Well ID; multi-well
  records split evenly)
- `owner_contacts` — owner totals (join by Contact ID)

**Data cleaning applied:** deduplicated 482 exact-duplicate well rows; dropped 14 wells
with null-island (0,0) coordinates; flagged 1 well (ID 57876) whose reported 2,476,000 AF
is a certain reporting error (excluded from the headline extraction sum, shown with a
warning in its detail panel). Total reported extraction, excluding the flagged well:
**~736,000 AF** across 3,090 wells — cross-checked against the independent owner-reported
total.

## Run locally
```bash
python3 server.py        # serves on :8000 with HTTP Range support (needed for PMTiles)
open http://localhost:8000
```

## Rebuild the data
```bash
python3 prep_gears_data.py   # reads ~/Downloads/gears_*-07132026.csv -> data/gears_wells.csv
```

## Stack
MapLibre GL JS 4.1.2 · PMTiles 3.0.6 · PapaParse 5.4.1 (CDN). Basemaps: Esri World
Imagery, USGS Topo, OpenStreetMap.

## Disclaimer
For informational purposes only. Well locations and extraction volumes are self-reported
to GEARS and subject to ongoing verification. All source data is publicly available;
owner personal information is redacted in the source.
