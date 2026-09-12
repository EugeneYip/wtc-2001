#!/usr/bin/env python3
"""
Build the World Trade Center scene from cached OpenStreetMap extracts.

Reads  raw/{buildings,roads,water}.json   (Overpass API, see fetch_osm.py)
Writes data/city.json                     (consumed by the viewer)

The model depicts Lower Manhattan as it stood in September 2001, so the
pipeline does three things beyond a plain OSM-to-mesh conversion:

  1. Removes buildings that did not exist in 2001 (the post-attack WTC site,
     plus the 2002-2024 residential towers that filled in the Financial
     District and Battery Park City).
  2. Corrects heights OSM records as podium/roof-terrace values rather than
     tower values -- the World Financial Center towers are the big offenders.
  3. Adds back buildings that existed in 2001 but have since been demolished,
     and reconstructs the seven-building WTC complex itself.

Coordinates are metres in a local frame rotated onto the Manhattan street
grid: +x is grid east (toward Church Street), +z is grid south (toward
Liberty Street), origin midway between the two tower centres.
"""

import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
RAW = os.path.join(ROOT, "raw")
OUT = os.path.join(ROOT, "data", "city.json")

# ---------------------------------------------------------------------------
# Projection
# ---------------------------------------------------------------------------

# Origin: midpoint of the two tower centres. Taken from the 9/11 Memorial
# reflecting pools, which are built on the original tower footprints.
LAT0, LON0 = 40.7115844, -74.01312805
M_LAT = 111048.3   # metres per degree of latitude at 40.71 N
M_LON = 84519.9    # metres per degree of longitude at 40.71 N

# Rotation of the Lower Manhattan street grid, measured off the memorial pool
# edges (which are square to the tower footprints): grid north is 29.11 deg
# east of true north.
THETA = math.radians(29.11)
CT, ST = math.cos(THETA), math.sin(THETA)


def project(lat, lon):
    e = (lon - LON0) * M_LON
    n = (lat - LAT0) * M_LAT
    return (e * CT - n * ST, -(e * ST + n * CT))


# ---------------------------------------------------------------------------
# Curation tables
# ---------------------------------------------------------------------------

# Everything on the modern WTC site: the replacement towers, the transit hub,
# the memorial and its pools, the mall. All of it postdates 2001.
MODERN_WTC_SITE = {
    713565776,            # One World Trade Center (2014)
    278033607, 1550448261,  # 2 WTC (foundation/planned)
    166839381,            # 3 World Trade Center (2018)
    278033587, 3695230,   # 4 World Trade Center (2013)
    40010491,             # 5 World Trade Center (planned)
    277890516,            # 7 World Trade Center (2006 replacement)
    278033606,            # Transportation Hub / Oculus (2016)
    278033604,            # 9/11 Memorial & Museum pavilion
    129835611,            # National September 11 Memorial
    697722178, 697722181,  # Memorial North and South pools
    15051920,             # Westfield World Trade Center
    802613138, 802613142,  # PATH entrances
    812927889,            # Chambers St-WTC-Park Pl subway complex
}

# Buildings completed after 2001, keyed by OSM id. Only ones tall enough to
# read on the skyline are listed; short infill is left alone.
POST_2001 = {
    75309476:   "30 Park Place / Four Seasons (2016)",
    109473848:  "8 Spruce Street (2011)",
    261499928:  "56 Leonard Street (2017)",
    507295419:  "111 Murray Street (2018)",
    370070547:  "111 Washington Street / 8 Carlisle",
    20141436:   "50 West Street (2016)",
    278078943:  "19 Dutch Street (2018)",
    278078945:  "25 Park Row (2020)",
    375340304:  "161 Maiden Lane (2018)",
    277904734:  "45 Park Place (under construction)",
    1128358846: "77 Greenwich Street (2021)",
    278033628:  "Trinity Commons (2018)",
    1446412204: "under construction, unnamed",
    1126100205: "185 Broadway (2021)",
    278067736:  "The Visionaire (2008)",
    169362506:  "15 William Street (2009)",
    369962304:  "The Cloud One Hotel (2021)",
    1128358851: "Hotel Indigo",
    369862694:  "33 Beekman Street (2015)",
    278076359:  "Holiday Inn Express (2010)",
    278042243:  "Holiday Inn (2008)",
    278079600:  "Exhibit (2017)",
    277904769:  "143 Fulton Street (2018)",
    75309475:   "200 West Street / Goldman Sachs (2009)",
    292727038:  "115 Nassau Street",
    369868758:  "215 Pearl Street (Courtyard)",
    # Battery Park City north and south neighbourhoods, all post-2001
    277880567:  "River & Warren",
    277880570:  "The Solaire (2003)",
    277880571:  "The Riverhouse (2008)",
    277880566:  "The Verdesian (2006)",
    277880568:  "Tribeca Green (2005)",
    250568897:  "Liberty Green (2010)",
    277880569:  "Liberty Luxe (2011)",
    277922715:  "Liberty Terrace (2011)",
}

