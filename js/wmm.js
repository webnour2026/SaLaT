// Modèle magnétique mondial WMM2025 (NOAA/NCEI – NGA/DGC), valable 2025.0 → 2030.0.
// Calcule la déclinaison magnétique (écart nord magnétique / nord géographique).
// Portage de l'algorithme de référence geomag.c ; coefficients officiels WMM.COF.
const EPOCH = 2025.0;
const VALID_UNTIL = 2030.0;
const COF = '1 0 -29351.8 0.0 12.0 0.0\n1 1 -1410.8 4545.4 9.7 -21.5\n2 0 -2556.6 0.0 -11.6 0.0\n2 1 2951.1 -3133.6 -5.2 -27.7\n2 2 1649.3 -815.1 -8.0 -12.1\n3 0 1361.0 0.0 -1.3 0.0\n3 1 -2404.1 -56.6 -4.2 4.0\n3 2 1243.8 237.5 0.4 -0.3\n3 3 453.6 -549.5 -15.6 -4.1\n4 0 895.0 0.0 -1.6 0.0\n4 1 799.5 278.6 -2.4 -1.1\n4 2 55.7 -133.9 -6.0 4.1\n4 3 -281.1 212.0 5.6 1.6\n4 4 12.1 -375.6 -7.0 -4.4\n5 0 -233.2 0.0 0.6 0.0\n5 1 368.9 45.4 1.4 -0.5\n5 2 187.2 220.2 0.0 2.2\n5 3 -138.7 -122.9 0.6 0.4\n5 4 -142.0 43.0 2.2 1.7\n5 5 20.9 106.1 0.9 1.9\n6 0 64.4 0.0 -0.2 0.0\n6 1 63.8 -18.4 -0.4 0.3\n6 2 76.9 16.8 0.9 -1.6\n6 3 -115.7 48.8 1.2 -0.4\n6 4 -40.9 -59.8 -0.9 0.9\n6 5 14.9 10.9 0.3 0.7\n6 6 -60.7 72.7 0.9 0.9\n7 0 79.5 0.0 -0.0 0.0\n7 1 -77.0 -48.9 -0.1 0.6\n7 2 -8.8 -14.4 -0.1 0.5\n7 3 59.3 -1.0 0.5 -0.8\n7 4 15.8 23.4 -0.1 0.0\n7 5 2.5 -7.4 -0.8 -1.0\n7 6 -11.1 -25.1 -0.8 0.6\n7 7 14.2 -2.3 0.8 -0.2\n8 0 23.2 0.0 -0.1 0.0\n8 1 10.8 7.1 0.2 -0.2\n8 2 -17.5 -12.6 0.0 0.5\n8 3 2.0 11.4 0.5 -0.4\n8 4 -21.7 -9.7 -0.1 0.4\n8 5 16.9 12.7 0.3 -0.5\n8 6 15.0 0.7 0.2 -0.6\n8 7 -16.8 -5.2 -0.0 0.3\n8 8 0.9 3.9 0.2 0.2\n9 0 4.6 0.0 -0.0 0.0\n9 1 7.8 -24.8 -0.1 -0.3\n9 2 3.0 12.2 0.1 0.3\n9 3 -0.2 8.3 0.3 -0.3\n9 4 -2.5 -3.3 -0.3 0.3\n9 5 -13.1 -5.2 0.0 0.2\n9 6 2.4 7.2 0.3 -0.1\n9 7 8.6 -0.6 -0.1 -0.2\n9 8 -8.7 0.8 0.1 0.4\n9 9 -12.9 10.0 -0.1 0.1\n10 0 -1.3 0.0 0.1 0.0\n10 1 -6.4 3.3 0.0 0.0\n10 2 0.2 0.0 0.1 -0.0\n10 3 2.0 2.4 0.1 -0.2\n10 4 -1.0 5.3 -0.0 0.1\n10 5 -0.6 -9.1 -0.3 -0.1\n10 6 -0.9 0.4 0.0 0.1\n10 7 1.5 -4.2 -0.1 0.0\n10 8 0.9 -3.8 -0.1 -0.1\n10 9 -2.7 0.9 -0.0 0.2\n10 10 -3.9 -9.1 -0.0 -0.0\n11 0 2.9 0.0 0.0 0.0\n11 1 -1.5 0.0 -0.0 -0.0\n11 2 -2.5 2.9 0.0 0.1\n11 3 2.4 -0.6 0.0 -0.0\n11 4 -0.6 0.2 0.0 0.1\n11 5 -0.1 0.5 -0.1 -0.0\n11 6 -0.6 -0.3 0.0 -0.0\n11 7 -0.1 -1.2 -0.0 0.1\n11 8 1.1 -1.7 -0.1 -0.0\n11 9 -1.0 -2.9 -0.1 0.0\n11 10 -0.2 -1.8 -0.1 0.0\n11 11 2.6 -2.3 -0.1 0.0\n12 0 -2.0 0.0 0.0 0.0\n12 1 -0.2 -1.3 0.0 -0.0\n12 2 0.3 0.7 -0.0 0.0\n12 3 1.2 1.0 -0.0 -0.1\n12 4 -1.3 -1.4 -0.0 0.1\n12 5 0.6 -0.0 -0.0 -0.0\n12 6 0.6 0.6 0.1 -0.0\n12 7 0.5 -0.1 -0.0 -0.0\n12 8 -0.1 0.8 0.0 0.0\n12 9 -0.4 0.1 0.0 -0.0\n12 10 -0.2 -1.0 -0.1 -0.0\n12 11 -1.3 0.1 -0.0 0.0\n12 12 -0.7 0.2 -0.1 -0.1';

