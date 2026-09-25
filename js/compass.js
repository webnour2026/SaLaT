// Boussole : 3 sources, de la plus fiable à la moins fiable.
//  1. iOS Safari       : deviceorientation + webkitCompassHeading (permission requise)
//  2. Android Chrome   : deviceorientationabsolute (ou deviceorientation avec absolute=true)
//  3. Secours Android  : Generic Sensor API AbsoluteOrientationSensor
// Le cap renvoyé est MAGNÉTIQUE ; l'appelant ajoute la déclinaison.

const deg = r => r * 180 / Math.PI;

export class Compass {
  constructor({ onHeading, onStatus }) {
    this.onHeading = onHeading;   // (cap, { flat, accuracy, source })
    this.onStatus = onStatus;     // 'unsupported'|'denied'|'nodata'|'relative'|'calibrate'|'ok'
    this.onAbs = e => this.handle(e, 'absolute');
    this.onRel = e => this.handle(e, 'orientation');
    this.running = false;
    this.sensor = null;
  }

  static isSupported() {
    return typeof window.DeviceOrientationEvent !== 'undefined' || 'AbsoluteOrientationSensor' in window;
  }
  static needsPermission() {
    return typeof window.DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function';
  }

  /** Sur iOS, doit être appelé depuis un clic. Sur Android, peut être appelé directement. */
  async start() {
    if (!Compass.isSupported()) { this.onStatus('unsupported'); return false; }
    if (Compass.needsPermission()) {
      try {
        if (await DeviceOrientationEvent.requestPermission() !== 'granted') { this.onStatus('denied'); return false; }
      } catch { this.onStatus('denied'); return false; }
    }
    this.stop();
    this.sin = this.cos = null;
    this.hist = []; this.qScore = null;
    this.lastAbs = 0;
    this.gotHeading = false;
    this.sawRelative = false;
    this.blocked = false;
    // on écoute les deux : selon l'appareil, le nord absolu arrive par l'un ou l'autre
    window.addEventListener('deviceorientationabsolute', this.onAbs, true);
    window.addEventListener('deviceorientation', this.onRel, true);
    window.addEventListener('compassneedscalibration', this.onCalib = () => { this.calibFlag = Date.now(); this.onStatus('calibrate'); }, true);
    this.running = true;

    clearTimeout(this.fallbackTimer);
    this.fallbackTimer = setTimeout(() => {
      if (this.gotHeading) return;
      if (!this.startSensor()) this.onStatus(this.sawRelative ? 'relative' : 'nodata');
      else setTimeout(() => { if (!this.gotHeading) this.onStatus(this.blocked ? 'blocked' : this.sawRelative ? 'relative' : 'nodata'); }, 2500);
    }, 1500);
    return true;
  }

  // Secours : capteur d'orientation absolue (Chrome Android)
  startSensor() {
    if (!('AbsoluteOrientationSensor' in window) || this.sensor) return false;
    try {
      const s = new AbsoluteOrientationSensor({ frequency: 30, referenceFrame: 'screen' });
      s.addEventListener('reading', () => {
        const [x, y, z, w] = s.quaternion;
        const yaw = deg(Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z))); // = alpha
        const pitch = deg(Math.asin(Math.max(-1, Math.min(1, 2 * (w * x - y * z)))));
        const roll = deg(Math.atan2(2 * (w * y + z * x), 1 - 2 * (x * x + y * y)));
        this.emit((360 - yaw) % 360, { beta: pitch, gamma: roll, accuracy: null, source: 'sensor', screenCorrected: true });
      });
      s.addEventListener('error', ev => { this.sensor = null; if (ev.error && ev.error.name === 'NotAllowedError') this.blocked = true; });
      s.start();
      this.sensor = s;
      return true;
    } catch { return false; }
  }

  stop() {
    window.removeEventListener('deviceorientationabsolute', this.onAbs, true);
    window.removeEventListener('deviceorientation', this.onRel, true);
    if (this.onCalib) window.removeEventListener('compassneedscalibration', this.onCalib, true);
    clearTimeout(this.fallbackTimer);
    if (this.sensor) { try { this.sensor.stop(); } catch {} this.sensor = null; }
    this.running = false;
  }

  handle(e, kind) {
    if (typeof e.webkitCompassHeading === 'number' && e.webkitCompassHeading >= 0) {
      return this.emit(e.webkitCompassHeading, { beta: e.beta, gamma: e.gamma, accuracy: e.webkitCompassAccuracy, source: 'ios' });
    }
    if (e.alpha == null) return;
    const absolute = kind === 'absolute' || e.absolute === true;
    if (!absolute) {
      this.sawRelative = true;
      return; // alpha relatif (orientation au démarrage) : inutilisable pour le nord
    }
    if (kind === 'orientation' && Date.now() - this.lastAbs < 500) return; // doublon
    if (kind === 'absolute') this.lastAbs = Date.now();
    this.emit((360 - e.alpha) % 360, { beta: e.beta, gamma: e.gamma, accuracy: null, source: kind });
  }

  emit(heading, { beta, gamma, accuracy, source, screenCorrected }) {
    this.gotHeading = true;
    if (this.sensor && source !== 'sensor') { try { this.sensor.stop(); } catch {} this.sensor = null; }
    if (!screenCorrected) {
      const screenAngle = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
      heading = (heading + screenAngle + 360) % 360;
    }
    // lissage circulaire
    const k = 0.25, r = heading * Math.PI / 180;
    // qualité : une rotation normale est régulière ; un capteur mal calibré « saute ».
    // On mesure la médiane des variations d'accélération angulaire (2e différence).
    this.hist = this.hist || [];
    this.hist.push(heading);
    if (this.hist.length > 24) this.hist.shift();
    let quality = 'good';
    if (accuracy != null) quality = accuracy < 0 || accuracy > 25 ? 'poor' : accuracy > 12 ? 'fair' : 'good';
    else if (this.hist.length >= 8) {
      const d = [];
      for (let i = 1; i < this.hist.length; i++) d.push(((this.hist[i] - this.hist[i - 1] + 540) % 360) - 180);
      const dd = [];
      for (let i = 1; i < d.length; i++) dd.push(Math.abs(d[i] - d[i - 1]));
      dd.sort((a, b) => a - b);
      const med = dd[Math.floor(dd.length / 2)];
      quality = med > 3 ? 'poor' : med > 1.2 ? 'fair' : 'good';
    }
    if (this.calibFlag && Date.now() - this.calibFlag < 5000) quality = 'poor';
    // on lisse la note pour éviter le clignotement
    const score = { good: 0, fair: 1, poor: 2 }[quality];
    this.qScore = this.qScore == null ? score : this.qScore + 0.08 * (score - this.qScore);
    quality = this.qScore > 1.4 ? 'poor' : this.qScore > 0.6 ? 'fair' : 'good';

    this.sin = this.sin == null ? Math.sin(r) : this.sin + k * (Math.sin(r) - this.sin);
    this.cos = this.cos == null ? Math.cos(r) : this.cos + k * (Math.cos(r) - this.cos);
    const smooth = (deg(Math.atan2(this.sin, this.cos)) + 360) % 360;

    const flat = beta == null || (Math.abs(beta) < 40 && Math.abs(gamma) < 40);
    const needsCalib = accuracy != null && (accuracy < 0 || accuracy > 25);
    this.onStatus(needsCalib ? 'calibrate' : 'ok');
    this.onHeading(smooth, { flat, accuracy, source, quality });
  }
}
