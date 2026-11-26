set -eu

action=$1
case "$action" in
  init|verify) ;;
  *) printf 'Expected init or verify.\n' >&2; exit 1 ;;
esac

dynamodb() {
  aws --endpoint-url http://127.0.0.1:8000 --cli-connect-timeout 3 --cli-read-timeout 10 --no-cli-pager dynamodb "$@"
}

attempt=1
while ! probe=$(dynamodb list-tables --limit 1 --no-paginate 2>&1); do
  if [ "$attempt" -eq 15 ]; then
    printf '%s\n' "$probe" >&2
    exit 1
  fi
  attempt=$((attempt + 1))
  sleep 1
done

describe() {
  dynamodb describe-table --table-name "$1" --output text --query \
    "Table.[TableStatus, KeySchema[?KeyType=='HASH'].AttributeName | [0], KeySchema[?KeyType=='RANGE'].AttributeName | [0], AttributeDefinitions[?AttributeName=='$2'].AttributeType | [0], AttributeDefinitions[?AttributeName=='$3'].AttributeType | [0]]"
}

table() {
  name=$1
  partition=$2
  sort=${3:-None}

  if ! actual=$(describe "$name" "$partition" "$sort" 2>&1); then
    case "$action:$actual" in
      init:*ResourceNotFoundException*) ;;
      *) printf '%s\n' "$actual" >&2; return 1 ;;
    esac

    if [ "$sort" != None ]; then
      dynamodb create-table --table-name "$name" --billing-mode PAY_PER_REQUEST \
        --attribute-definitions "AttributeName=$partition,AttributeType=S" "AttributeName=$sort,AttributeType=N" \
        --key-schema "AttributeName=$partition,KeyType=HASH" "AttributeName=$sort,KeyType=RANGE" >/dev/null
    else
      dynamodb create-table --table-name "$name" --billing-mode PAY_PER_REQUEST \
        --attribute-definitions "AttributeName=$partition,AttributeType=S" \
        --key-schema "AttributeName=$partition,KeyType=HASH" >/dev/null
    fi
    dynamodb wait table-exists --table-name "$name"
    actual=$(describe "$name" "$partition" "$sort")
  fi

  sort_type=None
  if [ "$sort" != None ]; then sort_type=N; fi
  expected=$(printf 'ACTIVE\t%s\t%s\tS\t%s' "$partition" "$sort" "$sort_type")
  if [ "$actual" != "$expected" ]; then
    printf '%s: unexpected table status or key schema. Expected [%s], got [%s].\n' "$name" "$expected" "$actual" >&2
    return 1
  fi

  printf '%s: ACTIVE, key schema verified.\n' "$name"
}

describe_notification_index() {
  dynamodb describe-table --table-name svc-08-notifications --output text --query \
    "Table.GlobalSecondaryIndexes[?IndexName=='recipient-history'] | [0].[IndexStatus, KeySchema[?KeyType=='HASH'].AttributeName | [0], KeySchema[?KeyType=='RANGE'].AttributeName | [0], Projection.ProjectionType]"
}

notification_index() {
  actual=$(describe_notification_index)
  if [ "$actual" = None ] && [ "$action" = init ]; then
    dynamodb update-table --table-name svc-08-notifications \
      --attribute-definitions AttributeName=recipient_id,AttributeType=S AttributeName=history_key,AttributeType=S \
      --global-secondary-index-updates '[{"Create":{"IndexName":"recipient-history","KeySchema":[{"AttributeName":"recipient_id","KeyType":"HASH"},{"AttributeName":"history_key","KeyType":"RANGE"}],"Projection":{"ProjectionType":"ALL"}}}]' >/dev/null
    for attempt in $(seq 1 30); do
      actual=$(describe_notification_index)
      case "$actual" in ACTIVE*) break ;; esac
      sleep 1
    done
  fi

  expected=$(printf 'ACTIVE\trecipient_id\thistory_key\tALL')
  types=$(dynamodb describe-table --table-name svc-08-notifications --output text --query \
    "Table.[AttributeDefinitions[?AttributeName=='recipient_id'].AttributeType | [0], AttributeDefinitions[?AttributeName=='history_key'].AttributeType | [0]]")
  if [ "$actual" != "$expected" ] || [ "$types" != "$(printf 'S\tS')" ]; then
    printf 'svc-08-notifications: recipient-history index is missing, inactive or incompatible.\n' >&2
    return 1
  fi
  printf 'svc-08-notifications: ACTIVE, recipient-history index verified.\n'
}

table svc-02-ride-requests request_id
table svc-04-trips trip_id
table svc-04-trip-telemetry trip_id timestamp
table svc-07-feedback-safety record_id
table svc-08-notifications notification_id
notification_index
