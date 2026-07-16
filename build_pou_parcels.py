#!/usr/bin/env python3
"""
Build a per-parcel Place-of-Use lookup keyed by APN, for the map to feature-state-join
onto the Kings County parcels PMTiles (and, later, Tulare parcels).
Attributes per parcel: attributed GW extraction (each well's total split evenly across
its POU parcels), primary purpose, owner(s), served well count, POU name, acreage share.
Output: data/pou_parcels.json  { "<APN>": {ext,purpose,owner,wells,pou,acreage}, ... }
"""
import csv, os, json, collections

DL = os.path.expanduser("~/Downloads")
HERE = os.path.dirname(__file__)
POU = os.path.join(DL, "gears_places_of_gw_use-07132026.csv")
WELLS = os.path.join(HERE, "data", "gears_wells.csv")
OUT = os.path.join(HERE, "data", "pou_parcels.json")

def ids(s): return [p.strip() for p in str(s or "").replace(",", ";").split(";") if p.strip()]
def num(x):
    try: return float(str(x).replace(",", "").strip())
    except: return 0.0

# well_id -> (extraction, owner, purpose); flagged-implausible wells contribute 0 extraction
well = {}
for r in csv.DictReader(open(WELLS)):
    ext = 0.0 if r.get("ext_flag") else num(r["ext_total_af"])
    well[r["well_id"]] = (ext, r.get("owner_name","").strip(), r.get("purpose",""))

agg = collections.defaultdict(lambda: {"ext":0.0,"purposes":collections.Counter(),
      "owners":set(),"wells":set(),"pou":set(),"acre":0.0})
for r in csv.DictReader(open(POU)):
    apns = ids(r.get("Place of Use (POU) APN"))
    if not apns: continue
    wells = ids(r.get("Well ID"))
    ext_row = sum(well.get(w,(0,"",""))[0] for w in wells)
    purpose = (r.get("Primary Purpose of Use") or "").strip()
    acre = num(r.get("Primary Irrigated Acreage"))
    pou_name = (r.get("Name of POU") or "").strip()
    owners = {well.get(w,(0,"",""))[1] for w in wells if well.get(w,(0,"",""))[1]}
    n = len(apns)
    for apn in apns:
        a = agg[apn]
        a["ext"] += ext_row / n
        if purpose: a["purposes"][purpose] += 1
        a["owners"] |= owners
        a["wells"] |= set(wells)
        if pou_name: a["pou"].add(pou_name)
        a["acre"] += acre / n

def purpose_class(p):
    pl = p.lower()
    if "irrigat" in pl and "agri" in pl: return "Irrigated Agriculture"
    if "household" in pl or "domestic" in pl: return "Household"
    if "livestock" in pl: return "Livestock"
    if "public" in pl: return "Public Supply"
    if "industrial" in pl or "mining" in pl: return "Industrial"
    return "Other" if p else "Unknown"

out = {}
for apn, a in agg.items():
    prim = a["purposes"].most_common(1)[0][0] if a["purposes"] else ""
    out[apn] = {
        "ext": round(a["ext"], 1),
        "purpose": purpose_class(prim),
        "owner": "; ".join(sorted(a["owners"]))[:120],
        "wells": len(a["wells"]),
        "pou": "; ".join(sorted(a["pou"]))[:120],
        "acre": round(a["acre"], 1),
    }
json.dump(out, open(OUT, "w"), separators=(",", ":"))
print(f"wrote {len(out):,} POU parcels -> {OUT}  ({os.path.getsize(OUT)//1024} KB)")
tot = sum(v["ext"] for v in out.values())
print(f"attributed extraction across parcels: {tot:,.0f} AF (sanity: ~matches well total ex-flag)")
print("sample:", dict(list(out.items())[:2]))
