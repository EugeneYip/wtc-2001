# World Trade Center 2001

**A 3D reconstruction of the World Trade Center and Lower Manhattan.**

A browser-based 3D reconstruction of the World Trade Center and Lower
Manhattan in 2001.

**→ [wtc.eugeneyip.net](https://wtc.eugeneyip.net/)**

<sub>Also reachable at [eugeneyip.github.io/wtc-2001](https://eugeneyip.github.io/wtc-2001/), which redirects here.</sub>

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
ground where Greenwich Street now runs. Austin J. Tobin Plaza is raised 4.3 m
above street grade, walled at its edge, with Fritz Koenig's *Sphere* on its
fountain.

The deck is not a blank apron. Its granite was laid in courses struck from the
fountain, and that pattern is round, so it cannot come from a tiling map: it is
computed from the distance to the centre in the shader, which also clips it to
the deck for nothing. The Sphere stands on a plinth in a pool with a granite
kerb round it, rather than on the dark disc it used to sit on.

The towers' facade columns run on past the top floor as a parapet. That is what
gave them their hard upper edge, and what kept the roof plant out of sight from
below; cut off level with the deck, the roofline went soft and the mechanical
houses sat out in the open. The obstruction lights stand on the parapet.

Two flights climb to the deck, each in the only stretch of its frontage that
is not a building: a broad one from Liberty Street, centred on the South
Tower, and the Vesey Street stair on the north — the **Survivors' Staircase**,
which carried hundreds of people off the site on 11 September and was the last
original structure left standing above ground there, moved into the memorial
museum in 2008. It is modelled as it was, steps beside a bank of escalators,
on the line Greenwich Street would take through the site.

**Streets.** The OSM width is the whole right of way, so the carriageway is
narrowed and the remainder becomes pavement either side, with lane markings
down the middle and a gutter line at the kerb. A wide avenue is often several
parallel ways in the data, so asphalt is laid over pavement rather than beside
it — otherwise each way's pavement buries its neighbour's roadway. Lamp
standards line both sides, alternating, with a few more around the plaza deck.

**Traffic.** Which side of the centreline a vehicle sits on and which way it
faces are one decision, not two. They used to be taken separately — the side at
random, the heading always along the way — so half the cars in the city were in
the oncoming lane. Keeping right settles both.

The kerb lane is a continuous rank of parked cars, which is what a street down
here looks like and what the roadway was missing; without it the asphalt read
as an apron. Most of this grid is a nine or eleven metre right of way, which
after its pavements leaves five or six metres: one parking lane and one travel
lane, so those streets are parked one side only. The rank is dense inside a
radius and simply absent outside it, because a rank is only worth having if it
is continuous. Nothing parked is a cab. Among the moving traffic there are step
vans and buses as well as cars, and a slot may carry a second vehicle close
behind the first, because traffic bunches at the lights rather than spacing
itself evenly.

Junctions come free: OpenStreetMap splits ways where they meet, so the ends of
the ways *are* the junctions and no intersection test is needed. Every crossing
of two real streets gets painted crosswalks and a stop bar on each approach —
two transverse lines rather than the ladder bars that came later, which is what
nearly every crossing down here had in 2001 — and two diagonally opposite
corners get a signal on a mast arm, red on one axis and green on the other.
Hydrants and litter bins stand along the kerb, because without something
knee-high there is nothing in the frame between a lamp standard and a car and
the pavement reads as a blank apron.

**Parks.** The green was a single flat colour, which from the air read as
billiard cloth cut to shape rather than as ground — and it was the most
saturated thing in the frame, so the eye went to the parks before the city. The
grass is mown turf with worn ground showing through where it would: never one
colour anywhere.

The larger parks get a walk a few metres inside their boundary, following it
round. Nothing is routed: it is what the main walk in a small city park does
anyway, and it needs no more than the polygon already in the data. City Hall
Park and Battery Park are more path than lawn, and with none at all they were
just fields.

Foliage varies tree by tree, a little of it already turning in early September.

**Ground floors.** Every building used to run its upper-floor window grid
straight into the pavement, which is the one thing a street will not survive: a
street is read from its ground floor, and a ground floor is nothing like the
floors above it. It is taller, mostly glass, set behind a plinth and under a
fascia, and interrupted every few metres by a stone pier. So the bottom five
metres of every building tall enough to have a proper ground storey is a band
of its own, standing a hand's breadth proud of the wall behind — which is what
a base course does anyway. It is built by hand rather than extruded, because
the run along the perimeter has to be true arc length for the shopfront bays to
keep their width around a corner, and the tile has to be anchored at the
pavement so the plinth is always at the bottom.

**Around it.** 814 building footprints, the street grid, the Hudson and East
rivers and the harbour out to about fifteen kilometres, and the parks. Cesar Pelli's World Financial Center
towers with their dome and stepped-pyramid crowns, the Woolworth Building,
One Liberty Plaza, the Barclay-Vesey Building, and the Deutsche Bank Building
at 130 Liberty Street — damaged on 9/11 and since demolished, so re-added by
hand.

**Facades.** Roughness and metalness vary *within* a facade, not just between
buildings, so glass behaves like glass: dark head-on, where a dielectric
returns four per cent of what falls on it, and bright at a glancing angle
where it returns nearly all of it. Sharing one roughness between stone and
window meant every window in the city was a hole punched in a wall. Behind the
glass the rooms differ — blinds half down in one, a net curtain in the next,
an empty office after that — because a bay filled with a single colour reads
from the pavement as a luminous sticker.

Seven facade families cover 814 buildings, so each building also carries a
small tint of its own, seeded from its footprint. Without it a block of the
same class is one extruded mass in one colour; with it no two neighbours are
quite the same stone, which is the actual condition of a district built a few
buildings at a time over a century. Two buildings are too well known to leave
to that — the Woolworth and the American Surety, both clad in pale terracotta
rather than the brownstone around them — so they are given a facade family
instead of a tint, because multiplying a colour lightens it without ever
desaturating it.

**Relief.** The land across the rivers was a table — a flat plane meeting the
sky in a ruled horizontal line, which no real shore does, and the eye files
that under mudflat rather than New Jersey.

The high ground is not invented. OpenStreetMap carries the named hills around
the harbour with real elevations on them — Todt Hill at 125 m, Battle Hill over
Green-Wood, Laurel Hill behind Secaucus — and the Palisades are mapped as a
cliff line. Those put hills where the hills are. Between them the ground
undulates gently, and that part carries no claim; it is kept modest on purpose,
because the near shores of this harbour really are low and flat and giving
Jersey City a mountain range would be a worse lie than the table it replaces.

It is a separate surface laid a couple of centimetres over the flat land rather
than a displacement of it. The coastline is the most carefully built thing in
this model and is accurate to a few metres; a grid coarse enough to afford
would have chewed it up. So the height ramps to nothing before it reaches the
water, and the last few hundred metres of every shore are still the exact flat
ground underneath. From a low camera the effect is small, and correctly so: a
coastal plain seen from ninety metres up really does present an almost straight
horizon. From the towers, where you look down on the land, it is the difference
between terrain and a plate.

**The shoreline.** OpenStreetMap maps tidal water as `natural=coastline`, not
as water polygons, so the model is built the way the data is: the world is
sea, and land is drawn on top of it, assembled from the coastline itself.
That is what gives Manhattan its real outline — the taper to the Battery, the
pier fingers, the bulkhead lines — along with Governors Island, Liberty
Island, and the Jersey and Brooklyn waterfronts with their slips.

A shelf of paler water runs off every shore, fading out across its width. It
used to be a band of constant colour, which meant it had an outer edge as hard
as its inner one: from the air that second edge drew a bright turquoise line
round every coast, pier and island, and the harbour read as a map with its
borders highlighted. The land beyond the mapped blocks carries a street grain,
masked by the same noise that decides what is built up. Without it, soft
mottling on a flat plane read from a distance as a bank of low cloud rather
than as Jersey City — but it is a grain and not a plan, and no buildings are
invented on it.

**The Brooklyn Bridge.** Its Manhattan end is a kilometre east of the site and
it closes every view up the East River; without it that side of the model
stopped at a bare bulkhead. The plan is from OpenStreetMap — the carriageway
ways give the axis, and the coastline gives the two banks the axis crosses —
and the section is from published figures for Roebling's bridge, the same way
the towers are done. The towers are placed by putting the documented 1,595 ft
6 in main span symmetrically about the middle of the channel, which lands each
one about forty metres off its own bank, where they stand. The two Gothic
openings in each tower are pierced geometry, as the arcade at the foot of the
Twin Towers is.

**Light and water.** The sun is placed from real solar geometry for 40.71° N
on 11 September, so shadow directions through the day are the ones the site
actually had. It is drawn by the Mie term of the sky model, and the asymmetry
of that scattering lobe is what sets the size of the disc: the default 0.82
gives something twenty degrees across that clips to white with a hard curved
edge where it falls out of range. A low sun through haze does read large, so
what is here is still not the half a degree the disc really subtends — but it
is a sun rather than a flare.

The sky carries no cloud, and that is deliberate rather than unfinished. The
morning this model is set on was exceptionally clear — the kind of visibility
pilots call severe clear — and it is one of the things people who were there
remember first. Putting weather in the sky would be a more elaborate model and
a less accurate one. Reflections come from a cube probe rendered over the site, so
the towers' aluminium and the surface of the river pick up the actual skyline
rather than just the sky.

**Shadows.** For a long time nothing smaller than a street lamp had one. A
car sat on the road like a sticker, and so did every hydrant, litter bin and
traffic signal in the city. Two separate faults, both of them measured rather
than guessed at.

The first was the depth bias. three.js takes it in normalised depth, so the
number means nothing on its own — it has to be read against the shadow
camera's near/far range, and across the 6800 m this one spanned, the -0.0004
sitting in the code was 2.7 m of slack. Anything shorter than that could not
put a shadow on the ground it stood on, and a car is 1.5 m tall. The companion
setting, normalBias, is in world units and was 1.1: about two shadow-map
texels, which erodes a shadow by a metre and a half in raking light. Between
them they erased everything at street level. The bias is now written in metres
and converted, and normalBias is tied to the texel footprint it actually has
to cover, so it tracks the frustum as that widens through the day.

The second was simpler and worse. Every vehicle, lamp post, signal, hydrant,
bin, tree trunk and boat was set to *cast* shadows and never to *receive*
them. Most of these streets are in the shade of something for most of the day,
so the result was a city of brightly sunlit cars parked in shadow. Turning
receiving on costs nothing measurable — these things cover very few pixels —
and it is the single change in this pass you are most likely to notice.

Together the two are worth about 11% of the pixels in a mid-afternoon street
view.

Nothing switches at sunset. Direct sunlight is extinguished through the last
couple of degrees above the horizon rather than being turned off at it, and
every night setting — sky, ambient, exposure, haze, bloom, the colour of the
water — crossfades across civil twilight. Drag the slider through 19:07 and
the light goes out the way it goes out.

Haze takes a gentler dose of the sunset than the ambient light does. Given the
full sun-side colour it came out more saturated than the sky it was supposed to
be dissolving into, and drew a salmon bar along the horizon wherever the far
shore reached the fog limit — worst of all looking *away* from the sun, where
the sky is muted and the bar was not.

The rivers are modelled as a dielectric rather than a metal, which is what
gives water its behaviour: its own dark blue-green looking down, turning to a
sky mirror at grazing angles. Two normal maps drift across each other at
different scales and headings — one layer alone only slides, two beating
against each other read as chop — over a varying roughness map, because real
water is never uniformly glassy. A paler shelf runs off every shoreline.

Tugs, ferries and barges work the harbour, and they *work* it: each one runs
its channel on a sinusoid, so it slows, turns and gathers way again at the ends
rather than snapping round, and the wake shortens as it loses speed. They used
to be baked in place — a fleet of boats sitting perfectly still, each with a
permanent wake claiming a speed it plainly did not have. After dark the hulls
disappear into the water and all that is left is a masthead light each, which
is all a working boat is at a mile.

![The Twin Towers at twilight from the East River](assets/night.jpg)

**After dark.** The night sky is a second dome that fades in over the daytime
one, which the Preetham model cannot do: push its sun below the horizon and it
turns a muddy brown. This one carries a gradient darkest overhead, the sodium
dome of the city's own light hugging the horizon the whole way round, the warm
arch left in the sun's quarter of the sky, and about as many stars as Lower
Manhattan actually shows.

Lit windows fall off from ceiling to sill and are divided by mullions, because
a flat rectangle of colour reads from the pavement as a luminous sticker
rather than a room. Most shops are lit, some with an illuminated fascia over
them: at street level after dark the ground floor is the brightest thing on the
block, and with it dark there was a band of pitch black under every building
while the offices above glowed. The Brooklyn Bridge carries its necklace — the
lamps strung from the main cables — and a row down each side of the roadway;
unlit it was a black cut-out across a river carrying the whole city's light.
A park is not lit, but it is not a hole in the city either: enough on the grass
to separate it from the buildings round it, and more on the walks, so they read
as the lit thing in a dark park. Street lighting is two things at once: the lamp heads
themselves, and the pools they throw, painted once into a world-space texture
the road, pavement and plaza materials read. An even glow over every paved
surface gets the streets right from the air and is unmistakably wrong at eye
level, where light comes in pools with darkness between them. Cars carry
headlights and tail lamps; both towers carry red obstruction lights at their
roof corners, and the mast tip flashes.

## Controls

Six viewpoints, a time-of-day slider, and free orbit with the mouse or a
finger. Keys **1**–**6** jump between viewpoints and **L** toggles the labels.

**The ground-level viewpoints.** For most of this model's life the two most
important buttons on the panel did not work. "On the plaza" put the camera
322 m in the air and "Street level" put it at 178 m — both of them level with
the thing they were supposed to be looking up at.

The cause was one line. OrbitControls measures its `maxPolarAngle` from the
target, so a fixed value means "never get below the thing you are looking at".
That is a perfectly good rule while the target is a building seen from across
the river, and quite wrong the moment the target is 320 m up a tower: it makes
standing at the bottom and looking up the one thing the camera cannot do. What
was actually wanted is "never get below the pavement", which depends on how
high the target is and how far away the camera is, so it is now worked out
every frame rather than fixed once.

Because neither view had ever been visible, neither had ever been aimed. The
street camera had a facade 38 m in front of it and filled the frame with a
wall of windows; the plaza camera stood inside the South Tower's own footprint,
which is why the sky above it was a black ceiling. Both have been re-placed.

Two smaller things in the same pass. Dragging during a viewpoint flight used to
fight it — the flight kept pulling for its full 1.7 seconds — and the highlight
stayed on a viewpoint button long after you had orbited somewhere else, so the
panel claimed you were somewhere you were not. Taking hold of the camera now
cancels the flight and clears the highlight.

**Reaching it from a keyboard.** There was no focus indicator anywhere, and the
time slider explicitly removed the one the browser supplies. The grip that opens
the panel on a phone carried `role="button"` and `tabindex="0"` — a promise that
a keyboard can work it — with nothing listening for a key. The About panel
called itself `aria-modal` while leaving focus outside it and the page behind it
tabbable. The viewpoint buttons carried no pressed state, and the time slider
read out as "17.35" rather than as a time. All of that is fixed; none of it was
visible on screen, which is presumably why it lasted.

The reader's motion preference is honoured too: with `prefers-reduced-motion`
set, the viewpoint buttons cut straight to the view instead of flying, and the
loader and panel stop animating.

**One hitch.** Turning shadows off changes the shader every material in the
scene compiles to, and the first tick of that checkbox froze the tab for the
better part of a second. `renderer.compile()` does not fix it on its own: the
driver defers the link until a program is actually drawn with, so the cost just
moves to the first frame after the switch. Drawing one frame in each state does
fix it — but it has to be a frame through the post-processing chain, because
rendering straight to the canvas applies tone mapping and rendering into the
composer's target does not, and that is part of the shader cache key. Warming
the wrong path bought nothing. It now happens on the first idle callback after
the model appears, so it costs nothing on the way in, and the checkbox responds
in about 16 ms instead of 900.

## Labels and type

**Only ever one tower.** The two labels that matter most collided: the towers
stand 40 m apart with 2 m between their roofs, so at any real distance their
two chips want the same piece of screen, and the declutterer dropped one. From
the Hudson you got 1 WTC. From the East River you got 2 WTC. From the air you
got 2 WTC. In a model of two buildings, never both. A label that loses its spot
now tries a couple of rungs higher before it gives up, and they stack.

**Labels for things you cannot see.** A label appeared whenever its anchor fell
inside the view frustum, whether or not the building was actually in sight.
From street level six of the nine labels on screen were naming towers standing
behind the facade in front of you.

Asking the scene with a raycast costs 3.2 ms per label against the merged city
meshes — nine of those is a whole frame and then some. Instead there is a grid
of building bounding boxes, and the line of sight is walked through it: the
label is dropped if anything tall enough crosses in front. It only has to be
right about whether something solid is in the way, so boxes are enough, and
being slightly too eager only hides a label rather than inventing one. Measured
at 0.0007 ms a call — about 0.016 ms for the whole set, which is nothing.

Worth recording that I nearly optimised this for no reason. A first timing said
the label pass cost 2.3 ms a frame, so I amortised the occlusion test across
frames; a second run of the same measurement said 4.8 ms, which made no sense.
Timing the algorithm on its own gave 0.0007 ms. The millisecond figures were
DOM and harness noise, the amortisation was solving nothing, and it went back
out again.

**Three smaller things.** Labels were positioned at fractional pixels, so the
text was resampled every frame and shimmered as the camera moved; they now
land on the device pixel grid. The distance fade ran the whole way from the
camera to the cutoff, so a label at half range sat at 0.4 opacity and took its
own backing panel down with it — grey text on a grey city — where it now stays
solid until it is nearly out of range. And they were switched with `display`,
so a label that lost a collision for a single frame blinked; they cross-fade
now.

**Type.** The About panel was set 90 characters to the line, half again the
width the eye tracks comfortably, and it is the only place here with real prose
in it. Capped by measure rather than by narrowing the card, so the headings and
the dedication keep their width. One trap: `ch` is the width of a zero, which
in this face runs about a fifth wider than the average letter, so `56ch` is
what lands at 67 characters.

Measurements no longer break across lines — `417 m`, `208 × 208 ft`,
`sun 42°` and the rest carry non-breaking spaces, so a number and its unit stay
together.

## Loading

The model took about ten seconds to build. Nearly six of those were one
mistake made twice.

Asking "is this point on land?" by walking a polygon is fine for a building
footprint and ruinous for a coastline. The two big coast rings here carry 2,116
and 1,511 points. The relief grid tested 21,609 points against all 5,680
coastline points — **123 million crossing tests, about four seconds.** And the
harbour traffic used the same footprint index the streets use, which buckets
whole polygons by their bounding box: for a coastline that box covers the
harbour, so every water test walked the entire shoreline. Placing 38 boats took
2.4 seconds.

Both now go through one scanline rasteriser. For each row of the grid, find
where the ring's edges cross it, sort the crossings, fill between them in
pairs: the same even-odd rule and the same answer, but each edge is visited
once per row instead of once per cell. The relief takes a mask straight from
it; the boats take a coarse one and look up.

| | before | after |
|---|---|---|
| `buildRelief` | 3,882 ms | 472 ms |
| `vessels` | 2,392 ms | 15 ms |

The relief geometry is identical — 33,548 triangles either way — and no boat
ends up aground, checked against the exact point-in-polygon test the mask
replaced.

**What is left is the dedication.** The loading screen is held a minimum of
five seconds on purpose, so that what it says can be read. Until now that
minimum never bound: the build always overran it, and the last line — the date
— appeared for a moment before the screen faded. The build now finishes inside
the hold, so the dedication gets the few seconds it was always meant to have.
If that hold is not wanted it is one constant, `MIN_LOADER_MS`.

**Two things the loader was getting wrong.** The status line — the only thing
telling you what is happening — was set at 2.6:1 against its backdrop, under
half the contrast small text needs. And a failure left a small grey line under
two bars still cheerfully climbing, with nothing to do about it; it now says
so plainly, stops the bars, and offers to try again.

## Accuracy notes

Tower position and orientation are not estimated. The reflecting pools of the
9/11 Memorial are built on the original footprints, so their corner
coordinates give both the tower centres and the exact rotation of the
Manhattan street grid here — 29.11° east of true north. The two towers come
out offset diagonally by 67.0 m east and 103.8 m south, which leaves the
documented ~130 ft gap between their facing walls as an independent check
that was never fed into the calculation.

Six things are deliberately not raw OpenStreetMap:

1. **Post-2001 buildings are removed** — the modern WTC site, and the towers
   that filled in the Financial District and Battery Park City between 2002
   and 2024. Standing One World Trade Center next to the Twin Towers would be
   incoherent. Removal uses the OSM `start_date` tag where present, plus an
   explicit list in [`build/build_scene.py`](build/build_scene.py).
2. **Some heights are corrected.** OSM records the World Financial Center at
   its retail podium height, which would extrude into a 140 m wide slab.
   Those buildings are modelled as a podium, a slender tower, and a crown.
3. **Demolished buildings are added back**, in local grid coordinates.
   The two plaza flights are reconstructions rather than surveyed: they are
   placed and proportioned to read correctly, and this model holds every
   street at one level, where Lower Manhattan in fact slopes — the grade at
   the north-east of the site was not the grade at Liberty Street.
4. **Roof clutter, street trees, street lamps, signals, hydrants, bins,
   traffic, parked cars, park paths, harbour vessels and every shopfront are
   invented.** They are
   placed from a fixed seed for plausibility, not from survey, and tested
   against every building footprint, or against the coastline, so nothing
   grows through a wall, parks inside one, or runs aground. Water tanks, stair
   bulkheads, plane trees and lamp standards are what those roofs and streets
   had; their exact positions are not claimed. The ground floors are the
   furthest from survey of anything here: there is no record in the data of
   what occupied any given one, so what is modelled is the *kind* of thing a
   ground floor is — glazing, piers, a fascia — and not one real shop.
   The land across the rivers is generic mottling for the same reason — there
   is no data behind it, so it stays deliberately vague rather than inventing
   a Jersey City skyline.
5. **A few buildings are recoloured by name.** The facade family a building
   gets is chosen from its height and footprint, which cannot know what it is
   clad in. Four are corrected by hand, and the Woolworth's copper pyramid is
   given copper. Everything else takes what its class gives it.
6. **The city's light on the water is painted, not reflected.** None of it
   survives the reflection probe: a skyline of lit windows averages away to
   nothing in a 256 px cube run through a blur. So building footprints and
   land are rasterised into a small world-space mask, blurred, and read by the
   water shader, which breaks the result up on the chop. The Manhattan bank
   comes out bright and the far shore faint because of where the buildings
   are, not because anyone decided it — but it is an approximation of a
   reflection, not one. It carries no image of what is above it.

Background buildings with no height in OSM get a deterministic estimate from
their id and footprint area, so the fabric varies instead of reading as one
uniform slab. Those are massing, not survey.

## Performance

About 173 draw calls and 1.05M triangles in daylight, and roughly 2 to 3 ms a
frame on an M2 at 2800 × 1800 once shaders are warm, with the post-processing
running at full resolution and 4x multisampling.

Earlier versions of this file claimed well under a millisecond at that size.
That was wrong, and worth saying plainly: those numbers were taken on a machine
reporting a device pixel ratio of 1, so the effect composer had built its
target at 1400 x 900 and the scene was never rendering at the resolution the
figure quoted. Timing here is measured with a GPU sync — a browser will
otherwise report its own compositor rather than the frame — and even then the
spread between runs is wide enough that these are round numbers, not precise
ones.

Night is cheaper in draw calls than day: with the sun below the horizon there
is no shadow pass. Detail scales automatically: phones get a smaller shadow
map, no bloom, fewer cars, fewer lamps and a tighter radius of parked ones;
desktops get the full set. The preset in use is shown in the panel.

## Layout

```
index.html            the site
wtc.html              the same thing inlined into one file
src/
  main.js             renderer, sun, camera rig, UI
  bridge.js           the Brooklyn Bridge
  terrain.js          relief on the far shores
  wtc.js              the towers, the complex, the plaza
  city.js             footprint extrusion, crowns, streets, water
  nightsky.js         the twilight and night dome
  textures.js         procedural facade, roof, plaza and water textures
  details.js          roof clutter, trees, traffic, street lamps
  geo.js              shared geometry helpers
build/
  fetch_osm.py        re-download the OSM extracts
  build_scene.py      raw/ -> data/city.json, holds the curation tables
  bundle.py           inline everything -> wtc.html
raw/                  cached Overpass responses
  buildings/roads/      the extracts the build actually reads
  water/green.json
  bridge.json           the Brooklyn Bridge carriageway, outside the
                        building box but inside the view
  relief.json           named hills with elevations, and the Palisades
  coast.json            the coastline, which defines where land is
  pools_geom.json       memorial pool corners — the source of the
                        tower positions and the grid rotation
  mem.json              memorial-area feature dump, for reference
data/city.json        generated scene data
vendor/               three.js r160
assets/
  preview.jpg           social preview image
  night.jpg             the same skyline after dark
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
