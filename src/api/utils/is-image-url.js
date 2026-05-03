const urlParse = require('url').parse;
const isImage = require('is-image');
const isUrl = require('is-url');
const {fetch} = require('undici');

module.exports = async (urlParam, accurate, timeout = 5000) => {
  let url = urlParam;
  if (!url) return false;
  const http = url.lastIndexOf('http');
  if (http !== -1) url = url.substring(http);
  if (!isUrl(url)) return isImage(url);
  let {pathname} = urlParse(url);
  if (!pathname) return false;
  const last = pathname.search(/[:?&]/);
  if (last !== -1) pathname = pathname.substring(0, last);
  if (/styles/i.test(pathname)) return false;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
    });
    if (!res) return false;
    const contentType = `${res.headers.get('content-type') || ''}`;
    return (
      contentType.search(/^image\//) !== -1 && contentType.search(/xml/) === -1
    );
  } catch (e) {
    return false;
  } finally {
    clearTimeout(timer);
  }
};
