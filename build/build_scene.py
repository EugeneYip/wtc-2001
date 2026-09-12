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
import random
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
    # Liberty Park, built on the cleared Deutsche Bank site after 2001.
    278033625:  "St. Nicholas National Shrine (2022)",
    1125067850: "Liberty Park guardhouse",
    684936385:  "Liberty Park service structure",
    684939461:  "Liberty Park structure",
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
        # Damaged on 9/11, deconstructed 2007-2011. A dark 40-storey tower
        # directly across Liberty Street from the South Tower.
        #
        # Its block is bounded by Liberty (z 111.6), Cedar (z 169.9),
        # Washington (x 46.4) and Greenwich (x 121.7), measured from the road
        # centrelines in that band -- the street averages over the whole
        # extract are useless here because both avenues jog.
        "name": "Deutsche Bank Building (130 Liberty Street)",
        "poly": [(50, 117), (118, 117), (118, 165), (50, 165)],
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
# Austin J. Tobin Plaza and its steps.
#
# The deck stood 4.3 m above the street and was reached by flights from the
# pavements around it. Two are modelled, each in the only stretch of its
# frontage that is not a building:
#
#   Liberty Street, south, between 3 WTC and 4 WTC, centred on the South Tower.
#   Vesey Street, north, between 6 WTC and 5 WTC, on the line Greenwich Street
#   would take through the site. This is the Vesey Street stair -- the
#   "Survivors' Staircase" -- the last original structure left standing above
#   ground on the site, moved into the memorial museum in 2008.
#
# One caveat on the Vesey flight: this model puts every street at one level,
# but Lower Manhattan slopes, and the grade at the north-east of the site was
# not the same as at Liberty Street. The flight is placed and sized to read
# correctly; its rise is the model's uniform 4.3 m, not a surveyed figure.

PLAZA_STAIRS = [
    {   # Liberty Street, rising north into the deck
        "name": "Liberty Street",
        "x0": 13.0, "x1": 57.0,
        "z_top": 93.0, "z_bottom": 104.0,
        "steps": 22,                 # 0.20 m risers on 0.50 m treads
    },
    {   # Vesey Street, rising south into the deck.
        #
        # The real thing was a stair with a bank of escalators alongside it,
        # so the opening carries both: steps on the west side, a smooth
        # inclined bank on the east. Modelling the whole 13 m opening as
        # treads would overstate the staircase, which was about 5.5 m wide.
        "name": "Vesey Street",
        "x0": 65.0, "x1": 78.0,
        "z_top": -156.0, "z_bottom": -167.0,
        "steps": 22,
        "escalator": {"x0": 71.5, "x1": 78.0},
    },
]

PLAZA_EDGE = {"west": -110.0, "east": 186.0, "north": -163.0, "south": 100.0}


def _plaza_outline():
    """The deck outline, with a notch cut for each flight."""
    w, e = PLAZA_EDGE["west"], PLAZA_EDGE["east"]
    n, s = PLAZA_EDGE["north"], PLAZA_EDGE["south"]
    north_stairs = sorted((st for st in PLAZA_STAIRS if st["z_bottom"] < st["z_top"]),
                          key=lambda st: st["x0"])
    south_stairs = sorted((st for st in PLAZA_STAIRS if st["z_bottom"] > st["z_top"]),
                          key=lambda st: -st["x0"])

    pts = [(w, n)]
    for st in north_stairs:                      # west to east along Vesey
        pts += [(st["x0"], n), (st["x0"], st["z_top"]),
                (st["x1"], st["z_top"]), (st["x1"], n)]
    pts += [(e, n), (e, s)]
    for st in south_stairs:                      # east to west along Liberty
        pts += [(st["x1"], s), (st["x1"], st["z_top"]),
                (st["x0"], st["z_top"]), (st["x0"], s)]
    pts.append((w, s))
    return pts


PLAZA_POLY = _plaza_outline()

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

# Overpass returns whole ways, so a street that merely clips the extract comes
# back in full -- Broadway and the FDR ran two and a half kilometres past the
# last building, leaving roads and traffic stranded on bare ground. Roads are
# clipped back to the box the buildings were queried from, which is a rotated
# quad once projected onto the street grid.
BUILD_BBOX = (40.7048, -74.0205, 40.7185, -74.0045)   # south, west, north, east


