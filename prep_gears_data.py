#!/usr/bin/env python3
"""
Join the CA GEARS portal CSVs into one per-well dataset for the map.
Base = well_locations (has lon/lat); joins POU (purpose/acreage/method) by Well ID,
extractions (metered + ET) by Well ID with per-water-year + monthly AF, owner totals
by Contact ID. Multi-well extraction records split volume equally across listed wells.
Output: data/gears_wells.csv
"""
import csv, os, collections, statistics

DL = os.path.expanduser("~/Downloads")
OUT = os.path.join(os.path.dirname(__file__), "data", "gears_wells.csv")
F = {
 "wells": "gears_gw_well_locations-07132026.csv",
 "pou":   "gears_places_of_gw_use-07132026.csv",
 "ext":   "gears_gw_extractions_at_pous_well-07132026.csv",
 "et":    "gears_gw_extractions_at_pous_et-07132026.csv",
 "owner": "gears_owner_contacts-07132026.csv",
}
def rd(k):
    with open(os.path.join(DL, F[k]), newline="") as fh:
        return list(csv.DictReader(fh))
def num(x):
    try: return float(str(x).replace(",", "").strip())
    except: return 0.0
def ids(s):  # "58687; 58686" -> ["58687","58686"]
    return [p.strip() for p in str(s or "").replace(",", ";").split(";") if p.strip()]

MONTHS = ["July 2024","August 2024","September 2024","October 2024","November 2024","December 2024",
 "January 2025","February 2025","March 2025","April 2025","May 2025","June 2025","July 2025",
 "August 2025","September 2025","October 2025","November 2025","December 2025"]
MCOL = [f"GW Extraction Volume (AF), {m}" for m in MONTHS]
WY_MAP = {"Tule Water Year 2025":"tule_wy2025","Tulare Lake Partial 2025":"tl_partial2025",
 "Tulare Lake Partial 2024":"tl_partial2024","Partial TL WY 2024":"tl_partial2024"}

# ---- accumulate extraction per well (split multi-well records equally) ----
ext_monthly = collections.defaultdict(lambda: [0.0]*18)
ext_wy      = collections.defaultdict(lambda: collections.defaultdict(float))
ext_total   = collections.defaultdict(float)
methods     = collections.defaultdict(set)
def add_ext(rows, is_et):
    # Collapse GEARS re-submissions: multiple rows sharing (Well ID, POU APN, Water Year)
    # are revisions of the same record, not additive. Keep the max per month (a later
    # submission supersedes; disjoint months are preserved since the other row is 0).
    groups = collections.OrderedDict()
    for r in rows:
        key = (str(r.get("Well ID", "")).strip(), str(r.get("POU APN", "")).strip(),
               (r.get("GEARS Water Year") or "").strip())
        vol = [num(r.get(c)) for c in MCOL]
        tech = "ET" if is_et else (r.get("Groundwater Measurement Technique") or "").strip()
        if key not in groups:
            groups[key] = {"wid": r.get("Well ID", ""), "wy": (r.get("GEARS Water Year") or "").strip(),
                           "vol": vol, "tech": set()}
        else:
            gv = groups[key]["vol"]
            for i, v in enumerate(vol): gv[i] = max(gv[i], v)
        if tech: groups[key]["tech"].add(tech)
    for g in groups.values():
        wids = ids(g["wid"]);  n = len(wids) or 1
        vol = g["vol"]
        wytag = WY_MAP.get(g["wy"], "other")
        for w in wids:
            for i, v in enumerate(vol): ext_monthly[w][i] += v/n
            s = sum(vol)/n
            ext_total[w] += s; ext_wy[w][wytag] += s
            for t in g["tech"]: methods[w].add(t)
add_ext(rd("ext"), False)
add_ext(rd("et"),  True)

# ---- POU per well ----
pou_purpose=collections.defaultdict(list); pou_acre=collections.defaultdict(float)
pou_method=collections.defaultdict(list); pou_apns=collections.defaultdict(set)
for r in rd("pou"):
    for w in ids(r["Well ID"]):
        p=(r.get("Primary Purpose of Use") or "").strip()
        if p: pou_purpose[w].append(p)
        pou_acre[w]+=num(r.get("Primary Irrigated Acreage"))
        m=(r.get("Primary Irrigation Method") or "").strip()
        if m: pou_method[w].append(m)
        for a in ids(r.get("Place of Use (POU) APN")): pou_apns[w].add(a)

# ---- owner totals by Contact ID ----
owner={}
for r in rd("owner"):
    owner[(r.get("Contact ID") or "").strip()] = (
        (r.get("Owner Name") or "").strip(),
        num(r.get("Owner Total GW Extraction Volume (AF)")), (r.get("Owner Number of Wells") or "").strip())

def primary(lst):
    return collections.Counter(lst).most_common(1)[0][0] if lst else ""
def method_class(w):
    s=methods[w]
    if "Certified Meter" in s: return "Certified Meter"
    if "ET" in s: return "ET"
    if any("Unmetered" in x or "Estimated" in x for x in s): return "Unmetered/Estimated"
    return "Not reported"
