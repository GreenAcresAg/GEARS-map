/* ══════════════════════════════════════════════════════════════════
   GEARS Groundwater Extraction Map — Green Acres Consulting, Inc.
   Adapted from the SFKGSA Well Completion Report map (MapLibre GL).
   ══════════════════════════════════════════════════════════════════ */

const MONTHS = ["Jul '24","Aug '24","Sep '24","Oct '24","Nov '24","Dec '24",
 "Jan '25","Feb '25","Mar '25","Apr '25","May '25","Jun '25",
 "Jul '25","Aug '25","Sep '25","Oct '25","Nov '25","Dec '25"];

/* ── Symbology modes ─────────────────────────────────────────────── */
function classifyExtraction(v) {
    if (!v || v <= 0) return "No data";
    if (v < 50)   return "< 50";
    if (v < 200)  return "50 – 200";
    if (v < 500)  return "200 – 500";
    if (v < 1500) return "500 – 1,500";
    return "1,500 +";
}
const COLOR_MODES = {
    extraction: {
        label: "Extraction Volume (AF)",
        graduated: true,
        cat: w => classifyExtraction(w.extTotal),
        cats: [["< 50","#22c55e"],["50 – 200","#84cc16"],["200 – 500","#eab308"],
               ["500 – 1,500","#f97316"],["1,500 +","#dc2626"],["No data","#475569"]],
    },
    purpose: {
        label: "Purpose of Use",
        cat: w => w.purpose || "Unknown",
        cats: [["Irrigated Agriculture","#22c55e"],["Household","#3b82f6"],["Livestock","#eab308"],
               ["Public Supply","#a855f7"],["Industrial","#ef4444"],["Other","#6b7280"],["Unknown","#94a3b8"]],
    },
    status: {
        label: "Status",
        cat: w => w.status || "Unknown",
        cats: [["Active","#22c55e"],["Inactive","#9ca3af"],["Destroyed","#ef4444"],
               ["Observation","#3b82f6"],["Unknown","#6b7280"]],
    },
    method: {
        label: "Measurement Method",
        cat: w => w.method || "Not reported",
        cats: [["Certified Meter","#22c55e"],["ET","#3b82f6"],
               ["Unmetered/Estimated","#f59e0b"],["Not reported","#6b7280"]],
    },
};
let colorMode = "purpose";
function colorFor(w) {
    const m = COLOR_MODES[colorMode];
    const key = m.cat(w);
    const hit = m.cats.find(c => c[0] === key);
    return hit ? hit[1] : "#6b7280";
}

/* ── State ───────────────────────────────────────────────────────── */
let map, allWells = [], filteredWells = [];
let activeCats = new Set(COLOR_MODES[colorMode].cats.map(c => c[0]));

/* ── PMTiles ─────────────────────────────────────────────────────── */
const pmtilesProtocol = new pmtiles.Protocol();
maplibregl.addProtocol("pmtiles", pmtilesProtocol.tile);