def _road_quad(margin=90.0):
    s_, w_, n_, e_ = BUILD_BBOX
    corners = [project(s_, w_), project(s_, e_), project(n_, e_), project(n_, w_)]
    cx = sum(p[0] for p in corners) / 4.0
    cz = sum(p[1] for p in corners) / 4.0
    out = []
    for x, z in corners:
        d = math.hypot(x - cx, z - cz) or 1.0
        out.append((x + (x - cx) / d * margin, z + (z - cz) / d * margin))
    return out


ROAD_QUAD = _road_quad()


def _in_quad(pt, quad):
    x, z = pt
    sign = 0
    for i in range(len(quad)):
        x0, z0 = quad[i]
        x1, z1 = quad[(i + 1) % len(quad)]
        cross = (x1 - x0) * (z - z0) - (z1 - z0) * (x - x0)
        if cross == 0:
            continue
        s = 1 if cross > 0 else -1
        if sign == 0:
            sign = s
        elif s != sign:
            return False
    return True


def clip_to_quad(pts, quad):
    """Split a polyline so only the parts inside `quad` survive."""
    runs, cur = [], []
    for p in pts:
        if _in_quad(p, quad):
            cur.append(p)
        else:
            if len(cur) > 1:
                runs.append(cur)
            cur = []
    if len(cur) > 1:
        runs.append(cur)
    return runs


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
        runs = []
        for inside_quad in clip_to_quad(pts, ROAD_QUAD):
            runs.extend(clip_out_site(inside_quad))
        for run in runs:
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

# The rivers run far past the site. This sits beyond the fog limit, so the
# edge of the extract is never visible.
WATER_CLIP = 14000.0


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


# ---------------------------------------------------------------------------
# Coastline -> land
# ---------------------------------------------------------------------------
#
# The shoreline around New York is mapped in OpenStreetMap as `natural=
# coastline`, not as water polygons. Drawing water polygons over a land plane
# therefore got Manhattan's shape from the edges of river-channel polygons,
# which left the East River missing entirely and the Hudson's edge ragged.
#
# This inverts the model: the world is sea, and land is drawn on top of it,
# assembled from the coastline itself. The OSM convention is that a coastline
# way runs with land on its left and water on its right, so stitched rings
# come out counter-clockwise around land.

LAND_CLIP = 14000.0


def _stitch_chains(ways):
    """Join coastline ways end to end into chains.

    OSM coastline ways are all directed the same way round (land on the left),
    so a chain is built by following tail to head only; nothing is ever
    reversed. Chains are grown from the ways that no other way feeds into, so
    a chain is never started from its middle, and whatever is left over after
    that is a closed loop.
    """
    from collections import defaultdict

    def key(p):
        return (round(p[0], 6), round(p[1], 6))

    segs = [list(w) for w in ways if len(w) > 1]
    by_head = defaultdict(list)
    tails = set()
    for i, w in enumerate(segs):
        by_head[key(w[0])].append(i)
        tails.add(key(w[-1]))

    used = [False] * len(segs)
    closed, open_ = [], []

    def grow(i):
        used[i] = True
        chain = list(segs[i])
        while True:
            nxt = next((j for j in by_head.get(key(chain[-1]), ()) if not used[j]),
                       None)
            if nxt is None:
                break
            used[nxt] = True
            chain.extend(segs[nxt][1:])
            if key(chain[0]) == key(chain[-1]):
                break
        return chain

    # Open chains first: a way whose head nothing feeds into starts one.
    for i, w in enumerate(segs):
        if used[i] or key(w[0]) in tails:
            continue
        open_.append(grow(i))

    # Anything still unused belongs to a closed loop.
    for i in range(len(segs)):
        if used[i]:
            continue
        chain = grow(i)
        if len(chain) > 3 and key(chain[0]) == key(chain[-1]):
            closed.append(chain[:-1])
        else:
            open_.append(chain)

    return closed, open_


