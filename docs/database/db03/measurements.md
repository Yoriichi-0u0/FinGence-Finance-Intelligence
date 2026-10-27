# DB03 local recovery measurements

Final run: [2026-10-27T10-32-36-772Z/recovery.json](evidence/2026-10-27T10-32-36-772Z/recovery.json). PostgreSQL 18.6 Windows x86-64; fresh loopback-only clusters; 16 MiB shared buffers, 1 MiB WAL segments, fsync/full_page_writes/synchronous_commit on. These settings and the tiny representative fixture are disclosed to prevent production extrapolation.

| Operation | Measured duration | Definition |
| --- | ---: | --- |
| Logical custom backup | 247.245 ms | pg_dump command |
| Logical restoration | 178.337 ms | Transactional pg_restore command |
| Logical restoration + snapshot verification | 218.288 ms | Restore invocation through data/schema equality checks |
| Physical full backup | 2,301.987 ms | pg_basebackup command with streamed WAL |
| Physical backup verification | 299.392 ms | pg_verifybackup command |
| Physical recovery | 5,091.393 ms | Copy to new directory, configure, start and wait for promotion |
| Physical recovery + snapshot verification | 5,146.808 ms | Recovery plus independent data/schema checks |
| PITR recovery | 4,724.247 ms | Copy/configure/start, target recovery, promotion and target connection |
| PITR recovery + snapshot verification | 4,813.868 ms | PITR plus boundary data/schema checks |

Target cluster initialization/role provisioning, source fixture generation, incident response, infrastructure provisioning and broader application acceptance are outside the restore duration figures. Full selected test execution took 101.67 seconds, including unrelated regression suites; that is not a recovery-time metric. No averages, p95s or throughput forecasts are inferred from these single recovery operations. Earlier successful physical-backup commands varied materially (roughly 10.7–10.9 seconds); the authoritative run is selected by latest successful complete verification, not fastest timing.

| Artifact | Size / integrity |
| --- | --- |
| Custom logical archive | 34,978 bytes; pg_dump exit 0; checksum verified before restore |
| Logical SHA-256 | `193ee46e89c1aee53814903f0138bc48c842c77b333e2ab69c794aec524eab93` |
| Physical backup tree | 26,468,925 bytes in 995 files; backup and verification exit 0 |
| Physical manifest SHA-256 | `c7e6e19571f1a5469e16eb21cd5ec6e3840e2ad6dfd774a3162f37b662e0adaa` |
| Archived WAL/history metadata files | 5 files, 4,194,639 bytes; used to recover the named boundary |

Raw archives, WAL and successful cluster directories were removed only after the owned test lab finished successfully. Full physical backup manifests retained under evidence are integrity **metadata**, not a database backup or a replacement for the removed files. They contain relative filenames/sizes/hashes from synthetic clusters; no database pages, WAL segments or role password dumps are included.

RPO describes potential data loss relative to a recoverable point. RTO describes elapsed recovery to an operationally accepted service. Here the deliberately selected point includes the before-target group and excludes the later committed group; it is not an estimate of time-based production data loss. The measured local restoration/validation durations are not hosted Supabase or production RTO guarantees. Production RPO/RTO targets, retention, restore granularity and service dependencies remain operational decisions.
