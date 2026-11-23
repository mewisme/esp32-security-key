export interface Semver {
  major: number;
  minor: number;
  patch: number;
  pre: string[];
}

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.]+))?$/;

export function parseSemver(v: string): Semver | null {
  const m = SEMVER.exec(v);
  if (!m) return null;
  const pre = m[4] ? m[4].split(".") : [];
  if (pre.some((p) => p === "")) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre };
}

function compareIdent(a: string, b: string): number {
  const na = /^\d+$/.test(a);
  const nb = /^\d+$/.test(b);
  if (na && nb) return Math.sign(Number(a) - Number(b));
  if (na) return -1;
  if (nb) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** -1/0/1 per semver precedence (a pre-release sorts below its release); null when either is not semver. */
export function compareSemver(a: string, b: string): number | null {
  const x = parseSemver(a);
  const y = parseSemver(b);
  if (!x || !y) return null;
  for (const k of ["major", "minor", "patch"] as const) {
    if (x[k] !== y[k]) return Math.sign(x[k] - y[k]);
  }
  if (!x.pre.length || !y.pre.length) return Math.sign(y.pre.length - x.pre.length);
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const pa = x.pre[i];
    const pb = y.pre[i];
    if (pa === undefined) return -1;
    if (pb === undefined) return 1;
    const c = compareIdent(pa, pb);
    if (c) return c;
  }
  return 0;
}