const MAXORD = 12;
const N = MAXORD + 1;
const mk = () => Array.from({ length: N }, () => new Float64Array(N));
const c = mk(), cd = mk(), snorm = mk(), k = mk();
const fn = new Float64Array(N), fm = new Float64Array(N);

(function init() {
  for (const line of COF.split('\n')) {
    const [n, m, gnm, hnm, dgnm, dhnm] = line.split(' ').map(Number);
    if (m > n) continue;
    c[m][n] = gnm; cd[m][n] = dgnm;
    if (m !== 0) { c[n][m - 1] = hnm; cd[n][m - 1] = dhnm; }
  }
  snorm[0][0] = 1;
  for (let n = 1; n <= MAXORD; n++) {
    snorm[0][n] = snorm[0][n - 1] * (2 * n - 1) / n;
    let j = 2;
    for (let m = 0; m <= n; m++) {
      k[m][n] = ((n - 1) * (n - 1) - m * m) / ((2 * n - 1) * (2 * n - 3));
      if (m > 0) {
        const flnmj = ((n - m + 1) * j) / (n + m);
        snorm[m][n] = snorm[m - 1][n] * Math.sqrt(flnmj);
        j = 1;
        c[n][m - 1] *= snorm[m][n];
        cd[n][m - 1] *= snorm[m][n];
      }
      c[m][n] *= snorm[m][n];
      cd[m][n] *= snorm[m][n];
    }
    fn[n] = n + 1; fm[n] = n;
  }
  k[1][1] = 0;
})();

/** Année décimale (ex. 2026.73) */
export function decimalYear(ts = Date.now()) {
  const d = new Date(ts), y = d.getUTCFullYear();
  const start = Date.UTC(y, 0, 1), end = Date.UTC(y + 1, 0, 1);
  return y + (ts - start) / (end - start);
}

