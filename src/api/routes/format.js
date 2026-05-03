const url = require('url');

const keyboards = require('../../keyboards/keyboards');
const BUTTONS = require('../../config/buttons');
const messages = require('../../messages/format');
const rabbitMq = require('../../service/rabbitmq');
const {
  IS_PUPPET_DISABLED,
  IV_CHAN_ID,
  IV_CHAN_MID,
  IV_CHAN_MID_2,
} = require('../../config/vars');
const db = require('../utils/db');
const {
  commandCheck,
  timeout,
  toUrl,
  isDateMoreADay,
} = require('../utils');
const {logger} = require('../utils/logger');
const puppet = require('../utils/puppet');
const {getAllLinks, getLinkFromEntity, getLink} = require('../utils/links');
const {jobMessage} = require('../../service/jobMessage');
const {dbKeys} = require('../../config/consts');

global.lastIvTime = +new Date();
global.lastUnauthorizedAlertTime = 0;
global.emptyTextCount = 0;

const validRegex = '^(https?:\\/\\/)?(www\\.)?(graph\\.org|telegra\\.ph|www\\.youtube\\.com\\/watch)';
const PDF_LINK = 'https://pdf.pdf/pdf';
const UNAUTHORIZED_ALERT_INTERVAL = 3600 * 1000;

rabbitMq.startFirst();

const support = async (ctx, botHelper) => {
  let system = JSON.stringify(ctx.message.from);
  const {
    chat: {id: chatId},
  } = ctx.message;

  try {
    if (!Number.isNaN(IV_CHAN_MID)) {
      botHelper.forwardMes(IV_CHAN_MID, IV_CHAN_ID * -1, chatId).catch(() => {});
    }
    if (!Number.isNaN(IV_CHAN_MID_2)) {
      botHelper.forwardMes(IV_CHAN_MID_2, IV_CHAN_ID * -1, chatId).catch(() => {});
    }
  } catch (error) {
    system = `${error}${system}`;
  }

  botHelper.sendAdmin(`support ${system}`);
};

const startOrHelp = (ctx, botHelper) => {
  try {
    ctx.reply(messages.start(), keyboards.start());
  } catch (error) {
    botHelper.sendError(error);
  }

  return botHelper.sendAdmin(JSON.stringify(ctx.message.from));
};

async function queueInlineQuery(msg, botHelper) {
  const {id} = msg.update.inline_query;
  let {query} = msg.update.inline_query;
  const userId = msg.from.id;

  if (!botHelper.isAllowedUser(userId)) {
    return;
  }

  query = query.trim();
  const links = getAllLinks(query);
  if (links.length === 0) {
    const res = {
      type: 'article',
      id,
      title: 'Links not found',
      cache_time: 0,
      is_personal: true,
      input_message_content: {message_text: 'Links not found'},
    };

    return msg.answerInlineQuery([res]).catch(() => {});
  }

  const link = toUrl(links[0]);
  const ivObj = await db.getIV(link).catch(() => false);
  if (ivObj && ivObj.iv) {
    return botHelper.sendInline({messageId: id, ivLink: ivObj.iv}).catch(error => {
      logger('sendInline');
      logger(error);
    });
  }

  const exist = await db.getInline(link).catch(() => false);
  const res = {
    type: 'article',
    id,
    title: 'Waiting for InstantView... Type any symbol to check',
    input_message_content: {message_text: link},
  };

  if (!exist) {
    rabbitMq.addToChannel({
      message_id: id,
      chatId: userId,
      link,
      inline: true,
    });
  }

  return msg.answerInlineQuery([res], {
    cache_time: 60,
    is_personal: true,
  }).catch(() => {});
}

// Notify admin when a non-authorized, non-admin user sends a message.
// Rate-limited: at most one alert per UNAUTHORIZED_ALERT_INTERVAL.
function notifyUnauthorizedUser(message, botHelper) {
  const now = Date.now();
  if (now - (global.lastUnauthorizedAlertTime || 0) < UNAUTHORIZED_ALERT_INTERVAL) {
    return;
  }

  global.lastUnauthorizedAlertTime = now;
  const from = message.from || {};
  const chat = message.chat || {};
  const text = `${message.text || message.caption || ''}`.slice(0, 200);
  botHelper.sendAdmin(
    `unauthorized user input from=${from.id || 'unknown'} chat=${chat.id || 'unknown'} username=${from.username || ''} text=${text}`,
  );
}

