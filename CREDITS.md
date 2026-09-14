# Credits

## Data

Building footprints, street centrelines, the coastline, water bodies and
parks are extracted from **OpenStreetMap** via the Overpass API. The land
masses — Manhattan, the islands in the harbour, and the Jersey and Brooklyn
shores — are assembled from the `natural=coastline` ways. © OpenStreetMap contributors,
licensed under the [Open Database License](https://www.openstreetmap.org/copyright).
The cached extracts in `raw/` and the derived `data/city.json` carry the same
licence.

Tower footprint position and the rotation of the street grid are derived from
the footprints of the National September 11 Memorial reflecting pools, which
are built on the original tower footprints, as mapped in OpenStreetMap.

Flags are placed from a fixed seed, not from any record of which buildings
flew one. Their size and proportions are the standard ones.

Liberty Island's outline, the eleven-pointed star of Fort Wood, the stack of
squares that is Richard Morris Hunt's pedestal and the positions of the
island's trees are all from OpenStreetMap. The direction the statue faces is
derived from the pedestal's own mapped faces rather than taken from a source:
they run on grid bearings 28 and 118, which leaves four possible normals, of
which one is seaward.

Ellis Island's outline, all fifty-one buildings on its two islands, the
covered corridors between the hospital pavilions, the seawalls, the 1986
service bridge to Liberty State Park and the positions of its trees are from
OpenStreetMap. None of those buildings carries a height in the data; the
heights are assigned in `build/build_scene.py` and are the curated part of it.

Governors Island's outline, its buildings, Fort Jay's star, Castle Williams —
which is mapped as a multipolygon, so its parade ground comes through as the
hole it is — the piers and the trees are all from OpenStreetMap, and most of
the buildings carry a surveyed height. What is curated is which of them stood
in 2001: the island has been a public park since 2003 and much of what is
mapped is later than that. The Coast Guard housing on the south half was
demolished between 2013 and 2016 and appears in no dataset, so the south end
of the island is emptier here than it was, and the trees on that half — planted
in 2014 — are thinned to a quarter.

Relief on the far shores is placed from the named hills around the harbour,
which OpenStreetMap carries with real elevations, and from the Palisades, which
it maps as a cliff line. The gentle undulation between them is invented.

## Software

- [three.js](https://threejs.org) r160 — MIT. Vendored under `vendor/`,
  including `OrbitControls`, `Sky`, `BufferGeometryUtils` and the
  post-processing passes from the three.js examples.

## Reconstructed by hand

The following are not from any dataset. They are modelled from published
dimensions and historic site plans, and any error in them is mine:

- 1 and 2 World Trade Center, including the facade column grid, the base
  arcade and the 1 WTC transmission mast
- 3, 4, 5, 6 World Trade Center and Austin J. Tobin Plaza, with the Liberty
  Street and Vesey Street flights up to the deck, the concentric granite
  courses struck from the fountain, and Fritz Koenig's *Sphere* on its pool
- 7 World Trade Center as built in 1987
- The Deutsche Bank Building at 130 Liberty Street, demolished 2007–2011
- The Brooklyn Bridge: plan from OpenStreetMap, section from published figures
  for the 1883 structure — 1,595 ft 6 in main span, 276 ft 6 in towers
- Fort Jay's section (1794): the star is traced in OpenStreetMap, but the
  glacis, ditch, scarp, parapet and terreplein are proportioned from what a
  bastioned earthwork of that size is, not measured. So is the height of
  Castle Williams' parapet above its surveyed 14.9 m wall
- Ellis Island's Main Building (Boring & Tilton, 1900): footprint from
  OpenStreetMap, three storeys to the cornice as the data says, and four
  copper-domed towers placed on the corners of the central pavilion, which are
  found from the steps in the traced outline. How high the towers go is
  proportioned against the cornice and not taken from any source. Every other
  height on the island is assigned from the storey counts the complex was
  built to, not measured, and every roof is lofted off its own footprint
  rather than surveyed
- The Statue of Liberty: plan from OpenStreetMap, dimensions from the National
  Park Service's published figures for the 1886 statue and pedestal — 305 ft
  1 in overall, 151 ft 1 in of copper on an 89 ft pedestal on a 65 ft
  foundation. The figure itself is lofted from cross sections and is a likeness
  at the distance she is looked at from, not a copy of Bartholdi's modelling;
  the face is a suggestion. The trees on her island are where OpenStreetMap has
  them now, which is not a 2001 survey — the beds were rearranged in 2019 — and
  the visitor buildings on it, all of which postdate 2001, are not modelled
- Height and massing corrections for the World Financial Center, the
  Woolworth Building and the Barclay-Vesey Building
- Cladding corrections for the Woolworth and American Surety buildings, which
  are pale terracotta rather than the brownstone their class would give them

Roof clutter, street trees, street lamps, traffic signals, hydrants, litter
bins, manhole covers, moving and parked traffic, the harbour vessels and their
courses, the walks inside the parks and every ground-floor shopfront are
procedurally placed for plausibility and are not survey data. So is every
facade: the window rhythm, the depth of the reveals and the weathering under
the sills are drawn from the family a building was assigned and a seed, not
from any photograph of that building. The night sky
and the city's light on the water are rendering models, not observations: the
sky is a hand-written gradient with a skyglow term, and the light on the
rivers is read off a plan of where the buildings are, bounced off the water
along the mirror ray — so it lies in the right direction and falls off the
right way, but it is a reflection of a map and carries no image of any
particular building. Which shops are lit, and which have an illuminated
fascia, is drawn from a seed rather than from any record.