/* ── Map init ────────────────────────────────────────────────────── */
map = new maplibregl.Map({
    container: "map",
    style: {
        version: 8,
        sources: {
            satellite: { type: "raster", tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"], tileSize: 256, attribution: "Esri, Maxar, Earthstar Geographics", maxzoom: 19 },
            labels: { type: "raster", tiles: ["https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"], tileSize: 256, maxzoom: 19 },
            roads: { type: "raster", tiles: ["https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}"], tileSize: 256, maxzoom: 19 },
        },
        glyphs: "vendor/fonts/{fontstack}/{range}.pbf",
        layers: [
            { id: "satellite", type: "raster", source: "satellite" },
            { id: "roads", type: "raster", source: "roads", paint: { "raster-opacity": 0.8 } },
            { id: "labels", type: "raster", source: "labels", paint: { "raster-opacity": 0.7 } },
        ],
    },
    center: [-119.5, 36.0],
    zoom: 8.5,
    maxZoom: 18,
});
map.addControl(new maplibregl.NavigationControl(), "top-right");

map.on("load", () => {
    loadCrops();
    loadParcels();
    loadGSAs();
    loadCorcoranClay();
    loadCorcoranDepth();
    loadWells();
});

/* ── Wells ───────────────────────────────────────────────────────── */
function num(x){ const n = parseFloat(x); return isNaN(n) ? null : n; }
function loadWells() {
    Papa.parse("data/gears_wells.csv", {
        download: true, header: true, skipEmptyLines: true,
        complete: (res) => processWells(res.data),
    });
}
function processWells(rows) {
    allWells = rows.filter(r => r.longitude && r.latitude && !isNaN(+r.latitude)).map(r => ({
        ...r,
        lng: +r.longitude, lat: +r.latitude,
        extTotal: num(r.ext_total_af) || 0,
        depth: num(r.total_depth_ft),
        year: num(r.year_pumping),
        monthly: r.ext_monthly ? r.ext_monthly.split("|").map(Number) : null,
    }));
    populateFilters();
    buildLegendAndToggles();
    applyFilters();
    fitToData();
}
function fitToData() {
    const b = new maplibregl.LngLatBounds();
    allWells.forEach(w => b.extend([w.lng, w.lat]));
    if (!b.isEmpty()) map.fitBounds(b, { padding: 60, maxZoom: 11, duration: 0 });
}

/* ── Filter dropdowns ────────────────────────────────────────────── */
function uniq(field){ return [...new Set(allWells.map(w => w[field]).filter(Boolean))].sort(); }
function fillSelect(id, values){
    const sel = document.getElementById(id);
    values.forEach(v => { const o = document.createElement("option"); o.value = v; o.textContent = v; sel.appendChild(o); });
}
function populateFilters() {
    fillSelect("filter-subbasin", uniq("subbasin"));
    fillSelect("filter-county",   uniq("county"));
    fillSelect("filter-status",   uniq("status"));
    fillSelect("filter-purpose",  uniq("purpose"));
    fillSelect("filter-method",   uniq("method"));
}

/* ── Legend + category toggles (rebuilt on mode change) ──────────── */
function buildLegendAndToggles() {
    const m = COLOR_MODES[colorMode];
    activeCats = new Set(m.cats.map(c => c[0]));

    const legend = document.getElementById("legend");
    legend.innerHTML = m.graduated
        ? `<div class="legend-note">Circle size &amp; color scale with reported extraction volume.</div>` : "";

    const box = document.getElementById("category-toggles");
    box.innerHTML = m.cats.map(([key, color]) => `
        <label class="layer-toggle sub-toggle">
            <input type="checkbox" data-cat="${key}" checked>
            <span class="toggle-swatch" style="background:${color}"></span>
            ${key}
            <span class="count" data-count="${key}"></span>
        </label>`).join("");

    box.querySelectorAll("[data-cat]").forEach(cb => cb.addEventListener("change", () => {
        if (cb.checked) activeCats.add(cb.dataset.cat); else activeCats.delete(cb.dataset.cat);
        applyFilters();
    }));
}

/* ── Filtering ───────────────────────────────────────────────────── */
function fval(id){ return document.getElementById(id).value; }
function applyFilters() {
    const owner = fval("filter-owner").trim().toLowerCase();
    const sub = fval("filter-subbasin"), cty = fval("filter-county"), st = fval("filter-status"),
          pur = fval("filter-purpose"), meth = fval("filter-method"), dm = fval("filter-deminimis"),
          eMin = num(fval("filter-ext-min")), eMax = num(fval("filter-ext-max")),
          yMin = num(fval("filter-year-min")), yMax = num(fval("filter-year-max")),
          dMin = num(fval("filter-depth-min")), dMax = num(fval("filter-depth-max")),
          hasExt = document.getElementById("filter-hasext").checked;
    const m = COLOR_MODES[colorMode];

    filteredWells = allWells.filter(w => {
        if (!activeCats.has(m.cat(w))) return false;
        if (owner && !(w.owner_name || "").toLowerCase().includes(owner)) return false;
        if (sub && w.subbasin !== sub) return false;
        if (cty && w.county !== cty) return false;
        if (st && w.status !== st) return false;
        if (pur && w.purpose !== pur) return false;
        if (meth && w.method !== meth) return false;
        if (dm && (w.de_minimis || "").toUpperCase() !== dm) return false;
        if (hasExt && w.extTotal <= 0) return false;
        if (eMin != null && w.extTotal < eMin) return false;
        if (eMax != null && w.extTotal > eMax) return false;
        if (yMin != null && (w.year == null || w.year < yMin)) return false;
        if (yMax != null && (w.year == null || w.year > yMax)) return false;
        if (dMin != null && (w.depth == null || w.depth < dMin)) return false;
        if (dMax != null && (w.depth == null || w.depth > dMax)) return false;
        return true;
    });
    const gj = wellsToGeoJSON(filteredWells);
    updateMap(gj);
    updateCounts();
    renderFilterStats();
    closeDetailPanel();
}
function wellsToGeoJSON(wells) {
    return { type: "FeatureCollection", features: wells.map(w => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [w.lng, w.lat] },
        properties: { well_id: w.well_id, color: colorFor(w), ext: w.extTotal },
    })) };
}
function updateCounts() {
    const m = COLOR_MODES[colorMode], counts = {};
    m.cats.forEach(c => counts[c[0]] = 0);
    let extSum = 0;
    filteredWells.forEach(w => { const k = m.cat(w); if (k in counts) counts[k]++; if (!w.ext_flag) extSum += w.extTotal; });
    document.querySelectorAll("[data-count]").forEach(el => {
        el.textContent = (counts[el.dataset.count] || 0).toLocaleString();
    });
    document.getElementById("well-count").textContent = filteredWells.length.toLocaleString();
    document.getElementById("ext-sum").textContent = Math.round(extSum).toLocaleString();
}

