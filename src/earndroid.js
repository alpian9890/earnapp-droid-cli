#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const https = require("https");
const os = require("os");
const path = require("path");
const readline = require("readline");
const { URL, URLSearchParams } = require("url");

const APP_NAME = "earndroid-cli";
const CLI_VERSION = "0.1.0";
const ANDROID_PACKAGE = "com.brd.earnrewards";
const ANDROID_CCGI_VERSION = "1.565.430";
const ANDROID_APK_VERSION = "1.607.602";
const SDK_VERSION = "1.597.726";
const GOOGLE_CLIENT_ID = "831814271423-9hq4ubqtaoceqtvjcrg5l2l22oucpbq1.apps.googleusercontent.com";
const CLIENT_BASE = "https://client.earnapp.com";
const DASHBOARD_BASE = "https://earnapp.com";
const OAUTH_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const DEFAULT_OAUTH_PORT = 53682;
const HTTP_TIMEOUT_MS = 30000;

class CliError extends Error {}
class UsageError extends CliError {}

function expandHome(value) {
  if (!value) return value;
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

function configDir() {
  if (process.env.EARNDROID_HOME) return path.resolve(expandHome(process.env.EARNDROID_HOME));
  if (process.env.XDG_CONFIG_HOME) return path.join(path.resolve(expandHome(process.env.XDG_CONFIG_HOME)), APP_NAME);
  return path.join(os.homedir(), ".config", APP_NAME);
}

function statePath() {
  return path.join(configDir(), "state.json");
}

function sessionPath() {
  return path.join(configDir(), "session.json");
}

function ensureConfigDir() {
  fs.mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(configDir(), 0o700);
  } catch (_) {}
}

function sortJsonValue(value) {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = sortJsonValue(value[key]);
    return result;
  }, {});
}