# OSM height/shape corrections.
#
# Several of these record only the retail podium, so extruding the footprint
# to the tower height would produce a 140 m wide slab. Those entries carry a
# "tower" box (width, depth, height-to-crown) that rises from the podium, and
# a crown style with its own height on top. Total height = tower h + crown rh.
#
#   id: podium height, tower (w, d, h), crown style, crown height, label
HEIGHT_FIX = {
    # Cesar Pelli's World Financial Center: slender shafts on a shared
    # retail-and-atrium podium, each with a different geometric crown.
    75309471:  dict(h=20.0, tower=(54, 54, 160.0), r="dome",    rh=16.0,
                    n="One World Financial Center"),
    75309461:  dict(h=20.0, tower=(57, 57, 180.0), r="dome",    rh=17.0,
                    n="Two World Financial Center"),
    277919047: dict(h=20.0, tower=(58, 58, 197.0), r="steppyr", rh=28.0,
                    n="Three World Financial Center"),
    793889288: dict(h=20.0, tower=(55, 55, 128.0), r="steppyr", rh=24.0,
                    n="Four World Financial Center"),
    # Art Deco setbacks.
    277890504: dict(h=62.0, tower=(52, 40, 126.0), r="setback", rh=26.0,
                    n="Barclay-Vesey Building"),
    # 30-storey base block, then the tower, then the terracotta crown.
    75363809:  dict(h=88.0, tower=(26, 24, 183.0), r="spire",   rh=58.0,
                    n="Woolworth Building"),
    # True slab towers: one extrusion of the whole footprint is correct.
    278039446: dict(h=226.0, n="One Liberty Plaza"),
    278039445: dict(h=177.7, n="Millenium Hilton"),
    278033633: dict(h=83.0, r="setback", rh=16.0, n="90 West Street"),
}

# Standing in 2001, gone now, so absent from OSM. Footprints are given
# directly in the local grid frame.
DEMOLISHED = [
    {
        # Damaged on 9/11, deconstructed 2007-2011. A dark 40-storey slab
        # directly across Liberty Street from the South Tower.
        "name": "Deutsche Bank Building (130 Liberty Street)",
        "poly": [(-6, 128), (62, 128), (62, 180), (-6, 180)],
        "h": 158.0, "cls": "dark",
    },
]

# ---------------------------------------------------------------------------
# The World Trade Center complex, as built
# ---------------------------------------------------------------------------
#
# Superblock, from the street centrelines in raw/roads.json:
#   West Street    x = -128      Church Street  x =  200
#   Vesey Street   z = -177      Liberty Street z =  112
#
# Tower centres come straight from the memorial pool centroids; the two
# towers are offset diagonally by 67.0 m east and 103.8 m south, leaving the
# documented ~130 ft gap between their facing walls.

TOWER_SIDE = 63.40          # 208 ft square footprint
WTC1_CENTER = (-33.5, -51.9)
WTC2_CENTER = (33.5, 51.9)
WTC1_ROOF = 417.0           # 1,368 ft
WTC2_ROOF = 415.1           # 1,362 ft
WTC1_MAST = 110.0           # 360 ft mast, added 1978; tip at 1,728 ft