/* ── Filtered-selection summary (same stats shape as the GSA panel) ── */
function computeStats(wells) {
    const s = { wells: wells.length, ext: 0, flagged_wells: 0, de_minimis: 0,
        contacts: new Set(), by_purpose: {}, by_status: {}, by_method: {} };
    wells.forEach(w => {
        const flagged = !!w.ext_flag;
        if (flagged) s.flagged_wells++; else s.ext += w.extTotal;
        if (w.contact_id) s.contacts.add(w.contact_id);
        if ((w.de_minimis || "").toUpperCase() === "TRUE") s.de_minimis++;
        const p = w.purpose || "Unknown";
        (s.by_purpose[p] = s.by_purpose[p] || { wells: 0, ext: 0 }).wells++;
        s.by_purpose[p].ext += flagged ? 0 : w.extTotal;
        const st = w.status || "Unknown"; s.by_status[st] = (s.by_status[st] || 0) + 1;
        const mt = w.method || "Not reported"; s.by_method[mt] = (s.by_method[mt] || 0) + 1;
    });
    const byVal = (o, key) => Object.fromEntries(Object.entries(o).sort((a, b) => (key ? b[1][key] : b[1]) - (key ? a[1][key] : a[1])));
    return { wells: s.wells, ext: s.ext, flagged_wells: s.flagged_wells, de_minimis: s.de_minimis,
        accounts: s.contacts.size, by_purpose: byVal(s.by_purpose, "wells"),
        by_status: byVal(s.by_status, null), by_method: byVal(s.by_method, null) };
}
function describeFilters() {
    const chips = [], add = (label, v) => { if (v) chips.push(`${label}: ${v}`); };
    add("Subbasin", fval("filter-subbasin")); add("County", fval("filter-county"));
    add("Status", fval("filter-status")); add("Purpose", fval("filter-purpose")); add("Method", fval("filter-method"));
    const dm = fval("filter-deminimis"); if (dm) chips.push(dm === "TRUE" ? "De minimis only" : "Non-de-minimis only");
    const owner = fval("filter-owner").trim(); if (owner) chips.push(`Contact ~ "${owner}"`);
    const eMin = fval("filter-ext-min"), eMax = fval("filter-ext-max"); if (eMin || eMax) chips.push(`Ext ${eMin || "0"}–${eMax || "∞"} AF`);
    const yMin = fval("filter-year-min"), yMax = fval("filter-year-max"); if (yMin || yMax) chips.push(`Year ${yMin || "…"}–${yMax || "…"}`);
    const dMin = fval("filter-depth-min"), dMax = fval("filter-depth-max"); if (dMin || dMax) chips.push(`Depth ${dMin || "0"}–${dMax || "∞"} ft`);
    if (document.getElementById("filter-hasext").checked) chips.push("Has extraction data");
    const allCats = COLOR_MODES[colorMode].cats.map(c => c[0]);
    if (activeCats.size < allCats.length) chips.push(`${COLOR_MODES[colorMode].label}: ${[...activeCats].join(", ")}`);
    return chips;
}
function renderFilterStats() {
    const panel = document.getElementById("filter-stats-panel");
    if (!panel || panel.classList.contains("hidden")) return;
    const s = computeStats(filteredWells), chips = describeFilters();
    document.getElementById("filter-stats-title").textContent =
        `Selection — ${s.wells.toLocaleString()} of ${allWells.length.toLocaleString()} wells`;
    const flagNote = s.flagged_wells ? `<div class="detail-note">Excludes ${s.flagged_wells} well${s.flagged_wells === 1 ? "" : "s"} flagged as a likely reporting error.</div>` : "";
    const chipHtml = chips.length
        ? `<div class="filter-chips">${chips.map(c => `<span class="filter-chip">${c}</span>`).join("")}</div>`
        : `<div class="detail-note">No filters applied — showing all wells.</div>`;
    document.getElementById("filter-stats-list").innerHTML = `
        <div class="detail-well">
            ${chipHtml}
            ${row("Wells", `<strong>${s.wells.toLocaleString()}</strong>`)}
            ${row("Total reported extraction", `<strong>${Math.round(s.ext).toLocaleString()} AF</strong>`)}
            ${row("Reporting accounts", s.accounts.toLocaleString())}
            ${row("De minimis wells", s.de_minimis.toLocaleString())}
            ${flagNote}
            <div class="detail-divider">Wells &amp; extraction by purpose</div>
            ${breakdownRows(s.by_purpose, "purpose", true)}
            <div class="detail-divider">Wells by status</div>
            ${breakdownRows(s.by_status, "status", false)}
            <div class="detail-divider">Wells by measurement method</div>
            ${breakdownRows(s.by_method, "method", false)}
            <div class="detail-note">Live totals for the current left-panel filter selection. Extraction is self-reported to GEARS (Jul 2024 – Dec 2025).</div>
        </div>`;
}
document.getElementById("filter-stats-btn").addEventListener("click", () => {
    const panel = document.getElementById("filter-stats-panel"), btn = document.getElementById("filter-stats-btn");
    const open = panel.classList.toggle("hidden") === false;
    btn.classList.toggle("active", open);
    if (open) renderFilterStats();
});
document.getElementById("filter-stats-close").addEventListener("click", () => {
    document.getElementById("filter-stats-panel").classList.add("hidden");
    document.getElementById("filter-stats-btn").classList.remove("active");
});

/* ── Map layers (heatmap + points) ───────────────────────────────── */
const RADIUS_FIXED = ["interpolate",["linear"],["zoom"],8,2.5,12,4,16,7];
const RADIUS_EXT = ["interpolate",["linear"],["zoom"],
    8, ["interpolate",["linear"],["sqrt",["max",["get","ext"],0]], 0,2, 10,6, 40,14],
    14,["interpolate",["linear"],["sqrt",["max",["get","ext"],0]], 0,3, 10,10, 40,26]];

function updateMap(gj) {
    if (map.getSource("wells")) {
        map.getSource("wells").setData(gj);
        map.getSource("wells-heat-src").setData(gj);
        map.setPaintProperty("wells-points", "circle-radius",
            colorMode === "extraction" ? RADIUS_EXT : RADIUS_FIXED);
        return;
    }
    map.addSource("wells", { type: "geojson", data: gj });
    map.addSource("wells-heat-src", { type: "geojson", data: gj });

    map.addLayer({
        id: "wells-heat", type: "heatmap", source: "wells-heat-src", maxzoom: 14,
        paint: {
            "heatmap-weight": ["interpolate",["linear"],["coalesce",["get","ext"],0], 0,0.15, 100,0.5, 1000,1],
            "heatmap-intensity": ["interpolate",["linear"],["zoom"],7,0.4,13,1.4],
            "heatmap-radius": ["interpolate",["linear"],["zoom"],7,10,13,22,15,30],
            "heatmap-color": ["interpolate",["linear"],["heatmap-density"],
                0,"rgba(0,0,0,0)",0.1,"rgba(0,255,128,0.3)",0.3,"rgba(0,255,0,0.5)",
                0.5,"rgba(128,255,0,0.6)",0.7,"rgba(255,255,0,0.7)",0.9,"rgba(255,128,0,0.8)",1,"rgba(255,0,0,0.9)"],
            "heatmap-opacity": ["interpolate",["linear"],["zoom"],10,0.8,14,0.35],
        },
    });
    map.addLayer({
        id: "wells-points", type: "circle", source: "wells",
        paint: {
            "circle-radius": colorMode === "extraction" ? RADIUS_EXT : RADIUS_FIXED,
            "circle-color": ["get","color"],
            "circle-stroke-width": 1,
            "circle-stroke-color": "rgba(255,255,255,0.55)",
            "circle-opacity": 0.9,
        },
    });
    wirePointInteractions();
}

