const {logger} = require('../api/utils/logger');
const {parseEnvArray} = require('../api/utils');

const TASKS_CHANNEL = 'local';
const starts = {
  [TASKS_CHANNEL]: process.hrtime(),
};

const queue = [];
let consumer = null;
let processing = false;
let availableOne = true;

const keys = parseEnvArray('TGPHTOKEN');

function elapsedMs(queueName = TASKS_CHANNEL) {
  const start = starts[queueName] || process.hrtime();
  const diff = process.hrtime(start);
  return `${diff[0]}s, ${(diff[1] / 1000000).toFixed(0)}ms ${queueName}`;
}

function resetTime(queueName = TASKS_CHANNEL) {
  starts[queueName] = process.hrtime();
}

async function drain() {
  if (!consumer || processing) {
    return;
  }

  processing = true;

  while (queue.length) {
    const {task, queueName} = queue.shift();

    try {
      availableOne = false;
      await consumer(queueName === TASKS_CHANNEL ? task : {...task, q: queueName});
    } catch (error) {
      logger('error local queue job');
      logger(error);
    } finally {
      availableOne = true;
    }
  }

  processing = false;
}

function startFirst() {
  return Promise.resolve();
}

function runMqChannels(job) {
  consumer = job;
  void drain();
}

function addToChannel(task, queueName = TASKS_CHANNEL) {
  queue.push({task, queueName});
  void drain();
}

function shuffle(arr) {
  const items = [...arr];

  for (let i = items.length - 1; i > 0; i -= 1) {
    const randomIndex = Math.floor(Math.random() * (i + 1));
    const temp = items[i];
    items[i] = items[randomIndex];
    items[randomIndex] = temp;
  }

  return items;
}

function getKey() {
  if (!keys.length) {
    return undefined;
  }

  const hours = new Date().getHours();
  const shuffledKeys = shuffle(keys);

  return shuffledKeys.find((key, index) => hours <= (24 / keys.length) * (index + 1)) || keys[0];
}

function getMqParams() {
  return {
    isPuppet: false,
    access_token: getKey(),
  };
}

function time(queueName = TASKS_CHANNEL, start = false) {
  const duration = elapsedMs(queueName);

  if (start) {
    resetTime(queueName);
  }

  return duration;
}

function timeStart(queueName = TASKS_CHANNEL) {
  availableOne = false;
  return time(queueName, true);
}

function getQueueStats() {
  return {
    queued: queue.length,
    processing,
    availableOne,
  };
}

module.exports.startFirst = startFirst;
module.exports.addToChannel = addToChannel;
module.exports.getMqParams = getMqParams;
module.exports.time = time;
module.exports.runMqChannels = runMqChannels;
module.exports.timeStart = timeStart;
module.exports.getQueueStats = getQueueStats;
