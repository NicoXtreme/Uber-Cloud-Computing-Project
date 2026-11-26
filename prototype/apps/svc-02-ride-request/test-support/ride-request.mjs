export const creationTime = '2026-01-01T12:00:00.000Z';
export const transitionTime = '2026-01-01T12:01:00.000Z';
export const expiryTime = '2026-01-01T12:05:00Z';

export function newRideRequest(id = 'request-001') {
  return {
    id,
    riderId: 'rider-001',
    pickup: { latitude: 4.6097, longitude: -74.0817 },
    destination: { latitude: 4.6486, longitude: -74.0628 },
    serviceType: 'standard',
    quote: {
      id: 'quote-001',
      fare: { amountMinor: 1870000, currency: 'COP' },
      etaSeconds: 420,
      expiresAt: expiryTime,
    },
  };
}