/* ── Heatmap weight toggle ───────────────────────────────────────── */
document.getElementById("heat-weight-ext").addEventListener("change", (e) => {
    if (!map.getLayer("wells-heat")) return;
    map.setPaintProperty("wells-heat", "heatmap-weight", e.target.checked
        ? ["interpolate",["linear"],["coalesce",["get","ext"],0], 0,0.05, 100,0.5, 1000,1]
        : 1);
});

/* ── Popup + detail ──────────────────────────────────────────────── */
const popup = document.getElementById("popup");
function wellById(id){ return filteredWells.find(w => w.well_id === id); }

function wirePointInteractions() {
    map.on("mousemove", "wells-points", (e) => {
        map.getCanvas().style.cursor = "pointer";
        const w = wellById(e.features[0].properties.well_id); if (!w) return;
        const ext = w.extTotal ? `${w.extTotal.toLocaleString()} AF` : "—";
        popup.innerHTML =
            `<div class="popup-title">${w.well_name || "Well " + w.well_id}</div>
             ${w.owner_name ? `<div class="popup-row"><span class="popup-label">Reporting contact</span><span class="popup-value">${w.owner_name}</span></div>` : ""}
             <div class="popup-row"><span class="popup-label">Purpose</span><span class="popup-value">${w.purpose}</span></div>
             <div class="popup-row"><span class="popup-label">Status</span><span class="popup-value">${w.status}</span></div>
             <div class="popup-row"><span class="popup-label">Extraction</span><span class="popup-value">${ext}</span></div>
             <div class="popup-hint">Click for full details</div>`;
        popup.classList.remove("hidden");
        popup.style.left = (e.originalEvent.clientX + 12) + "px";
        popup.style.top  = (e.originalEvent.clientY - 12) + "px";
    });
    map.on("mouseleave", "wells-points", () => { map.getCanvas().style.cursor = ""; popup.classList.add("hidden"); });
    map.on("click", "wells-points", (e) => {
        const w = wellById(e.features[0].properties.well_id); if (w) showDetail(w);
    });
}
function row(label, val){ return (val === "" || val == null) ? "" :
    `<div class="detail-row"><span class="detail-label">${label}</span><span class="detail-value">${val}</span></div>`; }
function boolStr(v){ const s = (v||"").toUpperCase(); return s === "TRUE" ? "Yes" : s === "FALSE" ? "No" : "—"; }

function sparkline(monthly) {
    if (!monthly || !monthly.some(v => v > 0)) return "";
    const max = Math.max(...monthly), W = 232, H = 40, bw = W / monthly.length;
    const bars = monthly.map((v, i) => {
        const h = max ? (v / max) * (H - 2) : 0;
        return `<rect x="${(i*bw).toFixed(1)}" y="${(H-h).toFixed(1)}" width="${(bw-1).toFixed(1)}" height="${h.toFixed(1)}" fill="#38bdf8"></rect>`;
    }).join("");
    return `<div class="detail-spark">
        <div class="detail-label">Monthly extraction (AF), Jul 2024 – Dec 2025</div>
        <svg width="${W}" height="${H}" class="spark-svg">${bars}</svg>
        <div class="spark-axis"><span>${MONTHS[0]}</span><span>${MONTHS[MONTHS.length-1]}</span></div>
    </div>`;
}
function showDetail(w) {
    const panel = document.getElementById("detail-panel");
    document.getElementById("detail-count").textContent = w.well_name || ("Well " + w.well_id);
    const wy = [
        w.ext_tule_wy2025 ? `Tule WY2025: ${(+w.ext_tule_wy2025).toLocaleString()} AF` : "",
        w.ext_tl_partial2025 ? `TL Partial 2025: ${(+w.ext_tl_partial2025).toLocaleString()} AF` : "",
        w.ext_tl_partial2024 ? `TL Partial 2024: ${(+w.ext_tl_partial2024).toLocaleString()} AF` : "",
    ].filter(Boolean).join(" · ");

    document.getElementById("detail-list").innerHTML = `
        <div class="detail-well">
            <div class="detail-well-header"><span class="detail-dot" style="background:${colorFor(w)}"></span>
                <strong>Well ID ${w.well_id}</strong></div>
            ${row("Status", w.status)}
            ${row("Subbasin", w.subbasin + (w.subbasin_num ? ` (${w.subbasin_num})` : ""))}
            ${row("County", w.county)}
            ${row("APN", w.apn)}
            ${row("De minimis", boolStr(w.de_minimis))}
            ${row("Contributes to PWS", boolStr(w.pws))}
            ${row("Has Well Completion Report", boolStr(w.has_wcr))}
            ${row("Max production (gpm)", w.max_prod_gpm)}
            ${row("Year pumping began", w.year_pumping)}
            ${row("Total depth (ft)", w.total_depth_ft)}
            ${row("Screened interval (ft)", w.screen_top_ft && w.screen_bottom_ft ? `${w.screen_top_ft} – ${w.screen_bottom_ft}` : "")}
            <div class="detail-divider">Place of Use</div>
            ${row("Purpose(s)", w.purpose_all || w.purpose)}
            ${row("Irrigated acreage", w.irr_acreage)}
            ${row("Irrigation method", w.irr_method)}
            ${row("Parcels (POU)", w.pou_count)}
            <div class="detail-divider">Groundwater Extraction</div>
            ${row("Measurement method", w.method)}
            ${row("Total reported", w.extTotal ? `<strong>${w.extTotal.toLocaleString()} AF</strong>${w.ext_flag ? ` <span class="flag-warn">⚠ likely reporting error</span>` : ""}` : "No extraction reported")}
            ${wy ? row("By water year", wy) : ""}
            ${sparkline(w.monthly)}
            ${w.owner_name ? `<div class="detail-divider">Reporting contact</div>${row("Reporting contact", w.owner_name)}${row("Contact total extraction", (w.owner_total_af ? (+w.owner_total_af).toLocaleString() : "0") + " AF")}${row("Contact # wells", w.owner_num_wells)}<div class="detail-note">Name of the GEARS account that registered this well — the self-supplied reporting contact, which may be a manager or agent rather than the legal landowner. Address &amp; contact info are redacted in the source data.</div>` : `<div class="detail-divider">Reporting contact</div><div class="detail-note">No contact record listed for this well.</div>`}
        </div>`;
    panel.classList.remove("hidden");
    highlightWellPOU(w);
}
function closeDetailPanel(){ document.getElementById("detail-panel").classList.add("hidden"); clearWellPOU(); }
document.getElementById("detail-close").addEventListener("click", closeDetailPanel);
map.on("click", (e) => {
    if (!map.queryRenderedFeatures(e.point, { layers: ["wells-points"] }).length) closeDetailPanel();
});

