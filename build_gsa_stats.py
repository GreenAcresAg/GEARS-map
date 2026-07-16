#!/usr/bin/env python3
"""
Point-in-polygon assign each GEARS well to a GSA (from surrounding_gsas.geojson),
then aggregate per-GSA stats for the click panel. Pure Python (no shapely).
Output: data/gsa_stats.json keyed by GSA_Name.
"""
import csv, json, os
from collections import defaultdict

HERE = os.path.dirname(__file__)
GSAS = json.load(open(os.path.join(HERE, "data", "surrounding_gsas.geojson")))
WELLS = list(csv.DictReader(open(os.path.join(HERE, "data", "gears_wells.csv"))))
OUT = os.path.join(HERE, "data", "gsa_stats.json")

def num(v):
    try: return float(v)
    except (TypeError, ValueError): return 0.0

# ── point-in-ring (ray casting) ────────────────────────────────────────
def in_ring(x, y, ring):
    inside = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi) + xi):
            inside = not inside
        j = i
    return inside

def in_polygon(x, y, rings):
    # rings[0] = outer, rings[1:] = holes
    if not in_ring(x, y, rings[0]):
        return False
    for hole in rings[1:]:
        if in_ring(x, y, hole):
            return False
    return True

def in_feature(x, y, geom):
    t = geom["type"]
    if t == "Polygon":
        return in_polygon(x, y, geom["coordinates"])
    if t == "MultiPolygon":
        return any(in_polygon(x, y, poly) for poly in geom["coordinates"])
    return False

# bbox prefilter for speed
def bbox(geom):
    xs, ys = [], []
    def walk(c):
        if isinstance(c[0], (int, float)): xs.append(c[0]); ys.append(c[1])
        else:
            for cc in c: walk(cc)
    walk(geom["coordinates"])
    return min(xs), min(ys), max(xs), max(ys)

gsas = []
for f in GSAS["features"]:
    p = f["properties"]
    gsas.append({"name": p["GSA_Name"], "subbasin": p.get("subbasin", ""),
                 "num": p.get("Basin_Subbasin_Number", ""), "geom": f["geometry"], "bbox": bbox(f["geometry"])})

# ── aggregate ──────────────────────────────────────────────────────────
def blank():
    return {"wells": 0, "ext": 0.0, "flagged_wells": 0, "de_minimis": 0,
            "contacts": set(),
            "by_purpose": defaultdict(lambda: {"wells": 0, "ext": 0.0}),
            "by_status": defaultdict(int),
            "by_method": defaultdict(int)}

agg = {g["name"]: blank() for g in gsas}
unassigned = 0

for w in WELLS:
    try:
        x, y = float(w["longitude"]), float(w["latitude"])
    except (ValueError, KeyError):
        continue
    hit = None
    for g in gsas:
        mnx, mny, mxx, mxy = g["bbox"]
        if x < mnx or x > mxx or y < mny or y > mxy:
            continue
        if in_feature(x, y, g["geom"]):
            hit = g["name"]; break
    if hit is None:
        unassigned += 1
        continue
    a = agg[hit]
    a["wells"] += 1
    flagged = bool(w.get("ext_flag"))
    ext = num(w.get("ext_total_af"))
    if flagged:
        a["flagged_wells"] += 1
    else:
        a["ext"] += ext
    if w.get("contact_id"): a["contacts"].add(w["contact_id"])
    if str(w.get("de_minimis")).upper() == "TRUE": a["de_minimis"] += 1
    purpose = w.get("purpose") or "Unknown"
    a["by_purpose"][purpose]["wells"] += 1
    a["by_purpose"][purpose]["ext"] += 0.0 if flagged else ext
    a["by_status"][w.get("status") or "Unknown"] += 1
    a["by_method"][w.get("method") or "Not reported"] += 1

out = {}
for g in gsas:
    a = agg[g["name"]]
    out[g["name"]] = {
        "subbasin": g["subbasin"], "num": g["num"],
        "wells": a["wells"], "ext": round(a["ext"], 1),
        "flagged_wells": a["flagged_wells"], "de_minimis": a["de_minimis"],
        "accounts": len(a["contacts"]),
        "by_purpose": {k: {"wells": v["wells"], "ext": round(v["ext"], 1)} for k, v in sorted(a["by_purpose"].items(), key=lambda kv: -kv[1]["wells"])},
        "by_status": dict(sorted(a["by_status"].items(), key=lambda kv: -kv[1])),
        "by_method": dict(sorted(a["by_method"].items(), key=lambda kv: -kv[1])),
    }

json.dump(out, open(OUT, "w"), separators=(",", ":"))
total_wells = sum(v["wells"] for v in out.values())
print(f"wrote {len(out)} GSAs -> {OUT}")
print(f"assigned {total_wells}/{len(WELLS)} wells; {unassigned} unassigned (outside all GSA polygons)")
print("top GSAs by wells:")
for name, v in sorted(out.items(), key=lambda kv: -kv[1]["wells"])[:8]:
    print(f"  {name:<42} wells={v['wells']:>4}  ext={v['ext']:>12,.0f} AF  accounts={v['accounts']:>4}")
