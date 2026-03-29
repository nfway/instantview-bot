require('trace-unhandled/register');

const botRoute = require('./api/routes/botroute');
const botInstance = require('./config/bot');
const {logger} = require('./api/utils/logger');

if (botInstance) {
  botRoute(botInstance);

  process.once('SIGINT', () => {
    logger('bot stopped SIGINT');
    botInstance.stop('SIGINT');
  });

  process.once('SIGTERM', () => {
    logger('bot stopped SIGTERM');
    botInstance.stop('SIGTERM');
  });
}
