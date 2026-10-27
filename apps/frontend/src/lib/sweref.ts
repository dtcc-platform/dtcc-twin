import proj4 from "proj4";

/**
 * WGS84 degrees `[longitude, latitude]` to EPSG:3006 metres with `forward`, and back with `inverse`.
 * proj4 doesn't know EPSG:3006 by name, so it is spelled out.
 */
export const sweref = proj4("EPSG:4326", "+proj=utm +zone=33 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs");