/* ── Places-of-Use parcel hover popup (Kings pmtiles + Tulare geojson) ── */
function pouPopup(e) {
    if (!e.features.length) return;
    const apn = e.features[0].properties.APN, d = pouData[apn];
    if (!d) return;
    map.getCanvas().style.cursor = "pointer";
    popup.innerHTML =
        `<div class="popup-title">Parcel ${apn}</div>
         ${d.pou ? `<div class="popup-row"><span class="popup-label">POU</span><span class="popup-value">${d.pou}</span></div>` : ""}
         <div class="popup-row"><span class="popup-label">Purpose</span><span class="popup-value">${d.purpose}</span></div>
         <div class="popup-row"><span class="popup-label">Attributed extraction</span><span class="popup-value">${d.ext.toLocaleString()} AF</span></div>
         ${d.owner ? `<div class="popup-row"><span class="popup-label">Reporting contact</span><span class="popup-value">${d.owner}</span></div>` : ""}
         <div class="popup-row"><span class="popup-label">Wells serving</span><span class="popup-value">${d.wells}</span></div>`;
    popup.classList.remove("hidden");
    popup.style.left = (e.originalEvent.clientX + 12) + "px";
    popup.style.top  = (e.originalEvent.clientY - 12) + "px";
}
["pou-fill", "pou-tulare-fill"].forEach(l => {
    map.on("mousemove", l, pouPopup);
    map.on("mouseleave", l, () => { map.getCanvas().style.cursor = ""; popup.classList.add("hidden"); });
});

/* ── Color-mode switch ───────────────────────────────────────────── */
document.getElementById("color-mode").addEventListener("change", (e) => {
    colorMode = e.target.value;
    buildLegendAndToggles();
    applyFilters();
});

/* ── Filter wiring ───────────────────────────────────────────────── */
["filter-subbasin","filter-county","filter-status","filter-purpose","filter-method","filter-deminimis"]
    .forEach(id => document.getElementById(id).addEventListener("change", applyFilters));
["filter-owner","filter-ext-min","filter-ext-max","filter-year-min","filter-year-max","filter-depth-min","filter-depth-max"]
    .forEach(id => document.getElementById(id).addEventListener("input", debounce(applyFilters, 300)));
document.getElementById("filter-hasext").addEventListener("change", applyFilters);
document.getElementById("clear-filters").addEventListener("click", () => {
    document.querySelectorAll(".filter-control").forEach(el => { if (el.tagName === "SELECT") el.selectedIndex = 0; else el.value = ""; });
    document.getElementById("filter-hasext").checked = false;
    buildLegendAndToggles();
    applyFilters();
});

/* ── Context layers (reused from SFKGSA map) ─────────────────────── */
function loadCrops() {
    map.addSource("crops", { type: "vector", url: "pmtiles://data/kings_crops_2024.pmtiles" });
    map.addLayer({ id: "crops-fill", type: "fill", source: "crops", "source-layer": "crops",
        layout: { visibility: "none" }, minzoom: 10, paint: { "fill-color": "#16a34a", "fill-opacity": 0.35 } });
    map.addLayer({ id: "crops", type: "line", source: "crops", "source-layer": "crops",
        layout: { visibility: "none" }, minzoom: 12, paint: { "line-color": "#1e293b", "line-width": 0.5, "line-opacity": 0.5 } });
}
function loadParcels() {
    // promoteId APN so we can feature-state-join GEARS Place-of-Use data onto parcels
    map.addSource("parcels", { type: "vector", url: "pmtiles://data/kings_parcels.pmtiles",
        promoteId: { parcels: "APN" } });
    map.addLayer({ id: "parcels-fill", type: "fill", source: "parcels", "source-layer": "parcels",
        layout: { visibility: "none" }, minzoom: 12, paint: { "fill-color": "transparent" } });
    map.addLayer({ id: "parcels", type: "line", source: "parcels", "source-layer": "parcels",
        layout: { visibility: "none" }, minzoom: 12,
        paint: { "line-color": "#f97316", "line-width": ["interpolate",["linear"],["zoom"],12,0.5,15,1.5], "line-opacity": 0.7 } });

    // ── Places of Use (parcels served by GEARS wells) — feature-state join ──
    map.addLayer({ id: "pou-fill", type: "fill", source: "parcels", "source-layer": "parcels",
        layout: { visibility: "none" }, minzoom: 9,
        paint: {
            "fill-color": ["coalesce", ["feature-state", "color"], "rgba(0,0,0,0)"],
            "fill-opacity": ["case", ["boolean", ["feature-state", "pou"], false], 0.6, 0],
        } });
    map.addLayer({ id: "pou-outline", type: "line", source: "parcels", "source-layer": "parcels",
        layout: { visibility: "none" }, minzoom: 11,
        paint: {
            "line-color": "#0f172a",
            "line-width": ["case", ["boolean", ["feature-state", "pou"], false], 0.6, 0],
            "line-opacity": 0.6,
        } });
    loadPOU();

    // ── Tulare County POU parcels (GeoJSON pulled from county service; color baked in) ──
    map.addSource("pou-tulare", { type: "geojson", data: "data/tulare_pou_parcels.geojson" });
    map.addLayer({ id: "pou-tulare-fill", type: "fill", source: "pou-tulare",
        layout: { visibility: "none" }, minzoom: 9,
        paint: { "fill-color": ["get", "color"], "fill-opacity": 0.6 } });
    map.addLayer({ id: "pou-tulare-outline", type: "line", source: "pou-tulare",
        layout: { visibility: "none" }, minzoom: 11,
        paint: { "line-color": "#0f172a", "line-width": 0.6, "line-opacity": 0.6 } });

    // ── Selected-well POU highlight (always on; renders only the selected well's parcels) ──
    // Kings parcels driven by feature-state "hl"; Tulare (geojson) driven by setFilter.
    const HL_NONE = ["==", ["get", "APN"], "__none__"];
    map.addLayer({ id: "pou-hl-kings-fill", type: "fill", source: "parcels", "source-layer": "parcels", minzoom: 8,
        paint: { "fill-color": "#22d3ee", "fill-opacity": ["case", ["boolean", ["feature-state", "hl"], false], 0.3, 0] } });
    map.addLayer({ id: "pou-hl-kings-line", type: "line", source: "parcels", "source-layer": "parcels", minzoom: 8,
        paint: { "line-color": "#06b6d4", "line-width": ["case", ["boolean", ["feature-state", "hl"], false], 2.6, 0], "line-opacity": 0.95 } });
    map.addLayer({ id: "pou-hl-tulare-fill", type: "fill", source: "pou-tulare", filter: HL_NONE, minzoom: 8,
        paint: { "fill-color": "#22d3ee", "fill-opacity": 0.3 } });
    map.addLayer({ id: "pou-hl-tulare-line", type: "line", source: "pou-tulare", filter: HL_NONE, minzoom: 8,
        paint: { "line-color": "#06b6d4", "line-width": 2.6, "line-opacity": 0.95 } });
}

