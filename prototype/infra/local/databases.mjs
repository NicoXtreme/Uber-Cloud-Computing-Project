import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { setTimeout } from 'node:timers/promises';
import { URL } from 'node:url';

const postgres = process.env.LOCAL_POSTGRES_CONTAINER ?? 'd4-postgres';
const dynamodb = process.env.LOCAL_DYNAMODB_CONTAINER ?? 'd4-dynamodb';
const redis = process.env.LOCAL_REDIS_CONTAINER ?? 'd4-redis';
const adminPassword = process.env.LOCAL_POSTGRES_PASSWORD ?? 'local-postgres-only';
const redisPassword = process.env.LOCAL_REDIS_PASSWORD ?? 'local-redis-only';
const servicePasswords = {
  svc_01: process.env.LOCAL_SVC_01_PASSWORD ?? 'local-svc01-only',
  svc_05: process.env.LOCAL_SVC_05_PASSWORD ?? 'local-svc05-only',
  svc_06: process.env.LOCAL_SVC_06_PASSWORD ?? 'local-svc06-only',
};

function source(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
}

function docker(args, { input, env = {} } = {}) {
  const result = spawnSync('docker', args, {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    input,
    timeout: 300_000,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `Docker exited with status ${result.status}`);
  }
  return result.stdout.trim();
}

function exec(container, command, { input, env = {} } = {}) {
  const options = Object.keys(env).flatMap((key) => ['--env', key]);
  return docker(['exec', ...(input === undefined ? [] : ['-i']), ...options, container, ...command], { input, env });
}

async function waitFor(check, description) {
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    try {
      return check();
    } catch (error) {
      if (attempt === 20) throw new Error(`${description}: ${error.message}`, { cause: error });
      await setTimeout(1000);
    }
  }
}

function psql({ user, database, password, script, flags = [], env = {} }) {
  return exec(postgres, [
    'psql', '-X', '-w', '--host', '127.0.0.1', '--username', user, '--dbname', database,
    '--set', 'ON_ERROR_STOP=1', ...flags, '--file', '-',
  ], {
    input: source(script),
    env: { PGPASSWORD: password, PGCONNECT_TIMEOUT: '3', ...env },
  });
}

async function postgresAction(action) {
  await waitFor(
    () => exec(postgres, ['pg_isready', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'postgres']),
    'PostgreSQL is not ready',
  );

  if (action === 'init') {
    const admin = { user: 'postgres', password: adminPassword };
    globalThis.console.log(psql({
      ...admin,
      database: 'postgres',
      script: './postgres/init.sql',
      env: {
        LOCAL_SVC_01_PASSWORD: servicePasswords.svc_01,
        LOCAL_SVC_05_PASSWORD: servicePasswords.svc_05,
        LOCAL_SVC_06_PASSWORD: servicePasswords.svc_06,
      },
    }));
    globalThis.console.log(psql({
      ...admin,
      database: 'svc_05',
      script: './postgres/enable-postgis.sql',
    }));
    return;
  }

  for (const [service, password] of Object.entries(servicePasswords)) {
    const check = psql({
      user: service,
      database: service,
      password,
      script: './postgres/verify.sql',
      flags: ['--set', `check_postgis=${service === 'svc_05' ? 'on' : 'off'}`],
    });
    globalThis.console.log(`${service}: ${check}`);
  }
}

function dynamodbAction(action) {
  const output = docker([
    'run', '--rm', '-i', '--network', `container:${dynamodb}`,
    '--env', 'AWS_ACCESS_KEY_ID=LocalOnly',
    '--env', 'AWS_SECRET_ACCESS_KEY=LocalOnlySecret',
    '--env', 'AWS_DEFAULT_REGION=us-east-1',
    '--env', 'AWS_EC2_METADATA_DISABLED=true',
    '--env', 'AWS_CONFIG_FILE=/dev/null',
    '--env', 'AWS_SHARED_CREDENTIALS_FILE=/dev/null',
    '--env', 'AWS_MAX_ATTEMPTS=2',
    '--env', 'NO_PROXY=127.0.0.1',
    '--entrypoint', '/bin/sh', 'amazon/aws-cli:2.27.41', '-s', '--', action,
  ], { input: source('./dynamodb/tables.sh') });
  globalThis.console.log(output);
}

function redisCli(...command) {
  return exec(redis, ['redis-cli', '-e', '--raw', ...command], {
    env: { REDISCLI_AUTH: redisPassword },
  });
}

async function verifyRedis() {
  await waitFor(() => assert.equal(redisCli('PING'), 'PONG'), 'Redis is not ready');
  const key = `svc03:bootstrap:smoke:${randomUUID()}`;
  const value = 'local-smoke';
  assert.equal(redisCli('SET', key, value, 'NX', 'EX', '30'), 'OK');
  try {
    assert.equal(redisCli('GET', key), value);
  } finally {
    redisCli('DEL', key);
  }
  assert.equal(redisCli('EXISTS', key), '0');
  globalThis.console.log('Redis: PONG and TTL-backed write, read and cleanup verified.');
}

const actions = { postgres: postgresAction, dynamodb: dynamodbAction, redis: verifyRedis };
const [action, target, ...extra] = process.argv.slice(2);

try {
  if (!['init', 'verify'].includes(action) || (target && !Object.hasOwn(actions, target)) || extra.length) {
    throw new Error('Usage: databases.mjs <init|verify> [postgres|dynamodb|redis]');
  }
  for (const container of [postgres, dynamodb, redis]) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(container)) {
      throw new Error('Container names must start with a letter or digit and contain only letters, digits, dots, hyphens or underscores.');
    }
  }
  for (const name of target ? [target] : Object.keys(actions)) {
    await actions[name](action);
  }
} catch (error) {
  globalThis.console.error(error.message);
  process.exitCode = 1;
}