def _clip_polyline(pts, R):
    """Split a polyline into the runs that lie inside the box, with the
    crossings placed exactly on the boundary."""
    def inside(p):
        return -R <= p[0] <= R and -R <= p[1] <= R

    def cross(a, b):
        # Walk the segment and bisect onto the boundary. Cheap and exact enough
        # at these scales.
        lo, hi = 0.0, 1.0
        for _ in range(40):
            mid = (lo + hi) / 2
            m = (a[0] + (b[0] - a[0]) * mid, a[1] + (b[1] - a[1]) * mid)
            if inside(m):
                lo = mid
            else:
                hi = mid
        t = lo
        return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)

    runs, cur = [], []
    for i, p in enumerate(pts):
        if inside(p):
            if not cur and i > 0:
                cur.append(cross(p, pts[i - 1]))
            cur.append(p)
        else:
            if cur:
                cur.append(cross(cur[-1], p))
                if len(cur) > 1:
                    runs.append(cur)
                cur = []
    if len(cur) > 1:
        runs.append(cur)
    return runs


def _perimeter_t(p, R):
    """Position of a boundary point on the box perimeter, in [0, 4).
    The box is walked counter-clockwise: bottom, right, top, left."""
    x, y = p
    e = R * 1e-6 + 0.5
    if abs(y + R) <= e:
        return 0.0 + (x + R) / (2 * R)
    if abs(x - R) <= e:
        return 1.0 + (y + R) / (2 * R)
    if abs(y - R) <= e:
        return 2.0 + (R - x) / (2 * R)
    return 3.0 + (R - y) / (2 * R)


def _corners(t0, t1, R, ccw=True):
    """Corner points crossed walking round the box from t0 to t1."""
    corner = {0: (-R, -R), 1: (R, -R), 2: (R, R), 3: (-R, R)}
    pts = []
    t = t0
    span = (t1 - t0) % 4.0 if ccw else (t0 - t1) % 4.0
    walked = 0.0
    for _ in range(8):
        if ccw:
            nxt = math.floor(t) + 1.0
            step = (nxt - t) % 4.0 or 4.0
        else:
            nxt = math.ceil(t) - 1.0
            step = (t - nxt) % 4.0 or 4.0
        if walked + step >= span:
            break
        walked += step
        t = nxt % 4.0
        pts.append(corner[int(round(t)) % 4] if ccw else corner[int(round(t)) % 4])
    return pts


def _point_in(pt, poly):
    x, y = pt
    hit = False
    for i in range(len(poly)):
        x0, y0 = poly[i]
        x1, y1 = poly[i - 1]
        if (y0 > y) != (y1 > y) and x < (x1 - x0) * (y - y0) / (y1 - y0) + x0:
            hit = not hit
    return hit


def _land_probe(run):
    """A point a few metres to the left of the run's first segment, which by
    the OSM coastline convention is on land."""
    (ax, ay), (bx, by) = run[0], run[1]
    dx, dy = bx - ax, by - ay
    n = math.hypot(dx, dy) or 1.0
    return ((ax + bx) / 2 - dy / n * 6.0, (ay + by) / 2 + dx / n * 6.0)


def _water_oracle():
    """Large `natural=water` bodies, in (x, y) with y north, as a check on
    which side of a coastline is actually wet.

    These polygons are too coarse to define a shoreline but they are perfectly
    reliable in open water, which is all that is needed to tell a land ring
    from its complement.
    """
    bodies = []
    for e in load("water.json"):
        if e.get("tags", {}).get("natural") != "water":
            continue
        outers, _ = rings_from(e)
        for ring in outers:
            poly = [(x, -z) for x, z in
                    (project(la, lo) for la, lo in ring)]
            if len(poly) < 4:
                continue
            poly = simplify(poly, 25.0)
            if len(poly) < 3 or _ring_area(poly) < 250000:
                continue
            xs = [p[0] for p in poly]
            ys = [p[1] for p in poly]
            bodies.append((min(xs), max(xs), min(ys), max(ys), poly))
    return bodies


def _is_wet(pt, oracle):
    x, y = pt
    for x0, x1, y0, y1, poly in oracle:
        if x0 <= x <= x1 and y0 <= y <= y1 and _point_in(pt, poly):
            return True
    return False


