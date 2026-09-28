/** Also how long a revoked session keeps working, since the guard never reads the session row. */
export const accessTokenLifetimeSeconds = 15 * 60;

/** Slides forward on every refresh, so only an idle session expires. */
export const sessionLifetimeSeconds = 30 * 24 * 60 * 60;
