import proj4 from "proj4";

/**
 * Converts WGS84 degrees (longitude, latitude) to SWEREF 99 TM, EPSG:3006, the Swedish national grid in metres,
 * with `forward`, and back with `inverse`. proj4 only knows EPSG:4326 and EPSG:3857 by itself.
 */
export const sweref = proj4("EPSG:4326", "+proj=utm +zone=33 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs");
