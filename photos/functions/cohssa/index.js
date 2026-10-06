/**
 * GET /cohssa/: COHSSA's section, its albums holding an approved photo,
 * newest first (#227). lib/section-route.js holds the route.
 */
import { sectionRoute } from '../../lib/section-route.js';

export const { onRequestGet, onRequestHead } = sectionRoute('cohssa');
