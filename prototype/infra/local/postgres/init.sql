\getenv svc_01_password LOCAL_SVC_01_PASSWORD
\getenv svc_05_password LOCAL_SVC_05_PASSWORD
\getenv svc_06_password LOCAL_SVC_06_PASSWORD

-- Serialize database creation because CREATE DATABASE cannot run inside a transaction.
SELECT pg_advisory_lock(44004);

SELECT format('CREATE ROLE %I', service)
FROM (VALUES ('svc_01'), ('svc_05'), ('svc_06')) AS services(service)
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = service)
\gexec

SELECT format(
  'ALTER ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD %L',
  service, password
)
FROM (VALUES
  ('svc_01', :'svc_01_password'),
  ('svc_05', :'svc_05_password'),
  ('svc_06', :'svc_06_password')
) AS services(service, password)
\gexec

SELECT format('CREATE DATABASE %I WITH OWNER %I TEMPLATE template0', service, service)
FROM (VALUES ('svc_01'), ('svc_05'), ('svc_06')) AS services(service)
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = service)
\gexec

REVOKE ALL ON DATABASE svc_01, svc_05, svc_06 FROM PUBLIC;
SELECT pg_advisory_unlock(44004);
