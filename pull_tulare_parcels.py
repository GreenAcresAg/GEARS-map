#!/usr/bin/env python3
"""
Pull geometry for the Tulare County POU parcels from the county's public
"Current Parcels" FeatureServer, and write a GeoJSON with the GEARS POU attributes
(attributed extraction color) baked in. Tulare POU APNs are the 9-digit ones.
Output: data/tulare_pou_parcels.geojson
"""
import json, os, urllib.request, urllib.parse, time

HERE = os.path.dirname(__file__)
POU = json.load(open(os.path.join(HERE, "data", "pou_parcels.json")))
OUT = os.path.join(HERE, "data", "tulare_pou_parcels.geojson")
BASE = "https://services2.arcgis.com/bYBANhmQGwSSLC0l/arcgis/rest/services/Parcels_(Public_View)/FeatureServer/0/query"

# extraction color bins (must match app.js COLOR_MODES.extraction)
def color_for(v):
    if not v or v <= 0: return "#475569"
    if v < 50:  return "#22c55e"
    if v < 200: return "#84cc16"
    if v < 500: return "#eab308"
    if v < 1500:return "#f97316"
    return "#dc2626"

# Tulare candidates = 9-digit POU APNs
apns = [a for a in POU if len(a) == 9]
print(f"Tulare candidate POU APNs: {len(apns)}")

def query(batch):
    where = "APN IN (" + ",".join("'%s'" % a for a in batch) + ")"
    data = urllib.parse.urlencode({
        "where": where, "outFields": "APN", "returnGeometry": "true",
        "outSR": "4326", "f": "geojson"}).encode()
    req = urllib.request.Request(BASE, data=data,  # POST — no URL length limit
        headers={"Content-Type": "application/x-www-form-urlencoded"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except Exception as e:
            if attempt == 2: print("  batch failed:", str(e)[:80]); return {"features": []}
            time.sleep(1.5)

def rnd(coords):  # round coords to 6 decimals to trim size
    if isinstance(coords[0], (int, float)):
        return [round(coords[0], 6), round(coords[1], 6)]
    return [rnd(c) for c in coords]

feats = []; seen = set()
B = 120
for i in range(0, len(apns), B):
    batch = apns[i:i+B]
    gj = query(batch)
    for f in gj.get("features", []):
        apn = str(f["properties"].get("APN", "")).strip()
        if not apn or apn in seen or apn not in POU: continue
        seen.add(apn)
        d = POU[apn]
        g = f.get("geometry")
        if not g: continue
        g["coordinates"] = rnd(g["coordinates"])
        feats.append({"type": "Feature", "geometry": g,
                      "properties": {"APN": apn, "ext": d["ext"], "color": color_for(d["ext"])}})
    print(f"  {i+len(batch)}/{len(apns)} queried, {len(feats)} matched", end="\r")

out = {"type": "FeatureCollection", "features": feats}
json.dump(out, open(OUT, "w"), separators=(",", ":"))
print(f"\nwrote {len(feats):,} Tulare POU parcels -> {OUT}  ({os.path.getsize(OUT)//1024} KB)")
print(f"match rate: {len(feats)}/{len(apns)} ({100*len(feats)/len(apns):.0f}%)")
