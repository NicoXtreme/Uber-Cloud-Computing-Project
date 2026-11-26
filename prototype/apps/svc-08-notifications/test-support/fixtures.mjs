export const createdAt = '2026-01-01T12:00:00.000Z';
export const deliveredAt = '2026-01-01T12:01:00.000Z';

export function notificationInput(id = 'message-001') {
  return { id, type: 'RideMatched', channel: 'push', templateId: 'ride-matched-v1', correlationId: 'trace-001' };
}

export const emailOnly = Object.freeze({ email: true, sms: false, push: false });