/* ── Selected-well Place-of-Use highlight ────────────────────────── */
let hlKings = [];
let pouCentroids = {};
fetch("data/pou_centroids.json").then(r => r.json()).then(d => pouCentroids = d).catch(() => {});
function reapplyHighlight() {
    hlKings.forEach(apn => map.setFeatureState({ source: "parcels", sourceLayer: "parcels", id: apn }, { hl: true }));
}
function clearWellPOU() {
    hlKings.forEach(apn => map.setFeatureState({ source: "parcels", sourceLayer: "parcels", id: apn }, { hl: false }));
    hlKings = [];
    const none = ["==", ["get", "APN"], "__none__"];
    if (map.getLayer("pou-hl-tulare-fill")) map.setFilter("pou-hl-tulare-fill", none);
    if (map.getLayer("pou-hl-tulare-line")) map.setFilter("pou-hl-tulare-line", none);
}
function highlightWellPOU(w) {
    clearWellPOU();
    const apns = (w.pou_apns || "").split(";").map(s => s.trim()).filter(Boolean);
    hlKings = apns.filter(a => a.length === 12);           // Kings parcels (pmtiles feature-state)
    const tulare = apns.filter(a => a.length === 9);        // Tulare parcels (geojson filter)
    reapplyHighlight();
    const filt = tulare.length ? ["in", ["get", "APN"], ["literal", tulare]] : ["==", ["get", "APN"], "__none__"];
    if (map.getLayer("pou-hl-tulare-fill")) map.setFilter("pou-hl-tulare-fill", filt);
    if (map.getLayer("pou-hl-tulare-line")) map.setFilter("pou-hl-tulare-line", filt);
    fitToPOU(w, [...hlKings, ...tulare]);
}
// Frame the well together with its POU parcels (uses precomputed parcel centroids)
function fitToPOU(w, apns) {
    const lon = num(w.longitude), lat = num(w.latitude);
    const pts = [];
    if (lon != null && lat != null) pts.push([lon, lat]);
    apns.forEach(a => { if (pouCentroids[a]) pts.push(pouCentroids[a]); });
    if (pts.length > 1) {
        const lons = pts.map(p => p[0]), lats = pts.map(p => p[1]);
        map.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
            { padding: { top: 70, bottom: 70, left: 70, right: 390 }, maxZoom: 14, duration: 800 });
    } else if (lon != null && lat != null && map.getZoom() < 10.5) {
        // no parcel geometry available; still nudge in so the well's tiles/highlight load
        map.easeTo({ center: [lon, lat], zoom: 12, duration: 700 });
    }
}

