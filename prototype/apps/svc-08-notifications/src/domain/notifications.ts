export type RecipientAccess = Readonly<{ recipientId: string }>;

const channels = ['email', 'sms', 'push'] as const;
const statuses = ['pending', 'delivered', 'failed'] as const;
const types = [
  'Otp', 'RideMatched', 'DispatchOfferCreated', 'TripStarted', 'TripCompleted', 'TripCancelled',
  'PaymentCaptured', 'PaymentFailed', 'InvoiceIssued', 'DriverApproved', 'SafetyIncidentResolved',
] as const;

type Channel = typeof channels[number];
type Status = typeof statuses[number];
type NotificationType = typeof types[number];

export type NewMessage = Readonly<{
  id: string;
  type: NotificationType;
  channel: Channel;
  templateId: string;
  correlationId: string;
}>;

export type MessageLog = NewMessage & Readonly<{
  recipientId: string;
  status: Status;
  createdAt: string;
  updatedAt: string;
  attemptCount: number;
  lastAttemptAt?: string;
  revision: number;
}>;

export type NotificationChannels = Readonly<Record<Channel, boolean>>;
export type NotificationPreferences = NotificationChannels & Readonly<{
  userId: string;
  revision: number | null;
  updatedAt: string | null;
}>;

export class NotificationError extends Error {
  constructor(readonly code: 'invalid' | 'not_found' | 'conflict' | 'storage_failure', message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'NotificationError';
  }
}

export function resourceId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
    throw new NotificationError('invalid', 'A valid resource identifier is required.');
  }
  return value;
}

export function timestamp(value: unknown): string {
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime()) && parsed.toISOString() === value && value.length === 24) return value;
  }
  throw new NotificationError('invalid', 'A canonical UTC timestamp is required.');
}

export function clockTimestamp(now: Date): string {
  if (!Number.isFinite(now.getTime())) {
    throw new NotificationError('invalid', 'The notification clock must provide a valid date.');
  }
  return timestamp(now.toISOString());
}

export function revision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new NotificationError('invalid', 'A nonnegative safe integer is required.');
  }
  return value;
}

export function restoreMessage(value: Record<string, unknown>): MessageLog {
  const type = types.find((candidate) => candidate === value.type);
  const channel = channels.find((candidate) => candidate === value.channel);
  const status = statuses.find((candidate) => candidate === value.status);
  const correlationId = value.correlationId;
  if (!type || !channel || !status || typeof correlationId !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(correlationId)) {
    throw new NotificationError('invalid', 'The notification type, channel, status or correlation ID is invalid.');
  }

  const createdAt = timestamp(value.createdAt);
  const updatedAt = timestamp(value.updatedAt);
  const attempts = revision(value.attemptCount);
  const lastAttemptAt = value.lastAttemptAt === undefined ? undefined : timestamp(value.lastAttemptAt);
  if (updatedAt < createdAt ||
      (status === 'pending' ? attempts !== 0 || lastAttemptAt !== undefined : attempts < 1 || lastAttemptAt !== updatedAt)) {
    throw new NotificationError('invalid', 'The notification timestamps or attempt audit fields are inconsistent.');
  }

  return {
    id: resourceId(value.id), recipientId: resourceId(value.recipientId),
    templateId: resourceId(value.templateId), type, channel, status, correlationId,
    createdAt, updatedAt, attemptCount: attempts, revision: revision(value.revision),
    ...(lastAttemptAt === undefined ? {} : { lastAttemptAt }),
  };
}

export function createMessage(access: RecipientAccess, input: NewMessage, now = new Date()): MessageLog {
  const createdAt = clockTimestamp(now);
  const { id, type, channel, templateId, correlationId } = input;
  return restoreMessage({
    id, type, channel, templateId, correlationId, recipientId: access.recipientId,
    status: 'pending', createdAt, updatedAt: createdAt, attemptCount: 0, revision: 0,
  });
}

export function finishMessage(
  message: MessageLog,
  status: 'delivered' | 'failed',
  now = new Date(),
): MessageLog {
  if (status !== 'delivered' && status !== 'failed') {
    throw new NotificationError('invalid', 'A terminal delivery status is required.');
  }
  if (message.status !== 'pending') {
    throw new NotificationError('conflict', 'This notification already has a delivery result.');
  }

  const updatedAt = clockTimestamp(now);
  if (updatedAt < message.updatedAt) {
    throw new NotificationError('invalid', 'The delivery result cannot precede the current record.');
  }
  return restoreMessage({
    ...message, status, updatedAt, lastAttemptAt: updatedAt,
    attemptCount: message.attemptCount + 1, revision: message.revision + 1,
  });
}

export function notificationChannels(value: Record<string, unknown>): NotificationChannels {
  const { email, sms, push } = value;
  if (typeof email !== 'boolean' || typeof sms !== 'boolean' || typeof push !== 'boolean') {
    throw new NotificationError('invalid', 'A boolean is required for each notification channel.');
  }
  return { email, sms, push };
}

export function defaultPreferences(access: RecipientAccess): NotificationPreferences {
  return { userId: resourceId(access.recipientId), email: false, sms: false, push: false, revision: null, updatedAt: null };
}
