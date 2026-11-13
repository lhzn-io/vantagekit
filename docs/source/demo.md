# Demo

**<a href="demo/index.html">Open the live demo</a>** (mouse, keyboard, gamepad or touch).

The demo shows Montauk Point, Long Island: a 9.1 by 6.0 km topobathymetric grid at 3.8 m from
NOAA survey data, served for the demo by [data.lhzn.io](https://data.lhzn.io). The Scene menu
also offers an invented coastline built in the page with no data service. The side panel lists
the sources, the bindings, and the live range, meters per pixel, bearing and pitch.

URL parameters:

| Parameter | Effect |
|---|---|
| `?mode=fly` | starts in fly mode |
| `?pivot=fixed` | fixes the orbit pivot |
| `?scene=invented` | opens the invented coastline |
| `?dem=<url>` | loads another grid in the format data.lhzn.io documents (for example a local copy) |

A <a href="demo/maplibre.html">MapLibre demo</a> shows the same keys and fly mode on a MapLibre GL
JS map.

The demo pages are in the repository's
[demo](https://github.com/lhzn-io/vantagekit/tree/main/demo) folder and import the modules from
the same site, so they run the version of vantagekit these pages document.