// POU per-parcel attributes, keyed by APN → set as feature-state on the parcels source
let pouData = {};
function colorForExt(v) {
    const bins = COLOR_MODES.extraction.cats; // [["< 50","#.."],...,["No data",..]]
    const key = classifyExtraction(v);
    const hit = bins.find(b => b[0] === key);
    return hit ? hit[1] : "#64748b";
}
function loadPOU() {
    fetch("data/pou_parcels.json").then(r => r.json()).then(data => {
        pouData = data;
        const apply = () => {
            for (const apn in data) {
                map.setFeatureState({ source: "parcels", sourceLayer: "parcels", id: apn },
                    { pou: true, color: colorForExt(data[apn].ext) });
            }
        };
        apply();
        // re-apply when new parcel tiles load (feature-state must be re-set as tiles arrive)
        map.on("sourcedata", (e) => { if (e.sourceId === "parcels" && e.isSourceLoaded) { apply(); reapplyHighlight(); } });
    }).catch(err => console.error("POU load error:", err));
}
const SUBBASIN_COLORS = { "Kings":"#06b6d4","Tulare Lake":"#8b5cf6","Kaweah":"#ec4899","Tule":"#14b8a6","Westside":"#f43f5e","Pleasant Valley":"#eab308" };
let gsaStats = {};
function loadGSAs() {
    Promise.all([
        fetch("data/surrounding_gsas.geojson").then(r => r.json()),
        fetch("data/gsa_stats.json").then(r => r.json()).catch(() => ({})),
    ]).then(([data, stats]) => {
        gsaStats = stats;
        // short label for on-map text (drop the long "…Sustainability Agency" tail)
        data.features.forEach(f => {
            const n = f.properties.GSA_Name || "";
            f.properties.label = n.replace(/Groundwater Sustainability Agency/i, "GSA").replace(/\s+GSA JPA$/i, " GSA");
        });
        map.addSource("gsas", { type: "geojson", data });
        map.addLayer({ id: "gsas-fill", type: "fill", source: "gsas", layout: { visibility: "visible" },
            paint: { "fill-color": ["match",["get","subbasin"],...Object.entries(SUBBASIN_COLORS).flat(),"#94a3b8"], "fill-opacity": 0.05 } });
        map.addLayer({ id: "gsas-line", type: "line", source: "gsas", layout: { visibility: "visible" },
            paint: { "line-color": ["match",["get","subbasin"],...Object.entries(SUBBASIN_COLORS).flat(),"#94a3b8"], "line-width": 1.8, "line-opacity": 0.85 } });

        // one label point per GSA name (centroid of its largest polygon part) to avoid
        // MultiPolygon parts each drawing their own repeated label
        const ringArea = r => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] * r[i][1] - r[i][0] * r[j][1]); return Math.abs(a / 2); };
        const centroid = r => { let x = 0, y = 0; for (const p of r) { x += p[0]; y += p[1]; } return [x / r.length, y / r.length]; };
        const best = {};
        data.features.forEach(f => {
            const polys = f.geometry.type === "MultiPolygon" ? f.geometry.coordinates : [f.geometry.coordinates];
            for (const poly of polys) {
                const a = ringArea(poly[0]);
                const key = f.properties.GSA_Name;
                if (!best[key] || a > best[key].area) best[key] = { area: a, center: centroid(poly[0]), props: f.properties };
            }
        });
        const labelPts = { type: "FeatureCollection", features: Object.values(best).map(b =>
            ({ type: "Feature", geometry: { type: "Point", coordinates: b.center }, properties: b.props })) };
        map.addSource("gsas-label-pts", { type: "geojson", data: labelPts });
        map.addLayer({ id: "gsas-labels", type: "symbol", source: "gsas-label-pts",
            layout: { visibility: "visible", "text-field": ["get","label"],
                "text-size": ["interpolate",["linear"],["zoom"],7,10,11,15],
                "text-max-width": 8, "text-allow-overlap": false, "text-padding": 4,
                "symbol-placement": "point", "text-font": ["Noto Sans Bold"] },
            paint: { "text-color": "#f8fafc", "text-halo-color": "#0f172a", "text-halo-width": 1.6, "text-halo-blur": 0.4 } });

        map.on("mouseenter", "gsas-fill", () => { map.getCanvas().style.cursor = "pointer"; });
        map.on("mouseleave", "gsas-fill", () => { map.getCanvas().style.cursor = ""; });
        map.on("click", "gsas-fill", (e) => {
            // let a well click win if a well point is under the cursor
            const wells = map.queryRenderedFeatures(e.point, { layers: ["wells-points"] });
            if (wells.length) return;
            showGsaStats(e.features[0].properties.GSA_Name);
        });
    }).catch(err => console.error("GSA load error:", err));
}
function catColor(mode, key) {
    const c = COLOR_MODES[mode] && COLOR_MODES[mode].cats.find(x => x[0] === key);
    return c ? c[1] : "#6b7280";
}
function breakdownRows(obj, mode, withExt) {
    return Object.entries(obj).map(([k, v]) => {
        const wells = withExt ? v.wells : v;
        const ext = withExt && v.ext ? ` · ${Math.round(v.ext).toLocaleString()} AF` : "";
        return `<div class="detail-row"><span class="detail-label"><span class="cat-dot" style="background:${catColor(mode, k)}"></span>${k}</span><span class="detail-value">${wells.toLocaleString()} well${wells === 1 ? "" : "s"}${ext}</span></div>`;
    }).join("");
}
function showGsaStats(name) {
    clearWellPOU();
    const s = gsaStats[name];
    const panel = document.getElementById("detail-panel");
    document.getElementById("detail-count").textContent = name;
    if (!s) {
        document.getElementById("detail-list").innerHTML = `<div class="detail-well"><div class="detail-note">No GEARS wells reported within this GSA.</div></div>`;
        panel.classList.remove("hidden"); return;
    }
    const flagNote = s.flagged_wells ? `<div class="detail-note">Excludes ${s.flagged_wells} well${s.flagged_wells === 1 ? "" : "s"} flagged as a likely reporting error.</div>` : "";
    const sub = (gsaStats.__subbasins__ || {})[s.subbasin];
    const share = sub && sub.ext > 0 ? Math.round(100 * s.ext / sub.ext) : null;
    const subSection = sub ? `
            <div class="detail-divider">${s.subbasin} subbasin total${sub.gsa_count ? ` — ${sub.gsa_count} GSAs` : ""}</div>
            ${row("Wells reported", sub.wells.toLocaleString())}
            ${row("Total reported extraction", `${Math.round(sub.ext).toLocaleString()} AF`)}
            ${row("Reporting accounts", sub.accounts.toLocaleString())}
            ${share != null ? row("This GSA's share", `${share}% of subbasin extraction`) : ""}` : "";
    document.getElementById("detail-list").innerHTML = `
        <div class="detail-well">
            <div class="detail-well-header"><span class="detail-dot" style="background:${SUBBASIN_COLORS[s.subbasin] || "#94a3b8"}"></span>
                <strong>${s.subbasin} Subbasin${s.num ? ` (${s.num})` : ""}</strong></div>
            ${row("Wells reported", `<strong>${s.wells.toLocaleString()}</strong>`)}
            ${row("Total reported extraction", `<strong>${Math.round(s.ext).toLocaleString()} AF</strong>`)}
            ${row("Reporting accounts", s.accounts.toLocaleString())}
            ${row("De minimis wells", s.de_minimis.toLocaleString())}
            ${flagNote}
            <div class="detail-divider">Wells &amp; extraction by purpose</div>
            ${breakdownRows(s.by_purpose, "purpose", true)}
            <div class="detail-divider">Wells by status</div>
            ${breakdownRows(s.by_status, "status", false)}
            <div class="detail-divider">Wells by measurement method</div>
            ${breakdownRows(s.by_method, "method", false)}
            ${subSection}
            <div class="detail-note">Wells assigned to GSAs by point-in-polygon on reported coordinates. Extraction is self-reported to GEARS (Jul 2024 – Dec 2025 window). Subbasin totals sum all GSAs in the subbasin.</div>
        </div>`;
    panel.classList.remove("hidden");
}
function loadCorcoranClay() {
    fetch("data/corcoran_clay.geojson").then(r => r.json()).then(data => {
        map.addSource("corcoran-clay", { type: "geojson", data });
        map.addLayer({ id: "corcoran-clay", type: "line", source: "corcoran-clay", layout: { visibility: "none" },
            paint: { "line-color": ["interpolate",["linear"],["get","THICKNESS"],10,"#93c5fd",60,"#3b82f6",120,"#1d4ed8",200,"#1e3a5f"],
                     "line-width": ["interpolate",["linear"],["zoom"],8,1.5,14,3], "line-opacity": 0.8 } });
    }).catch(e => console.error(e));
}
function loadCorcoranDepth() {
    fetch("data/corcoran_depth.geojson").then(r => r.json()).then(data => {
        map.addSource("corcoran-depth", { type: "geojson", data });
        map.addLayer({ id: "corcoran-depth", type: "line", source: "corcoran-depth", layout: { visibility: "none" },
            paint: { "line-color": ["interpolate",["linear"],["get","COR_DEPTH"],50,"#fca5a5",250,"#ef4444",500,"#b91c1c",900,"#7f1d1d"],
                     "line-width": ["interpolate",["linear"],["zoom"],8,1.5,14,3], "line-opacity": 0.8 } });
    }).catch(e => console.error(e));
}

