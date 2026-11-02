-- Runs once, when the Postgres volume is first created.
-- The development database (devflow) comes from POSTGRES_DB; tests use their own.
CREATE DATABASE devflow_test;
