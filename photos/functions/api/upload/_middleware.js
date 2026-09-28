/**
 * Every route under /api/upload/ passes this guard first (#150): no valid
 * upload session, no upload. lib/session.js says what valid means.
 *
 * A route that uploads anything belongs under functions/api/upload/, where
 * it cannot miss this file. test/guard.test.js calls every Function route
 * that is not declared public with a missing, tampered, earlier-generation
 * and expired cookie, and fails for any that answers other than 401.
 */
import { requireUploadSession } from '../../../lib/session.js';

export const onRequest = requireUploadSession;
