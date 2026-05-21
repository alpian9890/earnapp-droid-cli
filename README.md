# earnapp-droid-cli

Scaffold awal CLI Node.js untuk porting flow Android EarnApp menjadi single binary `earndroid`.

Target awal:

- `earndroid signin`
- `earndroid register`
- `earndroid link`
- `earndroid showid`
- `earndroid status`
- `earndroid start`
- `earndroid stop`
- `earndroid uninstall`

## Flow Android yang sudah dimapping

- Consent/onboarding memakai native Android UI.
- SDK UUID berasal dari dynamic dex `com.android.eapx.BrightApi.getSdkUuid()`.
- Format UUID SDK: `sdk-android-` + UUID tanpa hyphen.
- Register device:
  - `POST https://client.earnapp.com/install_device`
  - query: `uuid`, `version=1.565.430`, `arch`, `appid=com.brd.earnrewards`
- Check linked:
  - `GET https://client.earnapp.com/is_linked`
- App config:
  - `GET https://client.earnapp.com/app_config.json`
- Login:
  - Android Google Sign-In meminta `serverAuthCode`.
  - `POST https://earnapp.com/dashboard/api/auth`
  - body: `appid=earnapp`, `code`, `type=google`
- Link device:
  - `POST https://earnapp.com/dashboard/api/link`
  - body: `uuid`, `email`, `access_token`, `type=google`

## Development

```bash
npm install
npm run check
node src/earndroid.js help
```

## Build

Build dilakukan di VPS.

```bash
npm run build:amd64
npm run build:arm64
npm run build:release
```

Output release:

- `release/earndroid-linux-amd64`
- `release/earndroid-linux-arm64`

## Catatan runtime

Command `start` dan `stop` saat ini baru menyimpan state scaffold. Runtime earning asli masih perlu porting dari dynamic SDK `sdk.dex`, terutama jalur `BrightApi.optInSilently`, `BrightApi.optOut`, `srvh`, dan `srvj`.