PLAZA_LEVEL = 4.3           # Austin J. Tobin Plaza sits above street grade


def rect(x0, z0, x1, z1):
    return [(x0, z0), (x1, z0), (x1, z1), (x0, z1)]


def lshape(x0, z0, x1, z1, cx, cz, quadrant):
    """Rectangle with one corner notched out, for the low-rise plaza buildings."""
    if quadrant == "nw":   # notch removed from the north-west corner
        return [(cx, z0), (x1, z0), (x1, z1), (x0, z1), (x0, cz), (cx, cz)]
    if quadrant == "ne":
        return [(x0, z0), (cx, z0), (cx, cz), (x1, cz), (x1, z1), (x0, z1)]
    if quadrant == "sw":
        return [(x0, z0), (x1, z0), (x1, z1), (cx, z1), (cx, cz), (x0, cz)]
    return [(x0, z0), (x1, z0), (x1, cz), (cx, cz), (cx, z1), (x0, z1)]  # se


WTC_COMPLEX = [
    {
        "id": "wtc3", "name": "3 WTC - Marriott World Trade Center",
        "poly": rect(-110, 46, -26, 100), "h": 73.7, "roof": "flat",
        "cls": "wtc_low", "levels": 22,
    },
    {
        "id": "wtc4", "name": "4 WTC - South East Plaza Building",
        "poly": lshape(96, 30, 186, 100, 140, 62, "nw"), "h": 36.0,
        "roof": "flat", "cls": "wtc_low", "levels": 9,
    },
    {
        "id": "wtc5", "name": "5 WTC - North East Plaza Building",
        "poly": lshape(96, -163, 186, -88, 140, -120, "sw"), "h": 36.0,
        "roof": "flat", "cls": "wtc_low", "levels": 9,
    },
    {
        "id": "wtc6", "name": "6 WTC - U.S. Customs House",
        "poly": lshape(-110, -163, 60, -92, -46, -120, "se"), "h": 32.0,
        "roof": "flat", "cls": "wtc_low", "levels": 8,
    },
    {
        # The original 7 WTC (1987-2001): a 47-storey trapezoid north of Vesey
        # Street, built over a Con Edison substation. It stood east of the
        # 2006 replacement, across ground where Greenwich Street now runs.
        "id": "wtc7", "name": "7 World Trade Center (1987)",
        "poly": [(-47, -243), (55, -238), (55, -196), (-47, -196)],
        "h": 186.0, "roof": "flat", "cls": "wtc7", "levels": 47,
    },
]

# Austin J. Tobin Plaza: the five-acre elevated deck between the buildings.
PLAZA_POLY = [(-110, -163), (186, -163), (186, 100), (-110, 100)]

# ---------------------------------------------------------------------------
# Geometry helpers
# ---------------------------------------------------------------------------


def stitch(segs, tol=1e-7):
    """Join way fragments end to end into closed rings."""
    segs = [list(s) for s in segs if len(s) > 1]
    rings = []
    while segs:
        ring = segs.pop(0)
        extended = True
        while extended and segs:
            extended = False
            # Already closed? Start a new ring.
            if (abs(ring[0][0] - ring[-1][0]) < tol
                    and abs(ring[0][1] - ring[-1][1]) < tol):
                break
            for i, cand in enumerate(segs):
                for rev in (False, True):
                    c = cand[::-1] if rev else cand
                    if (abs(ring[-1][0] - c[0][0]) < tol
                            and abs(ring[-1][1] - c[0][1]) < tol):
                        ring.extend(c[1:])
                        segs.pop(i)
                        extended = True
                        break
                if extended:
                    break
        rings.append(ring)
    return rings


def rings_from(elem):
    """Outer and inner rings of a way or multipolygon relation."""
    g = elem.get("geometry")
    if g:
        return [[(p["lat"], p["lon"]) for p in g]], []
    if elem["type"] != "relation":
        return [], []
    by_role = {"outer": [], "inner": []}
    for m in elem.get("members", []):
        if m.get("geometry") and m.get("role") in by_role:
            by_role[m["role"]].append([(p["lat"], p["lon"]) for p in m["geometry"]])
    return stitch(by_role["outer"]), stitch(by_role["inner"])