/* ── Context layer toggles ───────────────────────────────────────── */
document.querySelectorAll("[data-layer]").forEach(cb => cb.addEventListener("change", () => {
    const id = cb.dataset.layer, vis = cb.checked ? "visible" : "none";
    const groups = { crops:["crops","crops-fill"], parcels:["parcels","parcels-fill"],
        pou:["pou-fill","pou-outline","pou-tulare-fill","pou-tulare-outline"],
        "corcoran-clay":["corcoran-clay"], "corcoran-depth":["corcoran-depth"], "wells-heat":["wells-heat"] };
    (groups[id] || [id]).forEach(l => { if (map.getLayer(l)) map.setLayoutProperty(l, "visibility", vis); });
}));
document.getElementById("toggle-all-gsas").addEventListener("change", (e) => {
    const vis = e.target.checked ? "visible" : "none";
    ["gsas-fill","gsas-line","gsas-labels"].forEach(l => { if (map.getLayer(l)) map.setLayoutProperty(l, "visibility", vis); });
});

/* ── Basemap / fullscreen / sidebar (from SFKGSA map) ────────────── */
const BASEMAPS = {
    satellite: { tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"], labels: false },
    hybrid:    { tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"], labels: true },
    usgs:      { tiles: ["https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}"], labels: false },
    streets:   { tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], labels: false },
};
let currentBasemap = "hybrid";
document.getElementById("basemap-btn").addEventListener("click", () => document.getElementById("basemap-menu").classList.toggle("hidden"));
document.addEventListener("click", (e) => { if (!e.target.closest(".basemap-selector")) document.getElementById("basemap-menu").classList.add("hidden"); });
document.querySelectorAll(".basemap-option").forEach(opt => opt.addEventListener("click", () => {
    const id = opt.dataset.basemap; if (id === currentBasemap) return;
    currentBasemap = id; const bm = BASEMAPS[id];
    const src = map.getSource("satellite"); if (src) src.setTiles(bm.tiles);
    ["labels","roads"].forEach(l => { if (map.getLayer(l)) map.setLayoutProperty(l, "visibility", bm.labels ? "visible" : "none"); });
    document.querySelectorAll(".basemap-option").forEach(o => o.classList.remove("active"));
    opt.classList.add("active"); document.getElementById("basemap-menu").classList.add("hidden");
}));

const fsBtn = document.getElementById("fullscreen-btn");
fsBtn.addEventListener("click", () => {
    if (document.fullscreenElement) return document.exitFullscreen();
    document.documentElement.requestFullscreen().catch(() => window.open(location.href, "_blank"));
});
document.addEventListener("fullscreenchange", () => {
    const isFs = !!document.fullscreenElement;
    document.getElementById("fs-expand").style.display = isFs ? "none" : "block";
    document.getElementById("fs-collapse").style.display = isFs ? "block" : "none";
    setTimeout(() => map.resize(), 100);
});

function debounce(fn, ms){ let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

const sidebar = document.getElementById("sidebar"), sidebarToggle = document.getElementById("sidebar-toggle");
sidebarToggle.addEventListener("click", () => {
    sidebar.classList.toggle("sidebar-closed"); sidebar.classList.toggle("sidebar-open");
    setTimeout(() => map.resize(), 300);
});
function checkSidebarFit() {
    if (window.innerWidth < 900) {
        sidebarToggle.classList.add("visible");
        if (sidebar.classList.contains("sidebar-open")) { sidebar.classList.remove("sidebar-open"); sidebar.classList.add("sidebar-closed"); setTimeout(() => map.resize(), 300); }
    } else {
        sidebarToggle.classList.remove("visible"); sidebar.classList.remove("sidebar-closed"); sidebar.classList.add("sidebar-open"); setTimeout(() => map.resize(), 300);
    }
}
checkSidebarFit();
window.addEventListener("resize", debounce(checkSidebarFit, 200));
