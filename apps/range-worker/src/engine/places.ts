/**
 * Place names an ad uses to label a per-location range ("NYC: $120k–$150k;
 * Denver: $105k–$130k"), mapped to the location codes a check names. Places
 * outside the US and the EU map to `XX-<code>`, which no jurisdiction matches:
 * a "London: £60k" statement is scoped (so it is not read as the pay for
 * Colorado) without being any seeded jurisdiction's pay.
 */

const US_STATES: Record<string, string> = {
  Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR", California: "CA", Colorado: "CO", Connecticut: "CT",
  Delaware: "DE", Florida: "FL", Georgia: "GA", Hawaii: "HI", Idaho: "ID", Illinois: "IL", Indiana: "IN", Iowa: "IA",
  Kansas: "KS", Kentucky: "KY", Louisiana: "LA", Maine: "ME", Maryland: "MD", Massachusetts: "MA", Michigan: "MI",
  Minnesota: "MN", Mississippi: "MS", Missouri: "MO", Montana: "MT", Nebraska: "NE", Nevada: "NV",
  "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY", "North Carolina": "NC",
  "North Dakota": "ND", Ohio: "OH", Oklahoma: "OK", Oregon: "OR", Pennsylvania: "PA", "Rhode Island": "RI",
  "South Carolina": "SC", "South Dakota": "SD", Tennessee: "TN", Texas: "TX", Utah: "UT", Vermont: "VT",
  Virginia: "VA", Washington: "WA", "West Virginia": "WV", Wisconsin: "WI", Wyoming: "WY", "District of Columbia": "DC",
};

const US_CITIES: Record<string, string> = {
  "New York City": "NY", NYC: "NY", Manhattan: "NY", Brooklyn: "NY", Albany: "NY", Buffalo: "NY", Rochester: "NY",
  Denver: "CO", Boulder: "CO", "Colorado Springs": "CO", "Fort Collins": "CO",
  Seattle: "WA", Bellevue: "WA", Redmond: "WA", Tacoma: "WA", Spokane: "WA", Kirkland: "WA",
  "San Francisco": "CA", "Bay Area": "CA", "Los Angeles": "CA", "San Diego": "CA", "San Jose": "CA", Sacramento: "CA",
  Oakland: "CA", "Palo Alto": "CA", "Mountain View": "CA", "Silicon Valley": "CA", Irvine: "CA", SF: "CA",
  Minneapolis: "MN", "St. Paul": "MN", "Saint Paul": "MN", "Twin Cities": "MN",
  Baltimore: "MD", Bethesda: "MD", Rockville: "MD", Annapolis: "MD",
  "Washington, DC": "DC", "Washington, D.C.": "DC", "Washington DC": "DC", "Washington D.C.": "DC", "D.C.": "DC",
  "Jersey City": "NJ", Newark: "NJ", Hoboken: "NJ", Princeton: "NJ",
  Chicago: "IL", Boston: "MA", Cambridge: "MA", Honolulu: "HI", Burlington: "VT",
  Austin: "TX", Dallas: "TX", Houston: "TX", Atlanta: "GA", Miami: "FL", Phoenix: "AZ", Portland: "OR",
  Philadelphia: "PA", Pittsburgh: "PA", Detroit: "MI", Nashville: "TN", "Salt Lake City": "UT",
};

const EU_PLACES: Record<string, string> = {
  Germany: "DE", Berlin: "DE", Munich: "DE", München: "DE", Hamburg: "DE", Frankfurt: "DE", Cologne: "DE", Köln: "DE",
  France: "FR", Paris: "FR", Lyon: "FR", Netherlands: "NL", Amsterdam: "NL", Rotterdam: "NL", Spain: "ES", Madrid: "ES",
  Barcelona: "ES", Ireland: "IE", Dublin: "IE", Poland: "PL", Warsaw: "PL", Kraków: "PL", Krakow: "PL", Sweden: "SE",
  Stockholm: "SE", Portugal: "PT", Lisbon: "PT", Italy: "IT", Milan: "IT", Rome: "IT", Austria: "AT", Vienna: "AT",
  Belgium: "BE", Brussels: "BE", Denmark: "DK", Copenhagen: "DK", Finland: "FI", Helsinki: "FI", "Czech Republic": "CZ",
  Czechia: "CZ", Prague: "CZ", Greece: "EL", Athens: "EL", Romania: "RO", Bucharest: "RO", Hungary: "HU", Budapest: "HU",
  Estonia: "EE", Tallinn: "EE", Lithuania: "LT", Vilnius: "LT", Latvia: "LV", Riga: "LV", Luxembourg: "LU",
};

const OTHER_PLACES: Record<string, string> = {
  "United Kingdom": "UK", UK: "UK", London: "UK", Manchester: "UK", Edinburgh: "UK", Canada: "CA", Toronto: "CA",
  Vancouver: "CA", Montreal: "CA", India: "IN", Bangalore: "IN", Bengaluru: "IN", Australia: "AU", Sydney: "AU",
  Melbourne: "AU", Switzerland: "CH", Zurich: "CH", Zürich: "CH", Singapore: "SG", Mexico: "MX", Brazil: "BR",
  Japan: "JP", Tokyo: "JP", Israel: "IL", "Tel Aviv": "IL",
};

/** Two-letter USPS codes are read only as a label ("CO:", "(NY)", "CA/WA") and never as the words IN, OR, ME, OK, HI. */
const USPS = Object.values(US_STATES).filter((c) => !["IN", "OR", "ME", "OK", "HI", "DE", "LA", "MA", "PA", "ID", "OH", "AL", "MI", "MO"].includes(c));

export interface Place {
  text: string;
  start: number;
  end: number;
  codes: string[];
}

interface Entry {
  name: string;
  code: string;
}

const ENTRIES: Entry[] = [
  ...Object.entries(US_STATES).map(([n, c]) => ({ name: n, code: `US-${c}` })),
  ...Object.entries(US_CITIES).map(([n, c]) => ({ name: n, code: `US-${c}` })),
  ...Object.entries(EU_PLACES).map(([n, c]) => ({ name: n, code: `EU-${c}` })),
  ...Object.entries(OTHER_PLACES).map(([n, c]) => ({ name: n, code: `XX-${c}` })),
].sort((a, b) => b.name.length - a.name.length);

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const NAME_RE = new RegExp(`(?<![A-Za-z])(?:${ENTRIES.map((e) => esc(e.name)).join("|")})(?![A-Za-z])`, "g");
const CODE_BY_NAME = new Map(ENTRIES.map((e) => [e.name, e.code]));
const USPS_RE = new RegExp(`(?<![A-Za-z])(${USPS.join("|")})(?=\\s*[:)/]|\\s*-based|\\s+based)`, "g");

/** Every place named in `text`, in order, longest names first where they overlap. */
export function placesIn(text: string): Place[] {
  const out: Place[] = [];
  const taken = (s: number, e: number): boolean => out.some((p) => s < p.end && p.start < e);
  for (const m of text.matchAll(NAME_RE)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    // "New York" followed by "City" is already matched as the longer name; "Washington, DC" beats "Washington".
    if (taken(start, end)) continue;
    const code = CODE_BY_NAME.get(m[0]);
    if (code) out.push({ text: m[0], start, end, codes: [code] });
  }
  for (const m of text.matchAll(USPS_RE)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    if (!taken(start, end)) out.push({ text: m[0], start, end, codes: [`US-${m[1]}`] });
  }
  return out.sort((a, b) => a.start - b.start);
}
