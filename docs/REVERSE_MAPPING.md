# Reverse Mapping

Referensi hasil decompile yang dipakai untuk scaffold awal.

## APK metadata

- Package: `com.brd.earnrewards`
- Manifest versionName: `1.607.602`
- CCGI helper version: `1.565.430`
- SDK version in sideload logs: `1.597.726`

## Onboarding and consent

- Launcher: `com.brd.earnrewards.ConsentActivity`
- Consent accepted stores:
  - `consent_accepted=true`
  - `share_active=true`
- Onboarding buttons:
  - `i_agree`: `Let's Go Start Earning $$!`
  - `i_disagree`: `Skip, Maybe Later...`

## Device UUID

Wrapper class `h.C0218b` loads `sdk.dex`, class `com.android.eapx.BrightApi`, then calls:

- `BrightApi.init` / `initSilently`
- `BrightApi.getSdkUuid`
- `BrightApi.optInSilently`
- `BrightApi.optOut`

SDK method path:

- `BrightApi.getSdkUuid()`
- `main.get_sdk_uuid(Context)`
- `util.T()`
- `util.s()`

Decoded generated UUID prefix:

```text
sdk-android-
```

The suffix is `UUID.randomUUID().toString().replace("-", "")`.

## Device API

Class: `com.brd.earnrewards.f`

Common query params:

- `uuid`
- `version=1.565.430`
- `arch=Build.CPU_ABI`
- `appid=context.getPackageName()`

Endpoints:

- `POST https://client.earnapp.com/install_device?...`
- `GET https://client.earnapp.com/is_linked?...`
- `GET https://client.earnapp.com/app_config.json?...`

## Auth API

Class: `com.brd.earnrewards.HomeActivity`

Google client ID:

```text
831814271423-9hq4ubqtaoceqtvjcrg5l2l22oucpbq1.apps.googleusercontent.com
```

Android gets `serverAuthCode`, then calls:

```text
POST https://earnapp.com/dashboard/api/auth
```

JSON body:

```json
{
  "appid": "earnapp",
  "code": "<serverAuthCode>",
  "type": "google"
}
```

The response stores:

- `email`
- `id_token` as `user_Auth_key`

## Link API

Class: `com.brd.earnrewards.HomeActivity`

```text
POST https://earnapp.com/dashboard/api/link
```

JSON body:

```json
{
  "uuid": "<sdk_uuid>",
  "email": "<email>",
  "access_token": "<id_token>",
  "type": "google"
}
```

Success requires `ok=true` or `ok=1`.

## Runtime still pending

Android runtime path still needs deeper porting:

- `BrightApi.optInSilently(Context)`
- `BrightApi.optOut(Context)`
- `com.android.eapx.srvh`
- `com.android.eapx.srvj`
- side-loaded service proxy classes under `com.brd.sdksideload`

