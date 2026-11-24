## What changed

<!-- In plain language: what a user sees or what the system now does. Link the issue: "Closes #…". -->

## How it was tested

<!-- Commands run and their results; browser checks for UI changes. -->

## Checklist (Definition of Done, see CONTRIBUTING.md)

- [ ] CI is green
- [ ] `CHANGELOG.md` has a line under **Unreleased** (or this change is invisible to users)
- [ ] New AI calls go through `withAiCall`
- [ ] No pinned fixture bytes changed (`synthetic/`, `public/demo/`, `public/samples/`)
- [ ] No secrets, document contents or `.local/` files committed
- [ ] Screenshots for UI changes (light, dark, phone)
- [ ] Database migration, if any, and the order to apply it on Production:
