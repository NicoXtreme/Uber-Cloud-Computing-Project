SELECT current_user = current_database()
  AND EXISTS (
    SELECT FROM pg_database
    WHERE datname = current_database() AND pg_get_userbyid(datdba) = current_user
  )
  AND EXISTS (
    SELECT FROM pg_roles
    WHERE rolname = current_user AND rolcanlogin
      AND NOT (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)
  )
  AND (SELECT count(*) FROM pg_database WHERE datname IN ('svc_01', 'svc_05', 'svc_06')) = 3
  AND NOT EXISTS (
    SELECT FROM pg_database
    WHERE datname IN ('svc_01', 'svc_05', 'svc_06')
      AND datname <> current_database()
      AND has_database_privilege(datname, 'CONNECT')
  ) AS ownership_ok
\gset

\if :ownership_ok
  \echo Database ownership and isolation verified.
\else
  \echo Service database ownership or isolation check failed.
  SELECT 1 / 0;
\endif

\if :check_postgis
  WITH points AS (
    SELECT ST_SetSRID(ST_MakePoint(-74.0817, 4.6097), 4326) AS point
  )
  SELECT ST_SRID(point) = 4326
    AND ST_DWithin(point::geography, point::geography, 1) AS postgis_ok
  FROM points
  \gset
  \if :postgis_ok
    SELECT PostGIS_Version() AS postgis_version;
  \else
    \echo PostGIS spatial operation failed.
    SELECT 1 / 0;
  \endif
\else
  SELECT NOT EXISTS (SELECT FROM pg_extension WHERE extname = 'postgis') AS no_postgis
  \gset
  \if :no_postgis
    \echo PostGIS is absent from this service database.
  \else
    \echo PostGIS should be enabled only in the SVC-05 service database.
    SELECT 1 / 0;
  \endif
\endif
