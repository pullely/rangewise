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
