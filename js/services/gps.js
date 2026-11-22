// Geolocation wrapper with honest capability reporting.

export const gps = {
  supported: typeof navigator !== 'undefined' && 'geolocation' in navigator,
  secure: typeof window !== 'undefined' && window.isSecureContext,
  watchId: null,

  async permissionState() {
    try {
      if (!navigator.permissions) return 'unknown';
      const r = await navigator.permissions.query({ name: 'geolocation' });
      return r.state; // granted | prompt | denied
    } catch { return 'unknown'; }
  },

  start(onFix, onError) {
    if (!this.supported) { onError && onError({ code: 'unsupported', message: 'GPS is not available in this browser.' }); return false; }
    if (!this.secure) { onError && onError({ code: 'insecure', message: 'GPS requires HTTPS. Open the app from its https:// address.' }); return false; }
    this.stop();
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => onFix({ lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy, speed: pos.coords.speed, t: pos.timestamp || Date.now() }),
      (err) => onError && onError({ code: err.code, message: err.code === 1 ? 'Location permission denied. Enable it in your browser settings to track distance.' : err.code === 3 ? 'GPS timed out — still searching.' : 'GPS signal unavailable.' }),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
    );
    return true;
  },

  stop() {
    if (this.watchId != null) { navigator.geolocation.clearWatch(this.watchId); this.watchId = null; }
  },
};