function writeJson(file, data, mode = 0o600) {
  ensureConfigDir();
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(sortJsonValue(data), null, 2)}\n`, { encoding: "utf8", mode });
  try {
    fs.chmodSync(tmp, mode);
  } catch (_) {}
  fs.renameSync(tmp, file);
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    if (error && error.code === "ENOENT") return fallback;
    if (error instanceof SyntaxError) throw new CliError(`File JSON rusak: ${file}: ${error.message}`);
    throw error;
  }
}

function loadState() {
  return readJson(statePath(), {
    android: {
      appid: ANDROID_PACKAGE,
      ccgi_version: ANDROID_CCGI_VERSION,
      apk_version: ANDROID_APK_VERSION,
      sdk_version: SDK_VERSION,
    },
    consent_accepted: false,
    device_installed: false,
    device_linked: false,
    share_active: false,
  });
}

function saveState(state) {
  writeJson(statePath(), state);
}

function loadSession() {
  return readJson(sessionPath(), {});
}

function saveSession(session) {
  writeJson(sessionPath(), session);
}

function removeIfExists(file) {
  try {
    fs.rmSync(file, { force: true });
  } catch (_) {}
}

function parseArgs(argv) {
  const result = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      result._.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    if (eq !== -1) {
      result[arg.slice(2, eq)] = arg.slice(eq + 1);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      result[key] = next;
      i++;
    } else {
      result[key] = true;
    }
  }
  return result;
}

function androidArch() {
  if (process.arch === "arm64") return "arm64-v8a";
  if (process.arch === "x64") return "x86_64";
  if (process.arch === "arm") return "armeabi-v7a";
  return process.arch;
}

function createSdkUuid() {
  return `sdk-android-${crypto.randomUUID().replace(/-/g, "")}`;
}

function ensureDeviceId(state) {
  if (!state.sdk_uuid) {
    state.sdk_uuid = createSdkUuid();
    state.sdk_uuid_source = "cli-generated";
    state.sdk_uuid_created_at = new Date().toISOString();
    saveState(state);
  }
  return state.sdk_uuid;
}

function buildQuery(pathname, params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) search.set(key, String(value));
  }
  return `${pathname}?${search.toString()}`;
}

function defaultHeaders(extra = {}) {
  return {
    "accept": "application/json, text/plain, */*",
    "user-agent": `EarnApp/${ANDROID_APK_VERSION} (${ANDROID_PACKAGE}; Android CLI; ${androidArch()}) earndroid/${CLI_VERSION}`,
    ...extra,
  };
}

function request(method, urlString, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const body = options.body === undefined ? null : options.body;
    const headers = defaultHeaders(options.headers || {});
    let payload = null;

    if (body !== null) {
      if (Buffer.isBuffer(body) || typeof body === "string") {
        payload = body;
      } else {
        payload = Buffer.from(JSON.stringify(body));
        headers["content-type"] = headers["content-type"] || "application/json; charset=utf-8";
      }
      headers["content-length"] = Buffer.byteLength(payload);
    }

    const req = https.request({
      method,
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || 443,
      path: `${url.pathname}${url.search}`,
      headers,
      timeout: HTTP_TIMEOUT_MS,
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        const contentType = String(res.headers["content-type"] || "");
        let data = text;
        if (contentType.includes("json") || /^[\s\r\n]*[{[]/.test(text)) {
          try {
            data = text ? JSON.parse(text) : null;
          } catch (_) {}
        }
        resolve({ statusCode: res.statusCode || 0, headers: res.headers, data, text });
      });
    });

    req.on("timeout", () => req.destroy(new CliError(`Request timeout: ${method} ${urlString}`)));
    req.on("error", reject);
    if (payload !== null) req.write(payload);
    req.end();
  });
}

async function requestJson(method, url, options = {}) {
  const res = await request(method, url, options);
  if (res.statusCode < 200 || res.statusCode >= 300) {
    const body = typeof res.data === "string" ? res.data.slice(0, 300) : JSON.stringify(res.data);
    throw new CliError(`${method} ${url} gagal: HTTP ${res.statusCode}: ${body}`);
  }
  if (typeof res.data === "string") {
    try {
      return JSON.parse(res.data);
    } catch (_) {
      return { raw: res.data };
    }
  }
  return res.data || {};
}

function ccgiParams(state) {
  return {
    uuid: ensureDeviceId(state),
    version: ANDROID_CCGI_VERSION,
    arch: androidArch(),
    appid: ANDROID_PACKAGE,
  };
}

async function installDevice(state) {
  const url = `${CLIENT_BASE}${buildQuery("/install_device", ccgiParams(state))}`;
  const data = await requestJson("POST", url);
  const ok = data && (data.ok === 1 || data.ok === true);
  if (!ok) throw new CliError(`install_device ditolak: ${JSON.stringify(data)}`);
  state.device_installed = true;
  state.device_installed_at = new Date().toISOString();
  saveState(state);
  return data;
}

async function refreshLinked(state) {
  const url = `${CLIENT_BASE}${buildQuery("/is_linked", ccgiParams(state))}`;
  const data = await requestJson("GET", url);
  state.device_linked = Boolean(data.linked);
  if (data.user) state.user_email = data.user;
  if (data.user_id) state.user_id = data.user_id;
  state.last_link_check_at = new Date().toISOString();
  saveState(state);
  return data;
}

async function refreshAppConfig(state) {
  const url = `${CLIENT_BASE}${buildQuery("/app_config.json", ccgiParams(state))}`;
  const data = await requestJson("GET", url);
  state.app_config = {
    min_ver: data.min_ver || null,
    update_url: data.update_url || null,
    force_update: Boolean(data.force_update),
    force_mobile_data: Boolean(data.force_mobile_data),
    server_bw_total: data.server_bw_total || 0,
    redeem_bw_total: data.redeem_bw_total || 0,
    earnings_total: data.earnings_total || 0,
    redeem_earnings_total: data.redeem_earnings_total || 0,
    qualified_uptime: data.qualified_uptime || null,
  };
  state.last_config_check_at = new Date().toISOString();
  saveState(state);
  return data;
}

async function authWithCode(code) {
  return requestJson("POST", `${DASHBOARD_BASE}/dashboard/api/auth`, {
    body: {
      appid: "earnapp",
      code,
      type: "google",
    },
  });
}

async function linkDevice(state, session) {
  const uuid = ensureDeviceId(state);
  const email = session.email || state.user_email;
  const token = session.id_token || session.user_Auth_key;
  if (!email) throw new UsageError("Email belum ada. Jalankan `earndroid signin` lebih dulu.");
  if (!token) throw new UsageError("Access token belum ada. Jalankan `earndroid signin` lebih dulu.");

  const data = await requestJson("POST", `${DASHBOARD_BASE}/dashboard/api/link`, {
    body: {
      uuid,
      email,
      access_token: token,
      type: "google",
    },
  });
  const ok = data && (data.ok === true || data.ok === 1);
  if (!ok) throw new CliError(`link ditolak: ${JSON.stringify(data)}`);
  state.device_linked = true;
  state.user_email = email;
  state.linked_at = new Date().toISOString();
  saveState(state);
  return data;
}

function oauthUrl(port, stateValue) {
  const redirectUri = `http://127.0.0.1:${port}/callback`;
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    access_type: "offline",
    prompt: "select_account",
    state: stateValue,
  });
  return { url: `${OAUTH_AUTH_URL}?${params.toString()}`, redirectUri };
}

