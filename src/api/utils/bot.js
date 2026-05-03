const fs = require('fs');
const path = require('path');

const {
  TG_ADMIN_ID,
  TG_BUGS_GROUP,
  BLACK_LIST_FILE,
  ALLOWED_USER_IDS,
  SINGLE_USER_ID,
} = require('../../config/vars');
const {logger} = require('./logger');
const rabbitMq = require('../../service/rabbitmq');

const OFF = 'Off';
const ON = 'On';
const IS_CONTAINERIZED = ['1', 'true'].includes(
  `${process.env.CONTAINERIZED || ''}`.toLowerCase(),
);

const PARSE_MODE_MARK = 'Markdown';
const CONFIG_FILE = path.join(__dirname, '../../../.conf/config.json');
const DEFAULT_CONFIG = {no_puppet: false};

const INLINE_TITLE = 'InstantView created. Click me to send';
const BANNED_ERROR = 'USER_BANNED_IN_CHANNEL';
const RIGHTS_ERROR = 'need administrator rights in the channel chat';

class BotHelper {
  constructor(bot, worker) {
    this.bot = bot;
    this.config = {...DEFAULT_CONFIG};
    this.db = true;

    try {
      if (!fs.existsSync(CONFIG_FILE)) {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2));
      }
      this.config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    } catch (error) {
      logger(error);
    }

    this.tgAdmin = parseInt(TG_ADMIN_ID || SINGLE_USER_ID || '0', 10);
    this.allowedUserIds = Array.isArray(ALLOWED_USER_IDS)
      ? [...new Set(ALLOWED_USER_IDS)]
      : [];
    this.allowedUserId = parseInt(SINGLE_USER_ID || TG_ADMIN_ID || '0', 10);
    this.waitSec = false;
    this.worker = worker;
  }

  isAdmin(chatId) {
    return !!this.tgAdmin && chatId === this.tgAdmin;
  }

  isAllowedUser(userId) {
    if (this.allowedUserIds.length) {
      return this.allowedUserIds.includes(userId);
    }

    if (!this.allowedUserId) {
      return true;
    }

    return userId === this.allowedUserId;
  }

  botMes(chatId, text, mark = true) {
    if (this.worker) {
      return Promise.resolve();
    }

    let opts = {};
    if (mark) {
      opts = {parse_mode: this.markdown()};
    }

    return this.bot
      .sendMessage(chatId, text, opts)
      .catch(error => this.sendError(error, `${chatId}${text}`));
  }

  sendAdmin(textParam, chatIdParam = '', mark = false) {
    if (this.worker) {
      return Promise.resolve();
    }

    let chatId = chatIdParam || this.tgAdmin;
    let text = textParam;
    let opts = {};

    if (!chatId) {
      logger(text);
      return Promise.resolve();
    }

    if (mark === true) {
      opts = {
        parse_mode: this.markdown(),
        disable_web_page_preview: true,
      };
    }

    if (`${chatId}` === `${this.tgAdmin}`) {
      text = `service: adm ${text}`;

      if (text.match('Too Many')) {
        const [sec] = text.match(/[0-9]+$/) || [];
        if (sec) {
          this.waitSec = sec;
          clearTimeout(this.timer);
          this.timer = setTimeout(() => {
            this.waitSec = false;
          }, sec * 1000);
        }
      }
    }

    return this.bot.sendMessage(chatId, text, opts).catch(error => {
      logger('Send admin');
      logger(error);
    });
  }

  sendAdminOpts(text, opts) {
    if (this.worker) {
      return Promise.resolve();
    }

    const chatId = TG_BUGS_GROUP || this.tgAdmin;
    if (!chatId) {
      logger(text);
      return Promise.resolve();
    }

    return this.bot.sendMessage(chatId, text, opts).catch(error => {
      logger('Send admin opts');
      logger(error);
    });
  }

  sendInline({title, messageId, ivLink}) {
    if (this.worker) {
      return Promise.resolve();
    }

    const queryResult = {
      type: 'article',
      id: messageId,
      title: title || INLINE_TITLE,
      input_message_content: {message_text: ivLink},
    };

    return this.bot.answerInlineQuery(messageId, [queryResult]);
  }

  sendAdminMark(text, chatId) {
    if (this.worker) {
      return Promise.resolve();
    }

    return this.sendAdmin(text, chatId, true);
  }

  getParams(hostname, chatId, force) {
    const params = {};
    const contentSelector =
      force === 'content' || this.getConf(`${hostname}_content`);
    if (contentSelector) {
      params.content = contentSelector;
    }

    const puppetOnly = force === 'puppet' || this.getConf(`${hostname}_puppet`);
    if (puppetOnly) {
      params.isPuppet = true;
    }

    const customOnly = force === 'custom' || this.getConf(`${hostname}_custom`);
    if (customOnly) {
      params.isCustom = true;
    }

    const wget = force === 'wget' || this.getConf(`${hostname}_wget`);
    if (wget) {
      params.isWget = true;
    }

    const cached = force === 'cached' || this.getConf(`${hostname}_cached`);
    if (cached) {
      params.isCached = true;
    }

    const scroll = this.getConf(`${hostname}_scroll`);
    if (scroll) {
      params.scroll = scroll;
    }

    const noLinks =
      force === 'no_links' || this.getConf(`${hostname}_no_links`);
    if (noLinks) {
      params.noLinks = true;
    }

    const pcache = force === 'p_cache';
    if (pcache) {
      params.isCached = true;
      params.cachefile = 'puppet.html';
      params.content = this.getConf('p_cache_content');
    }

    if (this.isAdmin(chatId)) {
      if (this.getConf('test_puppet')) {
        params.isPuppet = true;
      }
      if (this.getConf('test_custom')) {
        params.isCustom = true;
      }
    }

    if (this.getConf('mozilla')) {
      params.mozilla = true;
    }

    return params;
  }

  getConf(param) {
    const configParam = this.config[param] || this.config[`_${param}`];
    return configParam === OFF ? '' : configParam;
  }

  parseConfig(params) {
    let content;

    if (params[0] === '_') {
      const [_, param, ...val] = params.split('_');
      params = `${param} ${val.join('_')}`;
    }

    let config = params.replace(' _content', '_content');
    config = config.split(/\s/);
    const [param] = config;

    if (config.length === 2) {
      content = config[1].replace(/~/g, ' ');
      if (this.config[param] === content) {
        content = OFF;
      }
    } else if (this.config[param] === ON || this.config[param]) {
      content = OFF;
    } else {
      content = ON;
    }

    return {param, content};
  }

  toggleConfig(msg, send = true) {
    if (typeof msg === 'string') {
      msg = {text: msg};
    }

    let params = msg.text.replace('/config', '').trim();

    if (!params || !this.isAdmin(msg.chat.id)) {
      return Promise.resolve('no param or forbidden');
    }

    const {param, content} = this.parseConfig(params);
    this.config[param] = content;
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(this.config, null, 2));

    return send && this.botMes(this.tgAdmin, content, false);
  }

  showConfig() {
    const allowedUsers = this.allowedUserIds.length
      ? this.allowedUserIds.join(',')
      : this.allowedUserId || 'all';
    return `${JSON.stringify(this.config)} allowedUser=${allowedUsers}`;
  }

  sendError(error, text = '') {
    let errorResult = error;

    if (typeof errorResult === 'object' && !global.isDevEnabled) {
      if (errorResult.response && typeof errorResult.response === 'object') {
        errorResult = errorResult.response.description || 'unknown error';
        if (errorResult.match(BANNED_ERROR) || errorResult.match(RIGHTS_ERROR)) {
          return;
        }
      }
    } else {
      errorResult = `has error: ${JSON.stringify(errorResult)} ${errorResult.toString()} ${text}`;
    }

    this.sendAdmin(errorResult);
  }

  disDb() {
    this.db = false;
  }

  setBlacklist() {
    const blf = fs.readFileSync(BLACK_LIST_FILE);
    this.bllist = `${blf ? `${blf}` : ''}`;
  }

  isBlackListed(hostname) {
    return !!(this.bllist && hostname && this.bllist.includes(hostname));
  }

  forwardMes(mid, from, to) {
    if (this.worker) {
      return Promise.resolve();
    }

    return this.bot.forwardMessage(to, from, mid);
  }

  sendIV(chatId, messageId, inlineMessageId, messageText, extra) {
    if (this.worker) {
      return Promise.resolve();
    }

    let text = messageText;
    if (extra && extra.parse_mode === this.markdown()) {
      text = text.replace(/[*`]/gi, '');
    }

    return this.bot
      .editMessageText(chatId, messageId, inlineMessageId, text, extra)
      .catch(error => {
        logger('send iv error');
        logger(error);
      });
  }

  sendIVNew(chatId, messageText, extra) {
    if (this.worker) {
      return Promise.resolve();
    }

    let text = messageText;
    if (extra && extra.parse_mode === this.markdown()) {
      text = text.replace(/[*`]/gi, '');
    }

    return this.bot.sendMessage(chatId, text, extra).catch(error => {
      logger('send iv new error');
      logger(error);
    });
  }

  delMessage(chatId, messageId) {
    if (this.worker) {
      return Promise.resolve();
    }

    return this.bot.deleteMessage(chatId, messageId).catch(error => {
      logger('del mess error');
      logger(error);
    });
  }

  markdown() {
    return PARSE_MODE_MARK;
  }

  restartApp() {
    if (IS_CONTAINERIZED) {
      this.sendAdmin('restart requested, exiting for docker compose restart')
        .finally(() => {
          setTimeout(() => {
            process.exit(1);
          }, 1000);
        });
      return;
    }

    const {spawn} = require('child_process');
    spawn('pm2', ['restart', 'Format'], {
      stdio: 'ignore',
      detached: true,
    }).unref();
    this.sendAdmin('restarted');
  }

  gitPull() {
    if (IS_CONTAINERIZED) {
      this.sendAdmin(
        'gitPull is disabled in docker compose; redeploy on the host with docker compose up -d --build',
      );
      return;
    }

    const {spawn} = require('child_process');
    const gitPull = spawn('git', ['pull'], {shell: false});
    let log = 'Res: ';

    gitPull.stdout.on('data', data => {
      log += `${data}`;
    });

    gitPull.stderr.on('data', data => {
      log += `${data}`;
    });

    gitPull.on('close', code => {
      if (code !== 0) {
        logger(log);
        this.sendAdmin(`git pull failed (${code}): ${log}`);
        return;
      }

      const pm2Restart = spawn('pm2', ['restart', 'Format', '--time'], {
        shell: false,
      });
      pm2Restart.stdout.on('data', data => {
        log += `${data}`;
      });
      pm2Restart.stderr.on('data', data => {
        log += `${data}`;
      });
      pm2Restart.on('close', restartCode => {
        logger(log);
        this.sendAdmin(`git pull completed, pm2 restart exited ${restartCode}: ${log}`);
      });
    });
  }

  setConn(conn) {
    this.conn = conn;
  }

  getInfo() {
    return Promise.resolve({
      allowedUserIds: this.allowedUserIds.length
        ? this.allowedUserIds
        : this.allowedUserId
          ? [this.allowedUserId]
          : null,
      queue: rabbitMq.getQueueStats(),
    });
  }

  getMidMessage(mId) {
    let mMessage = process.env[`MID_MESSAGE${mId}`] || '';
    mMessage = mMessage.replace('*', '\n');
    return mMessage;
  }

  startBroad() {
    return 'broadcast is disabled in single-user mode';
  }

  checkAccess(chatId, userId) {
    return Promise.resolve(this.isAllowedUser(userId));
  }
}

exports.BotHelper = BotHelper;
exports.BANNED_ERROR = BANNED_ERROR;
