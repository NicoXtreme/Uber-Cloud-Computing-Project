import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { RideRequestRepositoryError } from '../domain/ride-request-repository.js';
import type { RideRequestRepository } from '../domain/ride-request-repository.js';
import {
  createRideRequest, nonNegativeInteger, resourceId, restoreRideRequest, transitionRideRequest,
} from '../domain/ride-request.js';
import type { NewRideRequest, RideRequest, RideRequestTransition } from '../domain/ride-request.js';

export const rideRequestTable = 'svc-02-ride-requests';

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
    resourceId(id, 'id');
    try {
      const { Item } = await this.client.send(new GetCommand({
        TableName: rideRequestTable,
        Key: { request_id: id },
        ConsistentRead: true,
      }));
      return Item ? restoreRideRequest({ ...Item, id: Item.request_id }) : null;
    } catch (cause) {
      throw new RideRequestRepositoryError('storage_failure', 'Could not load the ride request.', { cause });
    }
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

    const next = transitionRideRequest(current, change, now);
    const tripAssignment = next.tripId === undefined ? '' : ', tripId = :tripId';
    try {
      await this.client.send(new UpdateCommand({
        TableName: rideRequestTable,
        Key: { request_id: id },
        ConditionExpression: 'attribute_exists(request_id) AND revision = :expected AND #status = :current',
        UpdateExpression: `SET #status = :next, revision = :revision, updatedAt = :updatedAt${tripAssignment}`,
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':expected': expectedRevision,
          ':current': current.status,
          ':next': next.status,
          ':revision': next.revision,
          ':updatedAt': next.updatedAt,
          ...(next.tripId === undefined ? {} : { ':tripId': next.tripId }),
        },
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
