const fs = require('fs');
const path = require('path');

const LOG_DIR = path.resolve('.conf');

function safeLogPath(file) {
  const safeFile = path.basename(file);
  const resolvedPath = path.resolve(LOG_DIR, safeFile);

  if (!resolvedPath.startsWith(`${LOG_DIR}${path.sep}`)) {
    throw new Error('invalid log file path');
  }

  return resolvedPath;
}

const logger = (content, file) => {
  if (global.isDevEnabled) {
    if (file) {
      fs.writeFileSync(safeLogPath(file), String(content));
    } else {
      console.log(content);
    }
  }
};

module.exports.logger = logger;
