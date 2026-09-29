/**
 * Every route under /api/albums/ passes the upload guard (#153): the albums a
 * parent can send to are for whoever holds the invite code, and nobody else.
 * lib/session.js says what a valid session is.
 *
 * test/guard.test.js calls every route here with a missing, tampered,
 * earlier-generation and expired cookie, and fails for any that answers
 * other than 401.
 */
import { requireUploadSession } from '../../../lib/session.js';

export const onRequest = requireUploadSession;