def _wet_fraction(ring, oracle, samples=80):
    """Roughly how much of a ring's interior sits in known open water."""
    xs = [p[0] for p in ring]
    ys = [p[1] for p in ring]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    rnd = random.Random(12345)
    inside_n = wet = 0
    for _ in range(samples * 12):
        if inside_n >= samples:
            break
        p = (rnd.uniform(x0, x1), rnd.uniform(y0, y1))
        if not _point_in(p, ring):
            continue
        inside_n += 1
        if _is_wet(p, oracle):
            wet += 1
    return (wet / inside_n) if inside_n else 0.0


def _ring_area(poly):
    a = 0.0
    for i in range(len(poly)):
        x0, y0 = poly[i]
        x1, y1 = poly[(i + 1) % len(poly)]
        a += x0 * y1 - x1 * y0
    return abs(a) / 2.0


def _close_run(run, R, oracle):
    """Close an open coastline run against the box, on its land side.

    Both ways round the box are built and the one that encloses the land is
    kept, decided locally from the coastline direction rather than from any
    global winding convention.

    The two closures of a run partition the box between them, so a wrong pick
    yields "the whole box minus a sliver". Runs that merely clip a corner are
    too short to decide reliably and are dropped; anything that still comes
    out covering most of the box is rejected in favour of its complement.
    """
    if len(run) < 3:
        return None
    length = sum(math.dist(run[i], run[i + 1]) for i in range(len(run) - 1))
    if length < 250.0:
        return None

    t_end = _perimeter_t(run[-1], R)
    t_start = _perimeter_t(run[0], R)
    box_area = (2.0 * R) ** 2
    probe = _land_probe(run)

    cands = []
    for ccw in (True, False):
        ring = run + _corners(t_end, t_start, R, ccw)
        if len(ring) > 3:
            cands.append(ring)
    if not cands:
        return None

    ordered = [r for r in cands if _point_in(probe, r)]
    ordered += [r for r in cands if r not in ordered]
    ordered = [r for r in ordered if _ring_area(r) <= 0.6 * box_area]
    if not ordered:
        return None
    # The local land-on-the-left test is right near the site but goes wrong on
    # runs that skim the box, so confirm against the water data and take
    # whichever closure is actually the drier one.
    best, best_wet = None, 1.1
    for ring in ordered:
        w = _wet_fraction(ring, oracle)
        if w < best_wet:
            best, best_wet = ring, w
    return best if best_wet < 0.45 else None


def build_land():
    """Land polygons, assembled from the coastline.

    Every ring produced here encloses land, so rings may overlap freely and no
    nesting has to be worked out: the harbour and the rivers are simply where
    no ring covers.
    """
    ways = []
    for e in load("coast.json"):
        g = e.get("geometry")
        if not g or len(g) < 2:
            continue
        # (x, y) with y north, so "left of the way" is a plain +90 rotation.
        ways.append([(x, -z) for x, z in
                     (project(p["lat"], p["lon"]) for p in g)])

    closed, open_ = _stitch_chains(ways)
    oracle = _water_oracle()
    R = LAND_CLIP
    rings = []
    dropped = 0

    for ring in closed:
        runs = _clip_polyline(ring + [ring[0]], R)
        if len(runs) == 1 and len(runs[0]) > 3 and \
           math.dist(runs[0][0], runs[0][-1]) < 1.0:
            island = runs[0][:-1]
            # A closed coastline ring is land unless it is drawn the other way
            # round, which would make it a hole; none are expected here.
            if (_point_in(_land_probe(island), island)
                    and _wet_fraction(island, oracle) < 0.45):
                rings.append(island)
            else:
                dropped += 1
        else:
            open_.extend([r for r in runs if len(r) > 1])

    for chain in open_:
        for run in _clip_polyline(chain, R):
            ring = _close_run(run, R, oracle)
            if ring:
                rings.append(ring)

    out = []
    for ring in rings:
        poly = [(x, -y) for x, y in ring]          # back to (x, z), z south
        poly = simplify(poly, 4.0)
        if len(poly) < 3 or area_of(poly) < 4000:
            continue
        out.append({"p": [[round(x, 1), round(z, 1)] for x, z in ccw(poly)]})

    pts = sum(len(p["p"]) for p in out)
    print("  land polygons         : %d  (%d points, %d reversed rings dropped)"
          % (len(out), pts, dropped))
    return out


# ---------------------------------------------------------------------------
# Water and open space
# ---------------------------------------------------------------------------

