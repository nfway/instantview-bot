const path = require('path');
const fs = require('fs');

const messages = require('../messages/format');

const envPath = path.join(__dirname, '../../.env');
const unableToStart = [];
const {env} = process;
const REQUIRED_ENV_KEYS = ['TBTKN', 'TGADMIN', 'TGPHTOKEN_0'];

function parseIdList(value) {
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
    .map(item => Number.parseInt(item, 10))
    .filter(item => Number.isInteger(item) && item > 0);
}

const confFile = path.join(__dirname, '../../.conf');
if (!fs.existsSync(confFile)) {
  fs.mkdirSync(confFile);
}

const docsDir = path.join(__dirname, '../../.docs');
if (!fs.existsSync(docsDir)) {
  fs.mkdirSync(docsDir);
}

const blacklistFile = path.join(__dirname, '../../.conf/blacklist.txt');
if (!fs.existsSync(blacklistFile)) {
  fs.writeFileSync(blacklistFile, '');
}

function stripWrappingQuotes(value) {
  if (!value) {
    return value;
  }

  const firstChar = value[0];
  const lastChar = value[value.length - 1];
  if ((firstChar === '"' && lastChar === '"') || (firstChar === "'" && lastChar === "'")) {
    return value.slice(1, -1);
  }

  return value;
}

function loadEnvFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const equalIndex = line.indexOf('=');
    if (equalIndex < 0) {
      continue;
    }

    const key = line.slice(0, equalIndex).trim().replace(/^export\s+/, '');
    const value = stripWrappingQuotes(line.slice(equalIndex + 1).trim());
    if (key && env[key] === undefined) {
      env[key] = value;
    }
  }
}

if (fs.existsSync(envPath)) {
  loadEnvFile(envPath);
}

const missingRequiredEnv = REQUIRED_ENV_KEYS.filter(key => !env[key]);
if (missingRequiredEnv.length) {
  unableToStart.push(
    `${messages.errorEnv()} Missing: ${missingRequiredEnv.join(', ')}`,
  );
}

if (unableToStart.length) {
  console.log(unableToStart.join('\n'));
  process.exit(1);
}

const BOT_IS_OFF = env.NO_BOT === '1';
const allowedUserIds = parseIdList(env.ALLOWED_USER_IDS);

if (BOT_IS_OFF) {
  console.log('bot is off');
}

module.exports = {
  BLACK_LIST_FILE: blacklistFile,
  BOT_USERNAME: env.BOT_USERNAME || '_no_username',
  WORKER: env.WORKER,
  NO_BOT: BOT_IS_OFF,
  IS_PUPPET_DISABLED: env.NO_PUPPET === '1',
  T_B_TKN: !BOT_IS_OFF && env.TBTKN,
  NO_MQ: true,
  NO_DB: true,
  NO_PARSE: env.NO_PARSE === '1',
  IS_DEV: env.DEV,
  REST_API: env.REST_API,
  HEADLESS: env.HDLSS,
  TG_ADMIN_ID: env.TGADMIN,
  ALLOWED_USER_IDS: allowedUserIds,
  SINGLE_USER_ID: env.SINGLE_USER_ID || env.TGADMIN,
  TG_GROUP: env.TGGROUP,
  TG_BUGS_GROUP: env.TGGROUPBUGS,
  IV_MAKING_TIMEOUT: env.IV_MAKING_TIMEOUT,
  IV_CHAN_ID: Number(env.IV_CHAN_ID),
  IV_CHAN_MID: Number(env.IV_CHAN_MID),
  IV_CHAN_MID_2: Number(env.IV_CHAN_MID_2),
  HELP_MESSAGE: env.HELP_MESSAGE,
  DEV_USERNAME: env.DEV_USERNAME,
  docsDir,
};
