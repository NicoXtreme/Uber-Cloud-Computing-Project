import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { RideRequestRepositoryError } from '../domain/ride-request-repository.js';
import type { RideRequestRepository } from '../domain/ride-request-repository.js';
import {
  createRideRequest, nonNegativeInteger, resourceId, restoreRideRequest, RideRequestDomainError, transitionRideRequest,
} from '../domain/ride-request.js';
import type { NewRideRequest, RideRequest, RideRequestTransition } from '../domain/ride-request.js';

export const rideRequestTable = 'svc-02-ride-requests';

type ConfirmationReceipt = Readonly<{ key: string; response: RideRequest }>;
type StoredRide = Readonly<{ request: RideRequest; receipt?: ConfirmationReceipt }>;
type TransitionAttributes = Readonly<{ confirmationReceipt?: ConfirmationReceipt; cancellationReason?: string }>;

function replay(receipt: ConfirmationReceipt | undefined, key: string, quoteId: string): RideRequest | undefined {
  if (receipt?.key !== key) return undefined;
  if (receipt.response.quote.id !== quoteId) {
    throw new RideRequestRepositoryError('idempotency_key_reused', 'The confirmation key was used with another quote.');
  }
  return receipt.response;
}

function planTransition(current: RideRequest, change: RideRequestTransition): RideRequest {
  try {
    return transitionRideRequest(current, change);
  } catch (cause) {
    if (!(cause instanceof RideRequestDomainError)) throw cause;
    const code = cause.code === 'quote_changed' ? 'quote_changed' : 'conflict';
    throw new RideRequestRepositoryError(code, 'The requested transition cannot be applied.', { cause });
  }
}

export class DynamoDbRideRequestRepository implements RideRequestRepository {
  constructor(private readonly client: DynamoDBDocumentClient) {}

  async create(input: NewRideRequest, now?: Date): Promise<RideRequest> {
    const request = createRideRequest(input, now);
    const { id, ...attributes } = request;
    try {
      await this.client.send(new PutCommand({
        TableName: rideRequestTable,
        Item: { request_id: id, ...attributes },
        ConditionExpression: 'attribute_not_exists(request_id)',
      }));
      return request;
    } catch (cause) {
      if (cause instanceof ConditionalCheckFailedException) {
        throw new RideRequestRepositoryError('already_exists', 'The ride request already exists.', { cause });
      }
      throw new RideRequestRepositoryError('storage_failure', 'Could not store the ride request.', { cause });
    }
  }

  async findById(id: string): Promise<RideRequest | null> {
    return (await this.findRecord(id))?.request ?? null;
  }

  private async findRecord(id: string): Promise<StoredRide | null> {
    resourceId(id, 'id');
    try {
      const { Item } = await this.client.send(new GetCommand({
        TableName: rideRequestTable,
        Key: { request_id: id },
        ConsistentRead: true,
      }));
      if (!Item) return null;
      const request = restoreRideRequest({ ...Item, id: Item.request_id });
      const receipt = Item.confirmationReceipt;
      if (receipt === undefined) return { request };
      const response = restoreRideRequest(receipt?.response);
      if (typeof receipt.key !== 'string' || response.status !== 'searching' ||
          response.id !== request.id || response.riderId !== request.riderId) {
        throw new Error('The stored confirmation receipt is invalid.');
      }
      return { request, receipt: { key: receipt.key, response } };
    } catch (cause) {
      throw new RideRequestRepositoryError('storage_failure', 'Could not load the ride request.', { cause });
    }
  }

  private async findOwnedRecord(id: string, riderId: string): Promise<StoredRide> {
    const record = await this.findRecord(id);
    if (!record || record.request.riderId !== riderId) {
      throw new RideRequestRepositoryError('not_found', 'The ride request does not exist.');
    }
    return record;
  }

  async confirm(id: string, riderId: string, quoteId: string, key: string): Promise<RideRequest> {
    const { request, receipt } = await this.findOwnedRecord(id, riderId);
    const previous = replay(receipt, key, quoteId);
    if (previous) return previous;

    const next = planTransition(request, { status: 'searching', quoteId });
    try {
      return await this.saveTransition(request, next, { confirmationReceipt: { key, response: next } });
    } catch (error) {
      if (!(error instanceof RideRequestRepositoryError) || error.code !== 'conflict') throw error;
      const latest = await this.findOwnedRecord(id, riderId);
      const concurrent = replay(latest.receipt, key, quoteId);
      if (concurrent) return concurrent;
      throw error;
    }
  }

  async cancel(id: string, riderId: string, reason?: string): Promise<RideRequest> {
    const { request } = await this.findOwnedRecord(id, riderId);
    return this.saveTransition(request, planTransition(request, { status: 'cancelled' }), { cancellationReason: reason });
  }

  async transition(
    id: string,
    expectedRevision: number,
    change: RideRequestTransition,
    now?: Date,
  ): Promise<RideRequest> {
    nonNegativeInteger(expectedRevision, 'expectedRevision');
    const current = await this.findById(id);
    if (!current) {
      throw new RideRequestRepositoryError('not_found', 'The ride request does not exist.');
    }
    if (current.revision !== expectedRevision) {
      throw new RideRequestRepositoryError('conflict', 'The ride request changed since it was read.');
    }

    return this.saveTransition(current, transitionRideRequest(current, change, now));
  }

  private async saveTransition(
    current: RideRequest,
    next: RideRequest,
    attributes: TransitionAttributes = {},
  ): Promise<RideRequest> {
    const assignments = ['#status = :next', 'revision = :revision', 'updatedAt = :updatedAt'];
    const values = {
      ':expected': current.revision,
      ':current': current.status,
      ':rider': current.riderId,
      ':next': next.status,
      ':revision': next.revision,
      ':updatedAt': next.updatedAt,
    };
    const optionalValues = { tripId: next.tripId, ...attributes };
    const extraValues: Record<string, string | ConfirmationReceipt> = {};
    for (const [name, value] of Object.entries(optionalValues)) {
      if (value === undefined) continue;
      assignments.push(`${name} = :${name}`);
      extraValues[`:${name}`] = value;
    }
    try {
      await this.client.send(new UpdateCommand({
        TableName: rideRequestTable,
        Key: { request_id: current.id },
        ConditionExpression: 'attribute_exists(request_id) AND revision = :expected AND #status = :current AND riderId = :rider',
        UpdateExpression: `SET ${assignments.join(', ')}`,
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ...values, ...extraValues },
      }));
      return next;
    } catch (cause) {
      if (cause instanceof ConditionalCheckFailedException) {
        throw new RideRequestRepositoryError('conflict', 'The ride request changed since it was read.', { cause });
      }
      throw new RideRequestRepositoryError('storage_failure', 'Could not update the ride request.', { cause });
    }
  }
}