def purpose_class(w):
    p=primary(pou_purpose[w])
    if not p: return "Unknown"
    pl=p.lower()
    if "irrigat" in pl and "agri" in pl: return "Irrigated Agriculture"
    if "household" in pl or "domestic" in pl: return "Household"
    if "livestock" in pl: return "Livestock"
    if "public" in pl: return "Public Supply"
    if "industrial" in pl or "mining" in pl: return "Industrial"
    return "Other"

wells=rd("wells")
cols=["well_id","contact_id","well_name","longitude","latitude","apn","county","subbasin_num",
 "subbasin","status","de_minimis","pws","has_wcr","gw_recordation","max_prod_gpm","year_pumping",
 "total_depth_ft","screen_top_ft","screen_bottom_ft","casing_in",
 "purpose","purpose_all","irr_acreage","irr_method","pou_count","pou_apns",
 "method","ext_total_af","ext_flag","ext_tule_wy2025","ext_tl_partial2025","ext_tl_partial2024",
 "ext_monthly","owner_name","owner_total_af","owner_num_wells"]
IMPLAUSIBLE_AF = 100000  # single-well total above this is a certain reporting error
SUBNAME={"5-022.12":"Tulare Lake","5-022.13":"Tule","5-022.08":"Kings","5-022.11":"Kaweah",
 "5-022.16":"Pleasant Valley","5-022.17":"Westside","5-022.09":"Delta-Mendota","5-022.14":"Kern County"}

n_out=0; seen_wid=set(); n_dup=0; n_flag=0; n_badcoord=0
with open(OUT,"w",newline="") as fh:
    w=csv.DictWriter(fh, fieldnames=cols); w.writeheader()
    for r in wells:
        wid=(r.get("Well ID") or "").strip()
        lon=num(r.get("Longitude")); lat=num(r.get("Latitude"))
        if not wid or not lon or not lat: continue
        if not (-125 <= lon <= -114 and 32 <= lat <= 42):  # skip null-island / invalid coords
            n_badcoord+=1; continue
        if wid in seen_wid: n_dup+=1; continue          # dedupe exact-duplicate well rows
        seen_wid.add(wid)
        flag="implausible" if ext_total[wid] > IMPLAUSIBLE_AF else ""
        if flag: n_flag+=1
        cid=(r.get("Contact ID") or "").strip()
        sn=(r.get("Groundwater Subbasin Name") or "").strip()
        oname,ot,onw = owner.get(cid,("",0.0,""))
        w.writerow({
         "well_id":wid,"contact_id":cid,"well_name":r.get("Well Name",""),
         "longitude":f"{lon:.6f}","latitude":f"{lat:.6f}","apn":r.get("APN of Well",""),
         "county":r.get("County of Well",""),"subbasin_num":sn,"subbasin":SUBNAME.get(sn,sn or "Unknown"),
         "status":r.get("Status","") or "Unknown","de_minimis":r.get("De Minimis?",""),
         "pws":r.get("Contributes to PWS?",""),"has_wcr":r.get("Reporter has Well Completion Report?",""),
         "gw_recordation":r.get("Groundwater Recordation Program?",""),
         "max_prod_gpm":r.get("Maximum Production (gpm)",""),"year_pumping":r.get("Year Pumping Began",""),
         "total_depth_ft":r.get("Total Depth of Well (feet bgs)",""),
         "screen_top_ft":r.get("Depth to Top of Screened Interval (feet bgs)",""),
         "screen_bottom_ft":r.get("Depth to Bottom of Screened Interval (feet bgs)",""),
         "casing_in":r.get("Casing Diameter (in)",""),
         "purpose":purpose_class(wid),"purpose_all":"; ".join(sorted(set(pou_purpose[wid]))),
         "irr_acreage":f"{pou_acre[wid]:.1f}" if pou_acre[wid] else "",
         "irr_method":primary(pou_method[wid]),"pou_count":len(pou_apns[wid]) or "",
         "pou_apns":"; ".join(sorted(pou_apns[wid])[:20]),
         "method":method_class(wid),
         "ext_total_af":f"{ext_total[wid]:.1f}" if ext_total[wid] else "","ext_flag":flag,
         "ext_tule_wy2025":f"{ext_wy[wid]['tule_wy2025']:.1f}" if ext_wy[wid]['tule_wy2025'] else "",
         "ext_tl_partial2025":f"{ext_wy[wid]['tl_partial2025']:.1f}" if ext_wy[wid]['tl_partial2025'] else "",
         "ext_tl_partial2024":f"{ext_wy[wid]['tl_partial2024']:.1f}" if ext_wy[wid]['tl_partial2024'] else "",
         "ext_monthly":"|".join(f"{v:.1f}" for v in ext_monthly[wid]) if ext_total[wid] else "",
         "owner_name":oname,"owner_total_af":f"{ot:.1f}" if ot else "","owner_num_wells":onw,
        })
        n_out+=1

# ---- summary ----
tot=sum(ext_total.values())
n_ext=sum(1 for v in ext_total.values() if v>0)
print(f"wrote {n_out:,} unique wells ({n_dup:,} duplicate rows dropped) -> {OUT}")
print(f"wells with extraction data: {n_ext:,}   total reported extraction: {tot:,.0f} AF")
print(f"flagged implausible (> {IMPLAUSIBLE_AF:,} AF): {n_flag}")
print("MONTHS index (for app.js):", MONTHS)
