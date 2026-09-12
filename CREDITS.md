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
  Street and Vesey Street flights up to the deck
- 7 World Trade Center as built in 1987
- The Deutsche Bank Building at 130 Liberty Street, demolished 2007–2011
- Height and massing corrections for the World Financial Center, the
  Woolworth Building and the Barclay-Vesey Building

Roof clutter, street trees, traffic and the harbour vessels are procedurally
placed for plausibility and are not survey data.