# The rivers run far past the site. This sits beyond the fog limit, so the
# edge of the extract is never visible.
WATER_CLIP = 14000.0


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


# ---------------------------------------------------------------------------
# Coastline -> land
# ---------------------------------------------------------------------------
#
# The shoreline around New York is mapped in OpenStreetMap as `natural=
# coastline`, not as water polygons. Drawing water polygons over a land plane
# therefore got Manhattan's shape from the edges of river-channel polygons,
# which left the East River missing entirely and the Hudson's edge ragged.
#
# This inverts the model: the world is sea, and land is drawn on top of it,
# assembled from the coastline itself. The OSM convention is that a coastline
# way runs with land on its left and water on its right, so stitched rings
# come out counter-clockwise around land.

LAND_CLIP = 14000.0


def _stitch_chains(ways):
    """Join coastline ways end to end into chains.

    OSM coastline ways are all directed the same way round (land on the left),
    so a chain is built by following tail to head only; nothing is ever
    reversed. Chains are grown from the ways that no other way feeds into, so
    a chain is never started from its middle, and whatever is left over after
    that is a closed loop.
    """
    from collections import defaultdict

    def key(p):
        return (round(p[0], 6), round(p[1], 6))

    segs = [list(w) for w in ways if len(w) > 1]
    by_head = defaultdict(list)
    tails = set()
    for i, w in enumerate(segs):
        by_head[key(w[0])].append(i)
        tails.add(key(w[-1]))

    used = [False] * len(segs)
    closed, open_ = [], []

    def grow(i):
        used[i] = True
        chain = list(segs[i])
        while True:
            nxt = next((j for j in by_head.get(key(chain[-1]), ()) if not used[j]),
                       None)
            if nxt is None:
                break
            used[nxt] = True
            chain.extend(segs[nxt][1:])
            if key(chain[0]) == key(chain[-1]):
                break
        return chain

    # Open chains first: a way whose head nothing feeds into starts one.
    for i, w in enumerate(segs):
        if used[i] or key(w[0]) in tails:
            continue
        open_.append(grow(i))

    # Anything still unused belongs to a closed loop.
    for i in range(len(segs)):
        if used[i]:
            continue
        chain = grow(i)
        if len(chain) > 3 and key(chain[0]) == key(chain[-1]):
            closed.append(chain[:-1])
        else:
            open_.append(chain)

    return closed, open_


def _clip_polyline(pts, R):
    """Split a polyline into the runs that lie inside the box, with the
    crossings placed exactly on the boundary."""
    def inside(p):
        return -R <= p[0] <= R and -R <= p[1] <= R

    def cross(a, b):
        # Walk the segment and bisect onto the boundary. Cheap and exact enough
        # at these scales.
        lo, hi = 0.0, 1.0
        for _ in range(40):
            mid = (lo + hi) / 2
            m = (a[0] + (b[0] - a[0]) * mid, a[1] + (b[1] - a[1]) * mid)
            if inside(m):
                lo = mid
            else:
                hi = mid
        t = lo
        return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)

    runs, cur = [], []
    for i, p in enumerate(pts):
        if inside(p):
            if not cur and i > 0:
                cur.append(cross(p, pts[i - 1]))
            cur.append(p)
        else:
            if cur:
                cur.append(cross(cur[-1], p))
                if len(cur) > 1:
                    runs.append(cur)
                cur = []
    if len(cur) > 1:
        runs.append(cur)
    return runs


def _perimeter_t(p, R):
    """Position of a boundary point on the box perimeter, in [0, 4).
    The box is walked counter-clockwise: bottom, right, top, left."""
    x, y = p
    e = R * 1e-6 + 0.5
    if abs(y + R) <= e:
        return 0.0 + (x + R) / (2 * R)
    if abs(x - R) <= e:
        return 1.0 + (y + R) / (2 * R)
    if abs(y - R) <= e:
        return 2.0 + (R - x) / (2 * R)
    return 3.0 + (R - y) / (2 * R)


