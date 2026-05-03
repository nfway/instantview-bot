const sanitizeHtml = require('sanitize-html');
const isImageUrl = require('./is-image-url');
// const sanitizeHtmlForce = require('./sanitize');
const {logger} = require('./logger');

const iframes = /(<iframe[^>]+>.*?<\/iframe>|<iframe><\/iframe>)/g;
const imgReplacer = '##@#IMG#@##';

function checkImage(url) {
  return Promise.resolve(isImageUrl(url));
}

function getImageSrc(img) {
  const attrs = ['src', 'data-src', 'data-original', 'data-lazy-src'];
  for (const attr of attrs) {
    const found = img.match(new RegExp(`${attr}=["']([^"']+)["']`, 'i'));
    if (found && found[1]) {
      return found[1];
    }
  }
  return '';
}

function setImageSrc(img, src) {
  if (img.match(/\ssrc=["'][^"']*["']/i)) {
    return img.replace(/\ssrc=["'][^"']*["']/i, ` src="${src}"`);
  }

  return img.replace('<img', `<img src="${src}"`);
}

function resolveImageUrl(src, parsedUrl) {
  const converted = convert(src);
  if (converted.match(/^\/\//)) {
    return `${parsedUrl.protocol}${converted}`;
  }

  try {
    return new URL(converted, `${parsedUrl.protocol}//${parsedUrl.host}${parsedUrl.pathname || ''}`).href;
  } catch (error) {
    return '';
  }
}

function convert(strParam) {
  let str = strParam;
  str = str.replace(/&amp;/g, '&');
  str = str.replace(/&gt;/g, '>');
  str = str.replace(/&lt;/g, '<');
  str = str.replace(/&quot;/g, '"');
  str = str.replace(/&#039;/g, '\'');
  return str;
}

const findIframes = content => content.match(iframes);

const replaceDir = (imgParam, parsedUrl) => {
  let img = imgParam;
  if (img.match(/src=['"]..\//)) {
    let {dir} = parsedUrl;
    dir = dir.replace(/[^/]+\/?$/, '');
    if (dir.substr(-2, 2) !== '//') {
      img = img.replace('../', dir);
    }
  }

  return img;
};

const findImages = (content, parsedUrl, params) => {
  const urlRegex = /<img [^>]+\/?>/g;
  const imgs = content.match(urlRegex) || [];
  const tasks = [];

  for (let i = 0; i < imgs.length; i += 1) {
    let img = imgs[i].replace(/\n/g, '');
    img = img.replace(/\s+/g, ' ');
    img = replaceDir(img, parsedUrl);

    const src = getImageSrc(img);
    if (src) {
      const resolvedSrc = resolveImageUrl(src, parsedUrl);
      if (!resolvedSrc) {
        tasks.push(Promise.resolve({isValid: false, i, img: ''}));
        continue;
      }

      const normalizedImg = setImageSrc(img, resolvedSrc);
      if (params.isCached) {
        tasks.push(Promise.resolve({isValid: true, i, img: normalizedImg}));
      } else {
        tasks.push(
          checkImage(resolvedSrc)
            .then(isValid => ({
              isValid,
              i,
              img: normalizedImg,
            }))
            .catch(() => ({
              isValid: false,
              i,
              img: '',
            })),
        );
      }
    }
  }

  return Promise.all(tasks)
    .then(checked => {
      for (let i = 0; i < checked.length; i += 1) {
        imgs[checked[i].i] = checked[i].isValid ? checked[i].img : '';
      }

      return imgs.filter(Boolean);
    });
};

const insertYoutube = (contentParam, links = []) => {
  let content = contentParam;
  for (let i = 0; i < links.length; i += 1) {
    const link = links[i];
    const youid = link.match(/embed\/(.*?)(\?|$)/);
    if (youid && youid[1]) {
      const src = `/embed/youtube?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3D${youid[1]}`;
      content = `<figure><iframe src="${src}"></iframe></figure>${content}`;
    }
  }
  return content;
};

const replaceTags = (contentParam, imgs, replaceWith) => {
  let content = contentParam;
  for (let i = 0; i < imgs.length; i += 1) {
    content = content.replace(imgs[i], replaceWith);
  }
  return content;
};

const restoreTags = (contentParam, images, replaceFrom, parsedUrl) => {
  let content = contentParam;
  for (let i = 0; i < images.length; i += 1) {
    let img = images[i];
    img = convert(img);
    img = replaceDir(img, parsedUrl);
    const src = getImageSrc(img);
    if (src && !img.match(/src=.(\/\/|https?)/)) {
      const resolvedSrc = resolveImageUrl(src, parsedUrl);
      img = resolvedSrc ? setImageSrc(img, resolvedSrc) : '';
    }
    content = content.replace(imgReplacer, img);
  }
  return content;
};

const replaceImages = (content, imgs) =>
  replaceTags(content, imgs, imgReplacer);

const restoreImages = (content, imgs, parsedUrl) =>
  restoreTags(content, imgs, imgReplacer, parsedUrl);

const replaceServices = contentParam => {
  let content = contentParam;
  const srvs = [/<a.+(imgur\.com).+\/a>/g];
  for (let i = 0; i < srvs.length; i += 1) {
    const found = content.match(srvs[i]) || [];
    if (found.length) {
      for (let fi = 0; fi < found.length; fi += 1) {
        const href = found[fi].match(/href="([^>]+)"/);
        if (href) {
          content = content.replace(
            found[fi],
            `<img alt="" src="${href[1]}/zip" />`,
          );
        }
      }
    }
  }
  return content;
};

const fixHtml = async (contentParam, iframeParam, parsedUrl, params) => {
  let content = contentParam;
  let iframe = iframeParam;

  const images = await findImages(content, parsedUrl, params)
    .catch(e => {
      console.log(parsedUrl, e, ' \nfindImages');
      return [];
    });

  if (!iframe) {
    iframe = findIframes(content);
  }
  content = replaceImages(content, images);
  logger(`before san ${content.length}`);
  content = sanitizeHtml(content);
  // TODO Blocker
  // content = sanitizeHtmlForce(content, params);
  content = restoreImages(content, images, parsedUrl);
  content = replaceServices(content);
  if (iframe && Array.isArray(iframe)) {
    content = insertYoutube(content, iframe);
  }
  return content;
};
module.exports.findImages = findImages;
module.exports.findIframes = findIframes;

module.exports.fixHtml = fixHtml;
