#!/usr/bin/env python3
"""
Re-download the OpenStreetMap extracts in raw/.

The checked-in copies are enough to rebuild the scene, so this only needs
running to refresh them. The public Overpass instances are often busy and
answer with an HTML error page instead of JSON, so each query is retried
across mirrors.

    python3 build/fetch_osm.py            # all three extracts
    python3 build/fetch_osm.py buildings  # just one

OpenStreetMap data is © OpenStreetMap contributors, licensed ODbL.
"""

import os
import sys
import time
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "raw")

ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]

# Lower Manhattan around the WTC site: City Hall down to the Battery,
# the Hudson across to the East River.
BBOX = "40.7048,-74.0205,40.7185,-74.0045"
# Water needs a far wider box than the buildings. The Hudson, East River and
# Upper Bay are single large multipolygons, and wherever the extract stops the
# shoreline ends in a dead straight line. This box reaches roughly 15 km out,
# past the fog limit, so that edge is never visible.
WATER_BBOX = "40.58,-74.20,40.84,-73.83"

QUERIES = {
    "buildings": """[out:json][timeout:120];
        (way["building"](%s);
         relation["building"](%s););
        out geom;""" % (BBOX, BBOX),

    "roads": """[out:json][timeout:120];
        (way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street|pedestrian|footway|service)$"](%s););
        out geom;""" % (BBOX,),

    "water": """[out:json][timeout:150];
        (way["natural"="water"](%s);
         relation["natural"="water"](%s);
         way["natural"="coastline"](%s););
        out geom;""" % (WATER_BBOX, WATER_BBOX, WATER_BBOX),

    "green": """[out:json][timeout:120];
        (way["leisure"="park"](%s);
         way["landuse"~"grass|forest"](%s););
        out geom;""" % (BBOX, BBOX),
}


def fetch(name, query, attempts=3):
    body = urllib.parse.urlencode({"data": query}).encode()
    for attempt in range(attempts):
        for url in ENDPOINTS:
            try:
                req = urllib.request.Request(
                    url, data=body,
                    headers={"User-Agent": "wtc-model/1.0 (OSM extract for a 3D model)"})
                with urllib.request.urlopen(req, timeout=180) as r:
                    data = r.read()
            except Exception as e:                      # noqa: BLE001
                print("    %s -> %s" % (url.split("/")[2], e))
                continue
            if not data.lstrip().startswith(b"{"):
                print("    %s -> busy (HTML error page)" % url.split("/")[2])
                continue
            dest = os.path.join(RAW, name + ".json")
            with open(dest, "wb") as f:
                f.write(data)
            print("    %s -> %s (%.1f KB)" %
                  (url.split("/")[2], os.path.basename(dest), len(data) / 1024.0))
            return True
        if attempt < attempts - 1:
            print("    all mirrors busy, waiting 30s")
            time.sleep(30)
    return False


def main():
    os.makedirs(RAW, exist_ok=True)
    wanted = sys.argv[1:] or list(QUERIES)
    failed = []
    for name in wanted:
        if name not in QUERIES:
            raise SystemExit("unknown extract %r; choose from %s"
                             % (name, ", ".join(QUERIES)))
        print("fetching %s" % name)
        if not fetch(name, QUERIES[name]):
            failed.append(name)
    if failed:
        raise SystemExit("failed: %s (existing raw/ files left untouched)"
                         % ", ".join(failed))
    print("\ndone — now run: python3 build/build_scene.py")


if __name__ == "__main__":
    main()
