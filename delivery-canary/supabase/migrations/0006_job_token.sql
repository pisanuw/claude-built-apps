-- Delivery Canary, migration 0006: pin the scheduled job's token.
--
-- job_token_ok (migration 0005) accepts any well-formed token until
-- job_config holds the SHA-256 of the real one. This stores it, so a token a
-- signed-in user made up for their own schedule's tag stops working and only
-- the canary-run function (which derives the token from DELIVERY_CANARY_KEY)
-- can call the job_* functions. The hash is not secret: the live function
-- shows it at /api/health as jobTokenSha256 (read on 2026-11-17).
--
-- If DELIVERY_CANARY_KEY were ever replaced, every job call would fail with
-- "Bad job token." until a new migration stores the new hash (and the kept
-- passwords could not be opened either: never replace the key).
--
-- Idempotent: re-running it writes the same row.

insert into app_delivery_canary.job_config (id, token_sha256)
values (true, '136d9c797f35161b6fb0f2e1aefe504106844e7ec45875e3a73d6e736482d0f8')
on conflict (id) do update set token_sha256 = excluded.token_sha256;