/** Déclinaison en degrés (Est positif). altKm = altitude en km. */
export function declination(lat, lon, altKm = 0, year = decimalYear()) {
  const a = 6378.137, b = 6356.7523142, re = 6371.2;
  const a2 = a * a, b2 = b * b, c2 = a2 - b2, a4 = a2 * a2, b4 = b2 * b2, c4 = a4 - b4;
  const dt = Math.min(Math.max(year, EPOCH), VALID_UNTIL) - EPOCH;
  const rlon = lon * Math.PI / 180, rlat = lat * Math.PI / 180;
  const srlon = Math.sin(rlon), crlon = Math.cos(rlon);
  const srlat = Math.sin(rlat), crlat = Math.cos(rlat);
  const srlat2 = srlat * srlat, crlat2 = crlat * crlat;

  const sp = new Float64Array(N), cp = new Float64Array(N), pp = new Float64Array(N);
  const p = mk(), dp = mk(), tc = mk();
  sp[0] = 0; cp[0] = 1; sp[1] = srlon; cp[1] = crlon; p[0][0] = 1; pp[0] = 1;

  // géodésique → sphérique
  const q = Math.sqrt(a2 - c2 * srlat2);
  const q1 = altKm * q;
  const q2 = ((q1 + a2) / (q1 + b2)) ** 2;
  const ct = srlat / Math.sqrt(q2 * crlat2 + srlat2);
  const st = Math.sqrt(1 - ct * ct);
  const r2 = altKm * altKm + 2 * q1 + (a4 - c4 * srlat2) / (q * q);
  const r = Math.sqrt(r2);
  const d = Math.sqrt(a2 * crlat2 + b2 * srlat2);
  const ca = (altKm + d) / r;
  const sa = c2 * crlat * srlat / (r * d);

  for (let m = 2; m <= MAXORD; m++) {
    sp[m] = sp[1] * cp[m - 1] + cp[1] * sp[m - 1];
    cp[m] = cp[1] * cp[m - 1] - sp[1] * sp[m - 1];
  }
  const aor = re / r;
  let ar = aor * aor, br = 0, bt = 0, bp = 0, bpp = 0;

  for (let n = 1; n <= MAXORD; n++) {
    ar *= aor;
    for (let m = 0; m <= n; m++) {
      if (n === m) {
        p[m][n] = st * p[m - 1][n - 1];
        dp[m][n] = st * dp[m - 1][n - 1] + ct * p[m - 1][n - 1];
      } else if (n === 1 && m === 0) {
        p[m][n] = ct * p[m][n - 1];
        dp[m][n] = ct * dp[m][n - 1] - st * p[m][n - 1];
      } else if (n > 1 && n !== m) {
        if (m > n - 2) { p[m][n - 2] = 0; dp[m][n - 2] = 0; }
        p[m][n] = ct * p[m][n - 1] - k[m][n] * p[m][n - 2];
        dp[m][n] = ct * dp[m][n - 1] - st * p[m][n - 1] - k[m][n] * dp[m][n - 2];
      }
      tc[m][n] = c[m][n] + dt * cd[m][n];
      if (m !== 0) tc[n][m - 1] = c[n][m - 1] + dt * cd[n][m - 1];

      const par = ar * p[m][n];
      let temp1, temp2;
      if (m === 0) { temp1 = tc[m][n] * cp[m]; temp2 = tc[m][n] * sp[m]; }
      else {
        temp1 = tc[m][n] * cp[m] + tc[n][m - 1] * sp[m];
        temp2 = tc[m][n] * sp[m] - tc[n][m - 1] * cp[m];
      }
      bt -= ar * temp1 * dp[m][n];
      bp += fm[m] * temp2 * par;
      br += fn[n] * temp1 * par;

      if (st === 0 && m === 1) {
        pp[n] = n === 1 ? pp[n - 1] : ct * pp[n - 1] - k[m][n] * pp[n - 2];
        bpp += fm[m] * temp2 * ar * pp[n];
      }
    }
  }
  bp = st === 0 ? bpp : bp / st;
  const bx = -bt * ca - br * sa;
  const by = bp;
  return Math.atan2(by, bx) * 180 / Math.PI;
}

export const WMM_VALID = year => year >= EPOCH && year < VALID_UNTIL;
