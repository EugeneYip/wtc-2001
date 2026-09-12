# World Trade Center 2001

**A 3D reconstruction of the World Trade Center and Lower Manhattan.**

A browser-based 3D reconstruction of the World Trade Center and Lower
Manhattan in 2001.

**→ [eugeneyip.github.io/wtc-2001](https://eugeneyip.github.io/wtc-2001/)**

![The Twin Towers and Lower Manhattan from the Hudson River](assets/preview.jpg)

The Twin Towers and the neighbourhood around them as they stood in September
2001. The towers are reconstructed from published dimensions; everything
around them is real building footprint and street geometry from
OpenStreetMap, curated back to how the area looked that year.

> Twenty-five years on. In memory of everyone lost at the World Trade Center
> on 11 September 2001.

## Run it

Open the site above, or run it locally:

```bash
python3 -m http.server 8791
```

then open <http://127.0.0.1:8791/index.html>.

There is also `wtc.html` — the whole thing inlined into a single file, no
server and no network needed. Download it and open it directly.

Drag to orbit, scroll to zoom, right-drag to pan. Keys `1`–`6` jump between
viewpoints, `L` toggles labels. The slider moves the sun through the day. On
a phone or tablet the controls become a bottom sheet; drag the handle up.

## What's modelled

**The towers.** Not clad boxes — their appearance came almost entirely from
the facade, so that is what is modelled. Each tower carries 59 aluminium-clad
columns per face standing 0.36 m proud of the glass line, which is why they
read as solid silver from any oblique angle and showed their windows only
head-on. At the base each column forked into a three-storey "trident",
producing the pointed arcade at plaza level; that is pierced geometry, not a
texture. Mechanical floors (7–8, 41–42, 75–76, 108–110) read as solid bands,
and 1 WTC carries its 360 ft transmission mast, added in 1978.

| | |
|---|---|
| Footprint | 208 × 208 ft (63.40 m) |
| Column pitch | 3 ft 4 in (1.016 m) |
| 1 WTC roof | 1,368 ft (417.0 m), 110 floors |
| 1 WTC to mast tip | 1,728 ft (526.7 m) |
| 2 WTC roof | 1,362 ft (415.1 m), 110 floors |
| Gap between towers | 130 ft (40 m) |
| Site | 16 acres |

**The complex.** All seven buildings: the two towers, 3 WTC (the Marriott),
the low-rise 4, 5 and 6 WTC wrapping the plaza, and the original 47-storey
7 WTC north of Vesey Street — which stood east of its 2006 replacement, over
ground where Greenwich Street now runs. Austin J. Tobin Plaza is raised above
street grade, with Fritz Koenig's *Sphere* on its fountain.

**Around it.** 815 building footprints, the street grid, the Hudson and East
rivers and the harbour, and the parks. Cesar Pelli's World Financial Center
towers with their dome and stepped-pyramid crowns, the Woolworth Building,
One Liberty Plaza, the Barclay-Vesey Building, and the Deutsche Bank Building
at 130 Liberty Street — damaged on 9/11 and since demolished, so re-added by
hand.

**Light and water.** The sun is placed from real solar geometry for 40.71° N
on 11 September, so shadow directions through the day are the ones the site
actually had. Reflections come from a cube probe rendered over the site, so
the towers' aluminium and the surface of the river pick up the actual skyline
rather than just the sky.

The rivers are modelled as a dielectric rather than a metal, which is what
gives water its behaviour: its own dark blue-green looking down, turning to a
sky mirror at grazing angles. Two normal maps drift across each other at
different scales and headings — one layer alone only slides, two beating
against each other read as chop — over a varying roughness map, because real
water is never uniformly glassy.

## Accuracy notes

Tower position and orientation are not estimated. The reflecting pools of the
9/11 Memorial are built on the original footprints, so their corner
coordinates give both the tower centres and the exact rotation of the
Manhattan street grid here — 29.11° east of true north. The two towers come
out offset diagonally by 67.0 m east and 103.8 m south, which leaves the
documented ~130 ft gap between their facing walls as an independent check
that was never fed into the calculation.

Four things are deliberately not raw OpenStreetMap:

1. **Post-2001 buildings are removed** — the modern WTC site, and the towers
   that filled in the Financial District and Battery Park City between 2002
   and 2024. Standing One World Trade Center next to the Twin Towers would be
   incoherent. Removal uses the OSM `start_date` tag where present, plus an
   explicit list in [`build/build_scene.py`](build/build_scene.py).
2. **Some heights are corrected.** OSM records the World Financial Center at
   its retail podium height, which would extrude into a 140 m wide slab.
   Those buildings are modelled as a podium, a slender tower, and a crown.
3. **Demolished buildings are added back**, in local grid coordinates.
4. **Roof clutter, street trees and traffic are invented.** They are placed
   from a fixed seed for plausibility, not from survey. Water tanks, stair
   bulkheads and plane trees are what those roofs and streets had; their
   exact positions are not claimed. The land across the rivers is generic
   mottling for the same reason — there is no data behind it, so it stays
   deliberately vague rather than inventing a Jersey City skyline.

Background buildings with no height in OSM get a deterministic estimate from
their id and footprint area, so the fabric varies instead of reading as one
uniform slab. Those are massing, not survey.

## Performance

The scene is about 100 draw calls and 258k triangles, and renders in roughly
1.3 ms a frame on an M2 at 1078 × 1674 once shaders are warm. Detail scales
automatically: phones get a smaller shadow map, no bloom and fewer cars;
desktops get the full set. The preset in use is shown in the panel.

## Layout

```
index.html            the site
wtc.html              the same thing inlined into one file
src/
  main.js             renderer, sun, camera rig, UI
  wtc.js              the towers, the complex, the plaza
  city.js             footprint extrusion, crowns, streets, water
  textures.js         procedural facade, roof, plaza and water textures
  details.js          roof clutter, trees, traffic
  geo.js              shared geometry helpers
build/
  fetch_osm.py        re-download the OSM extracts
  build_scene.py      raw/ -> data/city.json, holds the curation tables
  bundle.py           inline everything -> wtc.html
raw/                  cached Overpass responses
  buildings/roads/      the extracts the build actually reads
  water/green.json
  pools_geom.json       memorial pool corners — the source of the
                        tower positions and the grid rotation
  mem.json              memorial-area feature dump, for reference
data/city.json        generated scene data
vendor/               three.js r160
assets/preview.jpg    social preview image
```

Rebuild after editing the curation tables or the viewer:

```bash
python3 build/build_scene.py && python3 build/bundle.py
```

`build/fetch_osm.py` re-downloads the source extracts; the checked-in copies
under `raw/` are enough to rebuild everything without network access.

## Coordinates

Metres in a local frame rotated onto the Manhattan grid: `+x` grid east
(toward Church Street), `+y` up, `+z` grid south (toward Liberty Street).
The origin is midway between the two tower centres. `data/city.json` carries
the origin latitude/longitude and grid rotation in its `meta` block, so the
geometry can be georeferenced back.

## Credits and licence

Building footprints, streets and water: © OpenStreetMap contributors,
licensed [ODbL](https://www.openstreetmap.org/copyright). The contents of
`raw/` and `data/city.json` are derived from that data and carry the same
licence.

Rendering with [three.js](https://threejs.org) r160 (MIT), vendored under
`vendor/`.

The code in this repository is MIT licensed — see [LICENSE](LICENSE).

Tower dimensions are from published figures for the Port Authority's
1966–1973 construction.
