/**
 * n8ao ships a pass for the pmndrs postprocessing library beside the one for three.js and imports that
 * library's Pass class at the top of its bundle. Areo uses only the three.js pass, so the import is
 * pointed here (vite.config.ts) rather than pulling in a library whose release does not yet accept
 * this version of three.js.
 */
export class Pass {}
