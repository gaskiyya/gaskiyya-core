# Gaskiyya mobile app

Flutter, Cupertino widgets throughout (Human Interface Guidelines type scale, grouped lists, sheets, haptics). Brand: emerald `#0A7A55`, ink `#0E1512`, paper `#F6F5F1` from `brand/`.

```bash
flutter run --dart-define=API_URL=http://<LAN-IP>:8080   # the registry; `pnpm dev` prints this line
flutter test
```

- `lib/src/core/`: API client (digests on the device), session, the shared copy file, text tools.
- The app needs only the registry's address. It lists the enrolled banks from `GET /v1/banks` and signs the customer in at their bank's `customerTokenUrl`; the server's own demo bank appears there automatically.
- `lib/src/ui/screens/`: onboarding, link, check, result sheet, calls, activity, settings.
- `assets/3d/`: 3D icons rendered from `art/scenes.js` with `pnpm render:art`.
- `assets/copy.json`: copied from `packages/schemas/copy.json` by `pnpm sync:copy`. A test fails if they differ.