def build_areas():
    """Inland water only.

    The rivers and the harbour are now simply where the land polygons are not,
    so the big `natural=water` bodies would only z-fight the sea plane. What
    is left worth keeping is the basins cut into the land, above all North
    Cove at the World Financial Center.
    """
    water = []
    for e in load("water.json"):
        tags = e.get("tags", {})
        if tags.get("natural") != "water":
            continue
        outers, _ = rings_from(e)
        for o in (prep(r, 2.0, 3000.0) for r in outers):
            if not o:
                continue
            a = area_of(o)
            if a < 1200 or a > 200000:      # ponds and basins, not rivers
                continue
            water.append({"p": [[round(x, 1), round(z, 1)] for x, z in ccw(o)]})

    parks = []
    for e in load("green.json"):
        poly = prep(ring_from(e) or [], 2.0)
        if not poly or area_of(poly) < 300:
            continue
        parks.append({"p": [[round(x, 1), round(z, 1)] for x, z in ccw(poly)]})

    print("  inland water          : %d" % len(water))
    print("  park polygons         : %d" % len(parks))
    return water, parks


# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Brooklyn Bridge
# ---------------------------------------------------------------------------
#
# Its Manhattan end sits a kilometre east of the site and it closes every view
# up the East River, so leaving it out left the far bank of the river looking
# like an unfinished edge of the model rather than a shore.
#
# The plan comes from OpenStreetMap: the carriageway ways give the axis, and
# the land polygons give the two bulkhead lines the axis crosses. Only one
# published figure is added — the 1,595 ft 6 in between tower centres — and it
# is used to place the towers symmetrically about the middle of the channel,
# which puts each one just off its own bank, where they stand.

MAIN_SPAN = 486.3          # ft 1595.5, tower centre to tower centre

def _bridge_axis(ways):
    """Longest carriageway way, as a point and a unit direction."""
    best, best_len = None, 0.0
    for w in ways:
        g = [project(p["lat"], p["lon"]) for p in w.get("geometry", [])]
        if len(g) < 2:
            continue
        L = sum(math.dist(g[i], g[i + 1]) for i in range(len(g) - 1))
        if L > best_len:
            best, best_len = g, L
    if not best:
        return None
    a, b = best[0], best[-1]
    dx, dz = b[0] - a[0], b[1] - a[1]
    L = math.hypot(dx, dz)
    return a, (dx / L, dz / L)


def build_bridge(land):
    path = os.path.join(RAW, "bridge.json")
    if not os.path.exists(path):
        print("  brooklyn bridge       : no extract, skipped")
        return None
    els = json.load(open(path))["elements"]
    ways = [e for e in els if e.get("tags", {}).get("highway")]
    axis = _bridge_axis(ways)
    if not axis:
        return None
    (ax, az), (ux, uz) = axis

    def at(s):
        return (ax + ux * s, az + uz * s)

    # Where the axis leaves one shore and meets the other.
    rings = [l["p"] for l in land]
    wet = []
    for i in range(-600, 1400):
        x, z = at(i)
        wet.append(not any(_point_in((x, z), r) for r in rings))
    edges = [i - 600 for i in range(1, len(wet)) if wet[i] != wet[i - 1]]
    if len(edges) < 2:
        print("  brooklyn bridge       : axis does not cross water, skipped")
        return None
    mid = (edges[0] + edges[-1]) / 2.0

    # The deck runs the whole length of what the extract covers.
    ends = []
    for w in ways:
        for p in (w["geometry"][0], w["geometry"][-1]):
            x, z = project(p["lat"], p["lon"])
            ends.append((x - ax) * ux + (z - az) * uz)
    s0, s1 = min(ends), max(ends)

    return {
        "a": [round(ax, 2), round(az, 2)],
        "u": [round(ux, 5), round(uz, 5)],
        "s0": round(s0, 1),
        "s1": round(s1, 1),
        "towers": [round(mid - MAIN_SPAN / 2, 1), round(mid + MAIN_SPAN / 2, 1)],
        "shore": [edges[0], edges[-1]],
    }


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
    land = build_land()
    bridge = build_bridge(land)
    if bridge:
        print("  brooklyn bridge       : span %.0f m, towers at %s"
              % (bridge["s1"] - bridge["s0"], bridge["towers"]))

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
        "plaza": {"p": [[x, z] for x, z in ccw(PLAZA_POLY)], "y": PLAZA_LEVEL,
                  "stairs": PLAZA_STAIRS},
        "land": land,
        "bridge": bridge,
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
