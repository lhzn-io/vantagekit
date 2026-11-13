# View links

```text
?cv=1&cam=lon,lat,h,range,bearing,pitch
```

The orbit target (longitude and latitude to 6 decimals), its true height in meters (the scene
height divided by the exaggeration), the eye distance in rendered meters, and the look direction:
bearing in degrees clockwise from north, pitch in degrees from straight down. Scenes without an
origin write `cf=local` with east and north meters in place of longitude and latitude. Links
without `cv` are read as six scene-unit numbers (eye, then target) for older pages. The link is
rewritten (with `history.replaceState`) on the first still frame after the camera moves. Other URL
parameters and the hash are preserved; pages add their own through the `link.app` hook.

The codec is {js:func}`encodeCam <vantagekit.encodeCam>` and
{js:func}`decodeCam <vantagekit.decodeCam>` in the core module, and a controller reads and writes
links with {js:meth}`readLink <vantagekit-three.Vantage.readLink>`,
{js:meth}`applyLink <vantagekit-three.Vantage.applyLink>` and
{js:meth}`writeLink <vantagekit-three.Vantage.writeLink>`.