async function addToQueue(ctx, botHelper) {
  const isChannelPost = !!(ctx.update && ctx.update.channel_post);
  const message = ctx.message || ctx.update.channel_post;
  if (!message || message.reply_to_message || message.audio) {
    return;
  }

  const {
    caption_entities: captionEntities,
    from,
    sender_chat: senderChat,
  } = message;

  if (!isChannelPost && (!from || !botHelper.isAllowedUser(from.id))) {
    notifyUnauthorizedUser(message, botHelper);
    return;
  }

  let {entities, text} = message;
  const {
    chat: {id: chatId},
    caption,
  } = message;

  const userId = from ? from.id : senderChat && senderChat.id;
  const isAdm = !!(from && botHelper.isAdmin(from.id));
  const isChanMesId = isChannelPost ? message.message_id : false;
  let pdfData = {};

  if (text && text.match(/^\/\w+/) && !message.document) {
    return;
  }

  if (message.document) {
    const {
      file_name: fileName,
      mime_type: mimeType,
      file_id: fileId,
      file_size: fileSize,
    } = message.document;

    if (!fileName) {
      return;
    }

    if (fileName.match(/.pdf$/) && mimeType === 'application/pdf') {
      if (fileSize >= 4e6) {
        return ctx.reply('You have exceeded the maximum size of pdf (4mb)').catch(() => {});
      }

      const cnt = await db.get({
        key: dbKeys.counter,
        filter: {url: chatId, iv: 'pdf'},
        project: 'af updatedAt',
      });

      if (cnt && !isDateMoreADay(cnt.updatedAt) && cnt.af >= 10) {
        const hours = Math.floor((Date.now() - new Date(cnt.updatedAt).getTime()) / 3_600_000);
        return ctx.reply(
          `You have exceeded the maximum number of pdfs in 24 hours period, come back after ${24 - hours}h`,
        ).catch(() => {});
      }

      pdfData = {
        pdf: fileId,
        pdfTitle: fileName.replace(/[^a-z\s0-9]/gi, '').replace(/\s/g, '_'),
      };
      text = PDF_LINK + encodeURI(fileName);
    } else {
      return;
    }
  }

  if (caption) {
    text = caption;
    if (captionEntities) {
      entities = captionEntities;
    }
  }

  if (!text) {
    return;
  }

  let links = getAllLinks(text);
  if (!links.length && entities) {
    links = getLinkFromEntity(entities, text);
  }

  if (!links.length) {
    logger('no link');
    return;
  }

  // For authorized/admin users, process all links; for others, only the first
  const isAllowed = isAdm || (userId && botHelper.isAllowedUser(userId));
  const linksToProcess = isAllowed ? links : [getLink(links)];

  for (let linkIdx = 0; linkIdx < linksToProcess.length; linkIdx++) {
    let link = toUrl(linksToProcess[linkIdx]);

    let parsed;
    try {
      parsed = new url.URL(link);
    } catch (error) {
      logger('exit wrong url');
      logger(error);
      continue;
    }

    try {
      if (link.match(/^(https?:\/\/)?(www.)?google/)) {
        const matchUrl = link.match(/url=(.*?)($|&)/);
        if (matchUrl && matchUrl[1]) {
          link = decodeURIComponent(matchUrl[1]);
          parsed = new url.URL(link);
        }
      }

      if (link.match(new RegExp(validRegex))) {
        await ctx.reply(messages.showIvMessage('', link, link, parsed.host), {
          parse_mode: botHelper.markdown(),
        }).catch(error => {
          logger('reply');
          logger(error);
          botHelper.sendError(error);
        });
        continue;
      }

      if (link.match(/^((https?):\/\/)?(www\.)?(youtube|t)\.(com|me)\/?/)) {
        logger('youtube exit');
        continue;
      }

      if (link.match(/yandex\.ru\/showcap/)) {
        logger('yandex cap');
        continue;
      }

      if (!parsed.pathname && !parsed.protocol.match('https')) {
        logger('main no ssl');
        continue;
      }

      let mid;
      if (!botHelper.waitSec) {
        const res = await ctx.reply('Waiting for instantView...').catch(error => {
          logger('reply wait');
          logger(error);
          return {};
        });

        const messageId = res && res.message_id;
        await timeout(0.1);
        if (!messageId) {
          logger('no MessageId exit');
          continue;
        }

        mid = messageId;
      }

      const task = {
        message_id: mid,
        chatId,
        isChanMesId,
        link,
        ...pdfData,
        ...(userId ? {fromId: userId} : {}),
      };

      const force = isAdm && commandCheck(text);
      if (force) {
        task.force = force;
      }

      rabbitMq.addToChannel(task);
    } catch (error) {
      logger('send error');
      logger(error);
    }
  }
}

const format = (bot, botHelper, skipCountBool) => {
  bot.command(['start', 'help'], ctx => startOrHelp(ctx, botHelper));
  bot.hears(BUTTONS.hello.label, ctx => startOrHelp(ctx, botHelper));
  bot.hears(BUTTONS.support.label, ctx => support(ctx, botHelper));
  bot.command('support', ctx => support(ctx, botHelper));
  bot.hears(BUTTONS.hide.label, ctx => {
    ctx.reply('Type /help to show.', keyboards.hide()).catch(error => {
      botHelper.sendError(error);
    });
  });

  bot.on('inline_query', msg =>
    queueInlineQuery(msg, botHelper).catch(error => {
      logger(error);
      botHelper.sendError(error);
    }),
  );

  bot.on('message', ctx =>
    addToQueue(ctx, botHelper).catch(error => {
      logger(error);
      botHelper.sendError(`tg err: ${JSON.stringify(error)}`);
    }),
  );

  bot.on('channel_post', ctx =>
    addToQueue(ctx, botHelper).catch(error => {
      logger(error);
      botHelper.sendError(`tg channel err: ${JSON.stringify(error)}`);
    }),
  );

  let browserWs = null;
  if (!botHelper.config.no_puppet && !IS_PUPPET_DISABLED) {
    puppet.getBrowser().then(ws => {
      browserWs = ws;
    });
  }

  rabbitMq.runMqChannels(jobMessage(botHelper, browserWs, skipCountBool));
};

module.exports = format;
