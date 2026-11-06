# Disposable PostgreSQL fixtures only

The four SQL files here are exact copies of DB04 001–004 at
`901109b9057bfeb927367955bdc69d2e346a09e4`.
The native test runner installs them only into its newly initialized loopback cluster,
after existing local M2/M3 fixtures. They are not approved group migrations.
Do not run them against group Supabase. Actual catalog/identity compatibility must be
verified before preparing a separately reviewed group migration package.