async function waitForOAuthCode(port) {
  const stateValue = crypto.randomBytes(16).toString("hex");
  const { url } = oauthUrl(port, stateValue);
  console.log("Buka URL ini di browser dan login dengan akun Google:");
  console.log(url);
  console.log("");
  console.log("Menunggu callback lokal. Jika Google menolak redirect URI Android client, gunakan `earndroid signin --code <serverAuthCode>`.");

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      server.close(() => reject(new CliError("Timeout menunggu OAuth callback.")));
    }, 5 * 60 * 1000);

    const server = http.createServer((req, res) => {
      try {
        const incoming = new URL(req.url, `http://127.0.0.1:${port}`);
        if (incoming.pathname !== "/callback") {
          res.writeHead(404);
          res.end("Not found");
          return;
        }
        const error = incoming.searchParams.get("error");
        if (error) {
          res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
          res.end(`OAuth error: ${error}`);
          clearTimeout(timer);
          server.close(() => reject(new CliError(`OAuth error: ${error}`)));
          return;
        }
        if (incoming.searchParams.get("state") !== stateValue) {
          res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
          res.end("Invalid state");
          return;
        }
        const code = incoming.searchParams.get("code");
        if (!code) {
          res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
          res.end("Missing code");
          return;
        }
        res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
        res.end("Login diterima. Anda bisa kembali ke terminal.");
        clearTimeout(timer);
        server.close(() => resolve(code));
      } catch (error) {
        clearTimeout(timer);
        server.close(() => reject(error));
      }
    });

    server.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    server.listen(port, "127.0.0.1");
  });
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function cmdConsent(args) {
  const state = loadState();
  let agree = args.agree === true;
  let disagree = args.disagree === true;
  if (!agree && !disagree) {
    const answer = await ask("Do you agree to EarnApp terms and internet sharing consent? [y/N] ");
    agree = /^y(es)?$/i.test(answer.trim());
    disagree = !agree;
  }
  state.consent_accepted = agree;
  state.share_active = agree;
  state.consent_updated_at = new Date().toISOString();
  saveState(state);
  console.log(agree ? "Consent accepted. share_active=true" : "Consent declined. share_active=false");
}

async function cmdShowId(args) {
  const state = loadState();
  if (args.reset) {
    state.sdk_uuid = createSdkUuid();
    state.sdk_uuid_source = "cli-generated";
    state.sdk_uuid_created_at = new Date().toISOString();
    state.device_installed = false;
    state.device_linked = false;
    saveState(state);
  }
  console.log(ensureDeviceId(state));
}

async function cmdRegister() {
  const state = loadState();
  const uuid = ensureDeviceId(state);
  await installDevice(state);
  console.log(`Device installed: ${uuid}`);
}

async function cmdSignin(args) {
  const state = loadState();
  const session = loadSession();
  const code = args.code || args.auth_code || args["auth-code"] || await waitForOAuthCode(Number(args.port || DEFAULT_OAUTH_PORT));
  const data = await authWithCode(code);
  if (!data.id_token || !data.email) {
    throw new CliError(`Response auth tidak sesuai: ${JSON.stringify(data)}`);
  }
  session.email = data.email;
  session.id_token = data.id_token;
  session.user_Auth_key = data.id_token;
  session.logged_in = true;
  session.authenticated_at = new Date().toISOString();
  saveSession(session);

  state.user_email = data.email;
  state.logged_in = true;
  saveState(state);
  console.log(`Signed in: ${data.email}`);

  if (args["no-link"] !== true) {
    try {
      await linkDevice(state, session);
      console.log(`Device linked: ${state.sdk_uuid}`);
    } catch (error) {
      console.log(`Auto-link belum berhasil: ${error.message}`);
    }
  }
}

