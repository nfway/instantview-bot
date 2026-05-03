const fs = require('fs');
const path = require('path');

const {logger} = require('./logger');
const {dbKeys} = require('../../config/consts');

const STATE_FILE = path.join(__dirname, '../../../.conf/state.json');
const DEFAULT_STATE = {
  version: 1,
  links: {},
  inline: {},
  counters: [],
};

let stateCache;

function readState() {
  if (stateCache) {
    return stateCache;
  }

  try {
    stateCache = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch (error) {
    stateCache = {...DEFAULT_STATE};
    writeState();
  }

  stateCache.links = stateCache.links || {};
  stateCache.inline = stateCache.inline || {};
  stateCache.counters = Array.isArray(stateCache.counters) ? stateCache.counters : [];

  return stateCache;
}

function writeState() {
  fs.writeFileSync(STATE_FILE, JSON.stringify(stateCache, null, 2));
}

function isMoreThanADay(date) {
  if (!date) {
    return true;
  }

  const oneDay = 24 * 60 * 60 * 1000;
  return Date.now() - new Date(date).getTime() > oneDay;
}

function normalizeCollection(collection) {
  if (collection === dbKeys.counter) {
    return 'counters';
  }

  return collection || 'links';
}

function toPlainObject(entry) {
  if (!entry) {
    return false;
  }

  return JSON.parse(JSON.stringify(entry));
}

function getCounterIndexes(filter = {}) {
  const state = readState();

  return state.counters
    .map((item, index) => ({item, index}))
    .filter(({item}) =>
      Object.entries(filter).every(([key, value]) => item[key] === value),
    )
    .map(({index}) => index);
}

function getCounterIndex(filter = {}) {
  const indexes = getCounterIndexes(filter);

  if (!indexes.length) {
    return -1;
  }

  return indexes[indexes.length - 1];
}

function stat() {
  return Promise.resolve(
    Object.values(readState().links).filter(item => item && item.iv).length,
  );
}

async function clearFromCollection(msg) {
  const {text} = msg;
  const state = readState();

  let search;
  let months = 1;

  if (text.match(/^\/cleardb3_/)) {
    const foundMonths = text.match(/mon([0-9]+)/);
    if (foundMonths) {
      months = +foundMonths[1];
    }

    search = text.replace('/cleardb3_', '');
    search = search.replace(/\s(.*?)$/, '');
    search = search.replace(/_/g, '.');
  } else {
    search = text.replace('/cleardb', '').trim();
  }

  if (!search) {
    return 'empty';
  }

  const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const searchByDomain = new RegExp(`^https?://${escapedSearch}`);
  const fromDate = new Date();
  fromDate.setMonth(fromDate.getMonth() - months);

  let removed = 0;
  for (const [url, value] of Object.entries(state.links)) {
    const createdAt = value.createdAt || value.updatedAt;
    if (searchByDomain.test(url) && createdAt && new Date(createdAt) <= fromDate) {
      delete state.links[url];
      removed += 1;
    }
  }

  writeState();

  return `${JSON.stringify({deletedCount: removed})} - ${searchByDomain} - ${JSON.stringify(fromDate)}`;
}

function removeInline(url) {
  const state = readState();
  delete state.inline[url];
  writeState();
  return Promise.resolve();
}

function updateMapEntry(item, collection) {
  const state = readState();
  const now = new Date().toISOString();
  const bucket = state[collection];
  const current = bucket[item.url];

  bucket[item.url] = {
    ...(current || {createdAt: now}),
    ...item,
    updatedAt: now,
  };

  if (!bucket[item.url].createdAt) {
    bucket[item.url].createdAt = now;
  }

  writeState();
  return Promise.resolve(toPlainObject(bucket[item.url]));
}

function updateCounterEntry(item) {
  const state = readState();
  const now = new Date().toISOString();
  const {$inc, ...plainItem} = item;
  const identity = {};

  if (plainItem.url !== undefined) {
    identity.url = plainItem.url;
  }
  if (plainItem.iv !== undefined) {
    identity.iv = plainItem.iv;
  }
  if (plainItem.chanId !== undefined) {
    identity.chanId = plainItem.chanId;
  }
  if (plainItem.userId !== undefined) {
    identity.userId = plainItem.userId;
  }

  let index = getCounterIndex(identity);
  let current = index >= 0 ? state.counters[index] : null;

  if (current && isMoreThanADay(current.updatedAt)) {
    current = null;
  }

  const next = {
    ...(current || {createdAt: now}),
    ...identity,
    ...plainItem,
    updatedAt: now,
  };

  if ($inc) {
    for (const [key, value] of Object.entries($inc)) {
      next[key] = (next[key] || 0) + value;
    }
  }

  if (plainItem.iv && !$inc?.af) {
    next.af = (current && current.af) || 0;
    next.af += 1;
  }

  if (index >= 0) {
    state.counters[index] = next;
  } else {
    state.counters.push(next);
  }

  writeState();
  return Promise.resolve(toPlainObject(next));
}

function updateOneLink(item, collection = 'links') {
  const normalizedCollection = normalizeCollection(collection);

  if (normalizedCollection === 'counters') {
    return updateCounterEntry(item);
  }

  if (!item || !item.url) {
    logger(`skip empty update for ${normalizedCollection}`);
    return Promise.resolve(false);
  }

  return updateMapEntry(item, normalizedCollection);
}

async function getFromCollection(url, collection, insert = true) {
  const state = readState();
  const bucket = state[collection];
  const entry = bucket[url] || null;

  if (insert) {
    await updateOneLink({url}, collection);
  }

  return toPlainObject(entry);
}

async function getInline(url) {
  return getFromCollection(url, 'inline');
}

async function getIV(url) {
  return getFromCollection(url, 'links');
}

function checkTimeFromLast() {
  const links = Object.values(readState().links);
  const last = links.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))[0];
  return Promise.resolve(toPlainObject(last));
}

function get(params) {
  if (params.key !== dbKeys.counter) {
    return Promise.resolve(null);
  }

  const index = getCounterIndex(params.filter || {});
  if (index < 0) {
    return Promise.resolve(null);
  }

  const item = readState().counters[index];
  if (isMoreThanADay(item.updatedAt)) {
    return Promise.resolve(null);
  }

  return Promise.resolve(toPlainObject(item));
}

async function getCleanData(txt) {
  const nums = txt.match(/[0-9]+/);
  let threshold = 4000;

  if (nums) {
    threshold = +nums[0];
  }

  const counters = {};
  for (const url of Object.keys(readState().links)) {
    let hostname = '';

    try {
      hostname = new URL(url).hostname;
    } catch (error) {
      continue;
    }

    counters[hostname] = (counters[hostname] || 0) + 1;
  }

  return Object.entries(counters)
    .filter(([, count]) => count >= threshold)
    .map(([hostname, count]) => `${hostname.replace(/\./g, '_')} ${count}`);
}

function getCol(key) {
  return key;
}

module.exports.stat = stat;
module.exports.clearFromCollection = clearFromCollection;
module.exports.updateOneLink = updateOneLink;
module.exports.removeInline = removeInline;
module.exports.getInline = getInline;
module.exports.getIV = getIV;
module.exports.checkTimeFromLast = checkTimeFromLast;
module.exports.getCleanData = getCleanData;
module.exports.getCol = getCol;
module.exports.get = get;