def ring_from(elem):
    """Just the first outer ring, for buildings."""
    outer, _ = rings_from(elem)
    return outer[0] if outer else None


def simplify(pts, tol=0.9):
    """Douglas-Peucker on a closed ring."""
    if len(pts) < 4:
        return pts

    def dp(a, b):
        if b <= a + 1:
            return []
        (x0, z0), (x1, z1) = pts[a], pts[b]
        dx, dz = x1 - x0, z1 - z0
        n = math.hypot(dx, dz)
        worst, wi = -1.0, -1
        for i in range(a + 1, b):
            x, z = pts[i]
            d = (abs(dz * x - dx * z + x1 * z0 - z1 * x0) / n) if n > 1e-9 \
                else math.hypot(x - x0, z - z0)
            if d > worst:
                worst, wi = d, i
        if worst <= tol:
            return []
        return dp(a, wi) + [wi] + dp(wi, b)

    keep = [0] + dp(0, len(pts) - 1) + [len(pts) - 1]
    return [pts[i] for i in keep]


def area_of(poly):
    s = 0.0
    for i in range(len(poly)):
        x0, z0 = poly[i]
        x1, z1 = poly[(i + 1) % len(poly)]
        s += x0 * z1 - x1 * z0
    return abs(s) * 0.5


def ccw(poly):
    s = 0.0
    for i in range(len(poly)):
        x0, z0 = poly[i]
        x1, z1 = poly[(i + 1) % len(poly)]
        s += (x1 - x0) * (z1 + z0)
    return poly if s > 0 else poly[::-1]


def centroid(poly):
    return (sum(p[0] for p in poly) / len(poly),
            sum(p[1] for p in poly) / len(poly))


def load(name):
    with open(os.path.join(RAW, name)) as f:
        return json.load(f)["elements"]


# ---------------------------------------------------------------------------
# Building extraction
# ---------------------------------------------------------------------------

def parse_height(tags):
    for key in ("height", "building:height"):
        if key in tags:
            try:
                return float(str(tags[key]).replace("m", "").strip())
            except ValueError:
                pass
    for key in ("building:levels", "levels"):
        if key in tags:
            try:
                return float(str(tags[key]).split(";")[0]) * 3.7 + 2.0
            except ValueError:
                pass
    return None


def year_of(tags):
    d = tags.get("start_date") or tags.get("construction_date")
    if not d:
        return None
    for i in range(len(d) - 3):
        chunk = d[i:i + 4]
        if chunk.isdigit() and 1600 < int(chunk) < 2100:
            return int(chunk)
    return None


def classify(height, year, tags):
    """Facade family, used by the viewer to pick a material."""
    b = tags.get("building", "")
    if year and year < 1915:
        return "masonry_old"
    if year and year < 1945:
        return "masonry_deco"
    if height >= 120:
        return "tower_modern" if (year or 1970) >= 1960 else "masonry_deco"
    if height >= 55:
        return "midrise"
    if b in ("church", "chapel", "cathedral"):
        return "masonry_old"
    return "lowrise"


