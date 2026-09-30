import proj4 from "proj4";

/**
 * WGS84 degrees `[longitude, latitude]` to EPSG:3006 metres with `forward`, and back with `inverse`.
 * proj4 knows only EPSG:4326 and EPSG:3857 by name, so EPSG:3006 is spelled out.
 */
export const sweref = proj4("EPSG:4326", "+proj=utm +zone=33 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs");
