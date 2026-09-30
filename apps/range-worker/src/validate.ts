import { checkPublicUrl } from "./fetch-ad.js";
import type { WatchedAdEdit, WatchedAdRow } from "@saas/db/range";
import {
  PAY_CHECK_AD_MAX,
  PAY_CHECK_EMPLOYEES_MAX,
  PAY_CHECK_LOCATIONS_MAX,
  RANGE_REMOTE_AREAS,
  isLocationCode,
  type RangeRemoteArea,
} from "@saas/contracts/range";

export interface ValidCheck {
  title: string;
  adText: string;
  locations: string[];
  remote: RangeRemoteArea;
  employeeCount: number;
  checkDate: string;
}

export type Validation<T> = { valid: true; value: T } | { valid: false; fields: Record<string, string[]> };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function shiftYears(date: string, years: number): string {
  return `${String(Number(date.slice(0, 4)) + years).padStart(4, "0")}${date.slice(4)}`;
}

/** Validate a POST …/pay-checks body. `today` bounds checkDate to ±5 years. */
export function validateCheckBody(body: unknown, today: string): Validation<ValidCheck> {
  const fields: Record<string, string[]> = {};
  const add = (k: string, msg: string): void => {
    (fields[k] ??= []).push(msg);
  };
  if (!body || typeof body !== "object" || Array.isArray(body)) return { valid: false, fields: { body: ["Expected a JSON object"] } };
  const b = body as Record<string, unknown>;

  let title = "";
  if (b.title !== undefined && b.title !== null) {
    if (typeof b.title !== "string") add("title", "Must be a string");
    else if (b.title.trim().length > 200) add("title", "At most 200 characters");
    else title = b.title.trim();
  }

  let adText = "";
  if (typeof b.adText !== "string" || b.adText.trim().length === 0) add("adText", "Required: the text of the job ad");
  else if (b.adText.length > PAY_CHECK_AD_MAX) add("adText", `At most ${PAY_CHECK_AD_MAX} characters`);
  else adText = b.adText;

  let locations: string[] = [];
  if (b.locations !== undefined) {
    if (!Array.isArray(b.locations)) add("locations", "Must be an array of location codes");
    else if (b.locations.length > PAY_CHECK_LOCATIONS_MAX) add("locations", `At most ${PAY_CHECK_LOCATIONS_MAX} locations`);
    else {
      const normalised = b.locations.map((l) => (typeof l === "string" ? l.trim().toUpperCase() : ""));
      const bad = normalised.filter((l) => !isLocationCode(l));
      if (bad.length) add("locations", `Unknown location code(s): ${bad.map((x) => x || "(empty)").join(", ")}. Use US-XX (a state or DC), EU, or EU-XX (a member state).`);
      else locations = [...new Set(normalised)];
    }
  }

  let remote: RangeRemoteArea = "none";
  if (b.remote !== undefined && b.remote !== null) {
    if (typeof b.remote !== "string" || !(RANGE_REMOTE_AREAS as readonly string[]).includes(b.remote)) add("remote", `One of ${RANGE_REMOTE_AREAS.join(", ")}`);
    else remote = b.remote as RangeRemoteArea;
  }
  if (!fields.locations && !fields.remote && locations.length === 0 && remote === "none") {
    add("locations", "Name at least one location, or say where the role can be done remotely");
  }

  let employeeCount = 0;
  if (typeof b.employeeCount !== "number" || !Number.isInteger(b.employeeCount)) add("employeeCount", "Required: the employer's headcount, a whole number");
  else if (b.employeeCount < 1 || b.employeeCount > PAY_CHECK_EMPLOYEES_MAX) add("employeeCount", `Between 1 and ${PAY_CHECK_EMPLOYEES_MAX}`);
  else employeeCount = b.employeeCount;

  let checkDate = today;
  if (b.checkDate !== undefined && b.checkDate !== null) {
    if (typeof b.checkDate !== "string" || !isRealDate(b.checkDate)) add("checkDate", "An ISO date, YYYY-MM-DD");
    else if (b.checkDate < shiftYears(today, -5) || b.checkDate > shiftYears(today, 5)) add("checkDate", "Within five years of today");
    else checkDate = b.checkDate;
  }

  if (Object.keys(fields).length) return { valid: false, fields };
  return { valid: true, value: { title, adText, locations, remote, employeeCount, checkDate } };
}

// ── RW3: saved ads ───────────────────────────────────────────────────────────


export interface ValidWatch {
  title: string;
  sourceKind: "text" | "url";
  adText: string;
  sourceUrl: string | null;
  locations: string[];
  remote: RangeRemoteArea;
  employeeCount: number;
}

