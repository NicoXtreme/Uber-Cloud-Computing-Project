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
    'Table.[TableStatus, KeySchema[?KeyType==`"HASH"`].AttributeName | [0], KeySchema[?KeyType==`"RANGE"`].AttributeName | [0], AttributeDefinitions[?AttributeType==`"S"`].AttributeName | [0], AttributeDefinitions[?AttributeType==`"N"`].AttributeName | [0]]'
}

table() {
  name=$1
  partition=$2
  sort=${3:-None}

  if ! actual=$(describe "$name" 2>&1); then
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
    actual=$(describe "$name")
  fi

  expected=$(printf 'ACTIVE\t%s\t%s\t%s\t%s' "$partition" "$sort" "$partition" "$sort")
  if [ "$actual" != "$expected" ]; then
    printf '%s: unexpected table status or key schema. Expected [%s], got [%s].\n' "$name" "$expected" "$actual" >&2
    return 1
  fi

  printf '%s: ACTIVE, key schema verified.\n' "$name"
}

table svc-02-ride-requests request_id
table svc-04-trips trip_id
table svc-04-trip-telemetry trip_id timestamp
table svc-07-feedback-safety record_id
table svc-08-notifications notification_id