def build_buildings():
    out = []
    dropped_modern = 0
    dropped_site = 0

    # The superblock, cleared so the reconstructed complex can stand on it.
    SITE = (-120, -172, 196, 108)   # x0, z0, x1, z1

    for e in load("buildings.json"):
        oid = e["id"]
        tags = e.get("tags", {})

        if oid in MODERN_WTC_SITE:
            dropped_site += 1
            continue
        if oid in POST_2001:
            dropped_modern += 1
            continue

        year = year_of(tags)
        if year and year > 2001:
            dropped_modern += 1
            continue
        if tags.get("building") == "construction" and oid not in HEIGHT_FIX:
            dropped_modern += 1
            continue

        ring = ring_from(e)
        if not ring or len(ring) < 4:
            continue

        poly = [project(la, lo) for la, lo in ring]
        if poly[0] == poly[-1]:
            poly.pop()
        poly = simplify(poly)
        if len(poly) < 3:
            continue

        a = area_of(poly)
        if a < 45:                       # sheds, kiosks, subway stairs
            continue

        cx, cz = centroid(poly)
        if SITE[0] < cx < SITE[2] and SITE[1] < cz < SITE[3]:
            dropped_site += 1            # anything left inside the superblock
            continue

        fix = HEIGHT_FIX.get(oid)
        rec = {"p": [[round(x, 2), round(z, 2)] for x, z in ccw(poly)]}

        if fix:
            h = fix["h"]
            rec["h"] = round(h, 1)
            rec["n"] = fix["n"]
            top = h
            if "tower" in fix:
                tw, td, th = fix["tower"]
                rec["t"] = {"w": tw, "d": td, "h": th,
                            "cx": round(cx, 1), "cz": round(cz, 1)}
                top = th
            if "r" in fix:
                rec["r"] = fix["r"]
                rec["rh"] = fix["rh"]
                top += fix["rh"]
            rec["c"] = classify(top, year, tags)
        else:
            h = parse_height(tags)
            if h is None:
                # Deterministic variation keeps the background fabric from
                # reading as one uniform slab.
                h = 17.0 + (oid % 23) * 1.45 + min(a, 3000) / 320.0
            h = max(h, 6.0)
            rec["h"] = round(h, 1)
            rec["c"] = classify(h, year, tags)
            rec["n"] = tags.get("name", "") if h >= 90 else ""

        out.append(rec)

    print("  buildings kept        : %d" % len(out))
    print("  dropped, post-2001    : %d" % dropped_modern)
    print("  dropped, on WTC site  : %d" % dropped_site)
    return out


# ---------------------------------------------------------------------------
# Roads
# ---------------------------------------------------------------------------

ROAD_WIDTH = {
    "motorway": 24, "motorway_link": 10, "trunk": 20, "trunk_link": 9,
    "primary": 17, "secondary": 15, "tertiary": 13,
    "residential": 11, "unclassified": 11, "living_street": 9,
    "pedestrian": 9, "service": 5, "footway": 3,
}

# In 2001 the superblock was continuous: these streets stopped at its edge
# and were only reinstated across it after 2001.
SITE_CLIP = (-118, -170, 194, 106)


def clip_out_site(pts):
    """Split a polyline so no part of it crosses the WTC superblock."""
    x0, z0, x1, z1 = SITE_CLIP
    runs, cur = [], []
    for x, z in pts:
        if x0 < x < x1 and z0 < z < z1:
            if len(cur) > 1:
                runs.append(cur)
            cur = []
        else:
            cur.append((x, z))
    if len(cur) > 1:
        runs.append(cur)
    return runs


def build_roads():
    out = []
    for e in load("roads.json"):
        tags = e.get("tags", {})
        hw = tags.get("highway")
        w = ROAD_WIDTH.get(hw)
        if w is None or hw in ("footway", "service"):
            continue
        g = e.get("geometry")
        if not g or len(g) < 2:
            continue
        pts = [project(p["lat"], p["lon"]) for p in g]
        for run in clip_out_site(pts):
            run = simplify(run, 1.5)
            if len(run) < 2:
                continue
            out.append({
                "p": [[round(x, 1), round(z, 1)] for x, z in run],
                "w": w,
                "k": "major" if w >= 15 else "minor",
            })
    print("  road segments         : %d" % len(out))
    return out


# ---------------------------------------------------------------------------
# Water and open space
# ---------------------------------------------------------------------------

# The rivers run far past the site; anything beyond this is never in frame.
WATER_CLIP = 6500.0


def clip_ring(poly, limit):
    """Clamp a ring into a box. Coarse, but these are flat distant polygons."""
    out = [(max(-limit, min(limit, x)), max(-limit, min(limit, z))) for x, z in poly]
    dedup = [out[0]]
    for p in out[1:]:
        if abs(p[0] - dedup[-1][0]) > 0.5 or abs(p[1] - dedup[-1][1]) > 0.5:
            dedup.append(p)
    return dedup


