import { isUuid, uuidFromPublicId, uuidToHex, type Uuid } from "@saas/db/ids";

export function generateRequestId(): string {
  const buf = new Uint8Array(12);
  crypto.getRandomValues(buf);
  let hex = "";
  for (let i = 0; i < buf.length; i++) hex += buf[i]!.toString(16).padStart(2, "0");
  return `req_${hex}`;
}

export const orgPublicId = (uuid: string): string => `org_${uuidToHex(uuid)}`;
export const parseOrgPublicId = (id: string): Uuid | null => uuidFromPublicId(id, "org");

/** A pay check: the audit subject in RW1, a stored row from RW2. */
export const checkPublicId = (uuid: string): string => `rwc_${uuidToHex(uuid)}`;
export const parseCheckPublicId = (id: string): Uuid | null => uuidFromPublicId(id, "rwc");

/**
 * The actor id in the shape a UUID column takes: pass a UUID through, decode a
 * `usr_<hex>` public id, and write null rather than garbage for anything else.
 */
export function actorSubjectUuid(subjectId: string): string | null {
  if (isUuid(subjectId)) return subjectId;
  return uuidFromPublicId(subjectId);
}
