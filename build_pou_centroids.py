#!/usr/bin/env python3
"""
Build data/pou_centroids.json = {APN: [lon, lat]} for every POU parcel, so the map can
"fit to POU" when a well is selected (frame the well + its reported parcels).
 - Tulare (9-digit): centroid computed from data/tulare_pou_parcels.geojson (already local).
 - Kings (12-digit): centroid pulled from the county Parcel_view FeatureServer (POST batches).
"""
import json, os, urllib.request, urllib.parse

HERE = os.path.dirname(__file__)
POU = json.load(open(os.path.join(HERE, "data", "pou_parcels.json")))
OUT = os.path.join(HERE, "data", "pou_centroids.json")
KINGS = "https://services3.arcgis.com/24gLq1DBBzDfd0cZ/arcgis/rest/services/Parcel_view/FeatureServer/143/query"

def ring_centroid(ring):
    xs = [p[0] for p in ring]; ys = [p[1] for p in ring]
    return [round(sum(xs) / len(xs), 6), round(sum(ys) / len(ys), 6)]

def geom_centroid(g):
    if g["type"] == "Polygon":
        return ring_centroid(g["coordinates"][0])
    if g["type"] == "MultiPolygon":  # largest part's outer ring
        best, ba = None, -1
        for poly in g["coordinates"]:
            r = poly[0]
            a = abs(sum(r[i][0] * r[i-1][1] - r[i-1][0] * r[i][1] for i in range(len(r))) / 2)
            if a > ba: ba, best = a, r
        return ring_centroid(best)
    return None

cent = {}

# ── Tulare from local geojson ──────────────────────────────────────────
tg = json.load(open(os.path.join(HERE, "data", "tulare_pou_parcels.geojson")))
for f in tg["features"]:
    apn = str(f["properties"].get("APN", "")).strip()
    c = geom_centroid(f["geometry"]) if f.get("geometry") else None
    if apn and c: cent[apn] = c
print(f"Tulare centroids from geojson: {len(cent)}")

# ── Kings from county Parcel_view service ──────────────────────────────
kings = sorted(a for a in POU if len(a) == 12)
print(f"Kings POU APNs to pull: {len(kings)}")

def post(where):
    data = urllib.parse.urlencode({"where": where, "outFields": "APN",
        "returnGeometry": "true", "outSR": "4326", "f": "geojson"}).encode()
    req = urllib.request.Request(KINGS, data=data, headers={"Content-Type": "application/x-www-form-urlencoded"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except Exception as e:
            if attempt == 2:
                print("  batch failed:", str(e)[:70]); return {"features": []}

kn = 0
for i in range(0, len(kings), 100):
    b = kings[i:i+100]
    gj = post("APN IN (" + ",".join("'%s'" % a for a in b) + ")")
    for f in gj.get("features", []):
        apn = str(f["properties"].get("APN", "")).strip()
        c = geom_centroid(f["geometry"]) if f.get("geometry") else None
        if apn in POU and c: cent[apn] = c; kn += 1
    print(f"  {i+len(b)}/{len(kings)} queried, {kn} Kings matched", end="\r")

json.dump(cent, open(OUT, "w"), separators=(",", ":"))
print(f"\nwrote {len(cent):,} POU centroids -> {OUT}  ({os.path.getsize(OUT)//1024} KB)")
print(f"  Kings matched: {kn}/{len(kings)} ({100*kn/len(kings):.0f}%)")
