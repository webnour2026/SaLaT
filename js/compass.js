// Boussole basée sur DeviceOrientation.
// - iOS Safari : event.webkitCompassHeading (nord magnétique), permission requise.
// - Android Chrome : événement 'deviceorientationabsolute', alpha relatif au nord.
// Le cap renvoyé est MAGNÉTIQUE ; l'appelant ajoute la déclinaison pour obtenir le nord géographique.

export class Compass {
  constructor({ onHeading, onStatus }) {
    this.onHeading = onHeading;   // (headingDeg, { flat, accuracy })
    this.onStatus = onStatus;     // ('unsupported'|'denied'|'nodata'|'relative'|'calibrate'|'ok')
    this.handler = e => this.handle(e);
    this.sin = null; this.cos = null;
    this.running = false;
  }

  static isSupported() { return typeof window.DeviceOrientationEvent !== 'undefined'; }

  /** À appeler depuis un geste utilisateur (clic), obligatoire sur iOS. */
  async start() {
    if (!Compass.isSupported()) { this.onStatus('unsupported'); return false; }
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      try {
        const r = await DeviceOrientationEvent.requestPermission();
        if (r !== 'granted') { this.onStatus('denied'); return false; }
      } catch { this.onStatus('denied'); return false; }
    }
    this.stop();
    this.eventName = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';
    window.addEventListener(this.eventName, this.handler, true);
    window.addEventListener('compassneedscalibration', this.onCalib = () => this.onStatus('calibrate'), true);
    this.running = true;
    this.gotData = false;
    clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => { if (!this.gotData) this.onStatus('nodata'); }, 3000);
    return true;
  }

  stop() {
    if (this.eventName) window.removeEventListener(this.eventName, this.handler, true);
    if (this.onCalib) window.removeEventListener('compassneedscalibration', this.onCalib, true);
    clearTimeout(this.watchdog);
    this.running = false;
  }

  handle(e) {
    let heading = null, accuracy = null;
    if (typeof e.webkitCompassHeading === 'number' && e.webkitCompassHeading >= 0) {
      heading = e.webkitCompassHeading;           // iOS : déjà dans le sens horaire
      accuracy = e.webkitCompassAccuracy;          // degrés, <0 = non calibré
    } else if (e.alpha != null && (e.absolute || this.eventName === 'deviceorientationabsolute')) {
      heading = 360 - e.alpha;                     // alpha : anti-horaire depuis le nord
    } else if (e.alpha != null) {
      this.gotData = true; this.onStatus('relative'); return;
    } else {
      return;
    }
    this.gotData = true;

    // correction si l'écran est en paysage
    const screenAngle = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
    heading = (heading + screenAngle + 360) % 360;

    // lissage circulaire (évite le saut 359° → 0°)
    const k = 0.2, r = heading * Math.PI / 180;
    this.sin = this.sin == null ? Math.sin(r) : this.sin + k * (Math.sin(r) - this.sin);
    this.cos = this.cos == null ? Math.cos(r) : this.cos + k * (Math.cos(r) - this.cos);
    const smooth = (Math.atan2(this.sin, this.cos) * 180 / Math.PI + 360) % 360;

    const flat = e.beta == null || (Math.abs(e.beta) < 35 && Math.abs(e.gamma) < 35);
    const needsCalib = accuracy != null && (accuracy < 0 || accuracy > 25);
    this.onStatus(needsCalib ? 'calibrate' : 'ok');
    this.onHeading(smooth, { flat, accuracy });
  }
}