function urlField(value: unknown, fields: Record<string, string[]>): string | null {
  if (typeof value !== "string" || value.trim() === "") {
    (fields.sourceUrl ??= []).push("A public https:// careers-page URL");
    return null;
  }
  if (value.length > 2048) {
    (fields.sourceUrl ??= []).push("At most 2048 characters");
    return null;
  }
  const verdict = checkPublicUrl(value);
  if (!verdict.ok) {
    (fields.sourceUrl ??= []).push(verdict.reason);
    return null;
  }
  return verdict.url.toString();
}

/** POST …/watched-ads: exactly one of `adText` and `sourceUrl`, plus the check facts. */
export function validateWatchCreate(body: unknown, today: string): Validation<ValidWatch> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { valid: false, fields: { body: ["Expected a JSON object"] } };
  const b = body as Record<string, unknown>;
  const fields: Record<string, string[]> = {};
  const hasText = b.adText !== undefined && b.adText !== null;
  const hasUrl = b.sourceUrl !== undefined && b.sourceUrl !== null;
  if (hasText === hasUrl) fields.source = ["Give exactly one of adText (the pasted ad) and sourceUrl (a public careers page)"];
  const sourceUrl = hasUrl ? urlField(b.sourceUrl, fields) : null;
  const rest = validateCheckBody({ ...b, adText: hasUrl ? "(fetched at each scan)" : b.adText, checkDate: undefined }, today);
  if (!rest.valid) Object.assign(fields, rest.fields);
  if (Object.keys(fields).length || !rest.valid) return { valid: false, fields };
  const v = rest.value;
  return {
    valid: true,
    value: { title: v.title, sourceKind: hasUrl ? "url" : "text", adText: hasUrl ? "" : v.adText, sourceUrl, locations: v.locations, remote: v.remote, employeeCount: v.employeeCount },
  };
}

/** PATCH …/watched-ads/{rwa}: any of the fields; a change to what is checked bumps the ad's revision (it is due again today). */
export function validateWatchUpdate(body: unknown, current: WatchedAdRow, today: string): Validation<{ edit: WatchedAdEdit; bump: boolean }> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { valid: false, fields: { body: ["Expected a JSON object"] } };
  const b = body as Record<string, unknown>;
  const fields: Record<string, string[]> = {};
  if (b.adText !== undefined && current.sourceKind === "url") fields.adText = ["This saved ad is read from its URL; change sourceUrl instead"];
  if (b.sourceUrl !== undefined && current.sourceKind === "text") fields.sourceUrl = ["This saved ad is pasted text; change adText instead"];
  const sourceUrl = b.sourceUrl !== undefined && current.sourceKind === "url" ? urlField(b.sourceUrl, fields) : null;
  if (b.active !== undefined && typeof b.active !== "boolean") fields.active = ["true or false"];
  const merged = {
    title: b.title !== undefined ? b.title : current.title,
    adText: current.sourceKind === "text" ? (b.adText !== undefined ? b.adText : current.adText) : "(fetched at each scan)",
    locations: b.locations !== undefined ? b.locations : current.locations,
    remote: b.remote !== undefined ? b.remote : current.remote,
    employeeCount: b.employeeCount !== undefined ? b.employeeCount : current.employeeCount,
  };
  const rest = validateCheckBody(merged, today);
  if (!rest.valid) Object.assign(fields, rest.fields);
  if (Object.keys(fields).length || !rest.valid) return { valid: false, fields };
  const v = rest.value;
  const edit: WatchedAdEdit = {};
  if (b.title !== undefined) edit.title = v.title;
  if (current.sourceKind === "text" && b.adText !== undefined && v.adText !== current.adText) edit.adText = v.adText;
  if (sourceUrl && sourceUrl !== current.sourceUrl) edit.sourceUrl = sourceUrl;
  if (b.locations !== undefined && JSON.stringify(v.locations) !== JSON.stringify(current.locations)) edit.locations = v.locations;
  if (b.remote !== undefined && v.remote !== current.remote) edit.remote = v.remote;
  if (b.employeeCount !== undefined && v.employeeCount !== current.employeeCount) edit.employeeCount = v.employeeCount;
  if (typeof b.active === "boolean") edit.active = b.active;
  const bump = edit.adText !== undefined || edit.sourceUrl !== undefined || edit.locations !== undefined || edit.remote !== undefined || edit.employeeCount !== undefined;
  return { valid: true, value: { edit, bump } };
}