def prep(ring, tol, limit=None):
    poly = [project(la, lo) for la, lo in ring]
    if poly and poly[0] == poly[-1]:
        poly.pop()
    if limit:
        poly = clip_ring(poly, limit)
    poly = simplify(poly, tol)
    return poly if len(poly) >= 3 else None


def point_in(pt, poly):
    x, z = pt
    hit = False
    for i in range(len(poly)):
        x0, z0 = poly[i]
        x1, z1 = poly[i - 1]
        if (z0 > z) != (z1 > z) and x < (x1 - x0) * (z - z0) / (z1 - z0) + x0:
            hit = not hit
    return hit


def build_areas():
    """Water, with islands kept as holes so they do not end up submerged."""
    water = []
    for e in load("water.json"):
        tags = e.get("tags", {})
        if tags.get("natural") != "water":
            continue
        outers, inners = rings_from(e)
        outs = [p for p in (prep(r, 7.0, WATER_CLIP) for r in outers) if p]
        ins = [p for p in (prep(r, 7.0, WATER_CLIP) for r in inners) if p]
        for o in outs:
            if area_of(o) < 900:
                continue
            holes = [h for h in ins if area_of(h) > 900 and point_in(h[0], o)]
            rec = {"p": [[round(x, 1), round(z, 1)] for x, z in ccw(o)]}
            if holes:
                rec["h"] = [[[round(x, 1), round(z, 1)] for x, z in ccw(h)[::-1]]
                            for h in holes]
            water.append(rec)

    parks = []
    for e in load("green.json"):
        poly = prep(ring_from(e) or [], 2.0)
        if not poly or area_of(poly) < 300:
            continue
        parks.append({"p": [[round(x, 1), round(z, 1)] for x, z in ccw(poly)]})

    pts = sum(len(w["p"]) + sum(len(h) for h in w.get("h", [])) for w in water)
    print("  water polygons        : %d  (%d points)" % (len(water), pts))
    print("  park polygons         : %d" % len(parks))
    return water, parks


# ---------------------------------------------------------------------------

def main():
    print("Building WTC scene (Lower Manhattan, September 2001)")
    buildings = build_buildings()

    for d in DEMOLISHED:
        buildings.append({
            "p": [[x, z] for x, z in ccw(d["poly"])],
            "h": d["h"], "c": d["cls"], "n": d["name"],
        })
    print("  re-added demolished   : %d" % len(DEMOLISHED))

    roads = build_roads()
    water, parks = build_areas()

    scene = {
        "meta": {
            "title": "World Trade Center and Lower Manhattan, September 2001",
            "origin": {"lat": LAT0, "lon": LON0},
            "grid_rotation_deg": round(math.degrees(THETA), 3),
            "units": "metres",
            "axes": "+x grid east, +y up, +z grid south",
            "source": "OpenStreetMap (ODbL), curated to 2001",
        },
        "towers": {
            "side": TOWER_SIDE,
            "wtc1": {"c": list(WTC1_CENTER), "roof": WTC1_ROOF, "mast": WTC1_MAST,
                     "name": "1 World Trade Center (North Tower)"},
            "wtc2": {"c": list(WTC2_CENTER), "roof": WTC2_ROOF, "mast": 0.0,
                     "name": "2 World Trade Center (South Tower)"},
        },
        "complex": [
            {"p": [[x, z] for x, z in ccw(b["poly"])], "h": b["h"], "r": b["roof"],
             "c": b["cls"], "n": b["name"], "id": b["id"]}
            for b in WTC_COMPLEX
        ],
        "plaza": {"p": [[x, z] for x, z in ccw(PLAZA_POLY)], "y": PLAZA_LEVEL},
        "buildings": buildings,
        "roads": roads,
        "water": water,
        "parks": parks,
    }

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(scene, f, separators=(",", ":"))
    print("\nwrote %s  (%.1f KB)" % (os.path.relpath(OUT, ROOT),
                                     os.path.getsize(OUT) / 1024.0))


if __name__ == "__main__":
    sys.setrecursionlimit(10000)
    main()
