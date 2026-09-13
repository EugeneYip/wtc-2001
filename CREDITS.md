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
- Height and massing corrections for the World Financial Center, the
  Woolworth Building and the Barclay-Vesey Building
- Cladding corrections for the Woolworth and American Surety buildings, which
  are pale terracotta rather than the brownstone their class would give them

Roof clutter, street trees, street lamps, traffic signals, hydrants, litter
bins, manhole covers, moving and parked traffic, the harbour vessels and their
courses, the walks inside the parks and every ground-floor shopfront are
procedurally placed for plausibility and are not survey data. The night sky
and the city's light on the water are rendering models, not observations: the
sky is a hand-written gradient with a skyglow term, and the light on the
rivers is read off a plan of where the buildings are, bounced off the water
along the mirror ray — so it lies in the right direction and falls off the
right way, but it is a reflection of a map and carries no image of any
particular building. Which shops are lit, and which have an illuminated
fascia, is drawn from a seed rather than from any record.