async function cmdLink() {
  const state = loadState();
  const session = loadSession();
  await linkDevice(state, session);
  console.log(`Device linked: ${state.sdk_uuid}`);
}

async function cmdStatus(args) {
  const state = loadState();
  const session = loadSession();
  ensureDeviceId(state);
  if (args.refresh) {
    try {
      await refreshLinked(state);
    } catch (error) {
      console.log(`is_linked refresh gagal: ${error.message}`);
    }
    try {
      await refreshAppConfig(state);
    } catch (error) {
      console.log(`app_config refresh gagal: ${error.message}`);
    }
  }
  const current = loadState();
  const summary = {
    version: CLI_VERSION,
    config_dir: configDir(),
    sdk_uuid: current.sdk_uuid,
    sdk_uuid_source: current.sdk_uuid_source || "unknown",
    consent_accepted: Boolean(current.consent_accepted),
    share_active: Boolean(current.share_active),
    logged_in: Boolean(session.logged_in || current.logged_in),
    user_email: session.email || current.user_email || "",
    device_installed: Boolean(current.device_installed),
    device_linked: Boolean(current.device_linked),
    runtime_ported: false,
    android: current.android,
  };
  console.log(JSON.stringify(summary, null, 2));
}

async function cmdStart() {
  const state = loadState();
  ensureDeviceId(state);
  if (!state.consent_accepted) {
    throw new UsageError("Consent belum accepted. Jalankan `earndroid consent --agree` dulu.");
  }
  state.share_active = true;
  state.runtime_status = "pending-sdk-runtime-port";
  state.runtime_note = "Android SDK optIn/start service belum selesai diport ke Node.js.";
  state.started_at = new Date().toISOString();
  saveState(state);
  console.log("share_active=true");
  console.log("Runtime Android SDK belum diport; command ini baru menyimpan state scaffold.");
}

async function cmdStop() {
  const state = loadState();
  state.share_active = false;
  state.runtime_status = "stopped";
  state.stopped_at = new Date().toISOString();
  saveState(state);
  console.log("share_active=false");
}

async function cmdUninstall(args) {
  if (args.yes !== true) {
    const answer = await ask(`Hapus config ${configDir()}? [y/N] `);
    if (!/^y(es)?$/i.test(answer.trim())) {
      console.log("Dibatalkan.");
      return;
    }
  }
  removeIfExists(statePath());
  removeIfExists(sessionPath());
  try {
    fs.rmdirSync(configDir());
  } catch (_) {}
  console.log("Config earndroid dihapus.");
}

function printHelp() {
  console.log(`earndroid ${CLI_VERSION}

Usage:
  earndroid help
  earndroid consent [--agree|--disagree]
  earndroid signin [--code <serverAuthCode>] [--no-link] [--port <port>]
  earndroid signup [--code <serverAuthCode>] [--no-link]
  earndroid register
  earndroid link
  earndroid showid [--reset]
  earndroid status [--refresh]
  earndroid start
  earndroid stop
  earndroid uninstall [--yes]

Notes:
  signin follows the Android flow: Google serverAuthCode -> /dashboard/api/auth.
  register follows the Android CCGI flow: /install_device with sdk_uuid/version/arch/appid.
  start/stop are scaffolded state commands until the dynamic SDK runtime is fully ported.
`);
}

async function main() {
  const argv = process.argv.slice(2);
  const command = argv[0] || "help";
  const args = parseArgs(argv.slice(1));
  try {
    if (command === "help" || command === "--help" || command === "-h") return printHelp();
    if (command === "consent") return await cmdConsent(args);
    if (command === "signin" || command === "signup") return await cmdSignin(args);
    if (command === "register") return await cmdRegister(args);
    if (command === "link") return await cmdLink(args);
    if (command === "showid") return await cmdShowId(args);
    if (command === "status") return await cmdStatus(args);
    if (command === "start") return await cmdStart(args);
    if (command === "stop") return await cmdStop(args);
    if (command === "uninstall") return await cmdUninstall(args);
    throw new UsageError(`Command tidak dikenal: ${command}`);
  } catch (error) {
    const prefix = error instanceof UsageError ? "Usage error" : "Error";
    console.error(`${prefix}: ${error.message || error}`);
    process.exit(1);
  }
}

main();
