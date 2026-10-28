/* global document, navigator */

const source = document.querySelector('#post-source');
const preview = document.querySelector('#post-preview');
const copyButton = document.querySelector('#copy-post');
const copyStatus = document.querySelector('#copy-status');

function appendText(parent, text) {
  if (['TABLE', 'TR'].includes(parent.nodeName) && !text.trim()) return;
  parent.append(document.createTextNode(text));
}

function elementFor(tag, argument) {
  const names = { table: 'table', tr: 'tr', td: 'td', color: 'span', size: 'span', b: 'strong', align: 'div', url: 'a', img: 'span' };
  const element = document.createElement(names[tag]);
  if (tag === 'table') {
    const separator = argument.indexOf(',');
    const width = separator < 0 ? argument : argument.slice(0, separator);
    const color = separator < 0 ? '' : argument.slice(separator + 1);
    if (/^\d{1,3}%$/.test(width)) element.setAttribute('width', width);
    if (color) element.style.backgroundColor = color;
  }
  if (tag === 'tr' && argument) element.style.backgroundColor = argument;
  if (tag === 'color' && argument) element.style.color = argument;
  if (tag === 'size' && /^[1-7]$/.test(argument)) element.dataset.size = argument;
  if (tag === 'align' && /^(left|center|right)$/.test(argument)) element.setAttribute('align', argument);
  return element;
}

function finishElement(entry) {
  if (entry.tag !== 'url' && entry.tag !== 'img') return;
  const address = (entry.tag === 'url' && entry.argument ? entry.argument : entry.element.textContent).trim();
  if (!/^https?:\/\//i.test(address)) return;
  if (entry.tag === 'url') {
    entry.element.href = address;
    entry.element.target = '_blank';
    entry.element.rel = 'noopener noreferrer';
  } else {
    const image = document.createElement('img');
    image.src = address;
    image.alt = '帖子图片';
    entry.element.replaceChildren(image);
  }
}

function renderPost() {
  const background = source.value.match(/\[postbgc\](#[\da-f]{6})\[\/postbgc\]/i);
  preview.style.backgroundColor = background ? background[1] : '';
  const text = source.value.replace(/\[postbgc\][\s\S]*?\[\/postbgc\]\s*/gi, '');
  const tags = /\[(\/)?(table|tr|td|color|size|b|align|url|img|hr)(?:=([^\]]+))?\]/gi;
  const fragment = document.createDocumentFragment();
  const stack = [{ tag: '', element: fragment, argument: '' }];
  let position = 0;
  for (const match of text.matchAll(tags)) {
    const parent = stack[stack.length - 1].element;
    appendText(parent, text.slice(position, match.index));
    const tag = match[2].toLowerCase();
    if (match[1]) {
      if (stack[stack.length - 1].tag === tag) finishElement(stack.pop());
      else appendText(parent, match[0]);
    } else if (tag === 'hr') {
      parent.append(document.createElement('hr'));
    } else {
      const argument = match[3] || '';
      const element = elementFor(tag, argument);
      parent.append(element);
      stack.push({ tag, element, argument });
    }
    position = match.index + match[0].length;
  }
  appendText(stack[stack.length - 1].element, text.slice(position));
  preview.replaceChildren(fragment);
}

async function copyPost() {
  try {
    await navigator.clipboard.writeText(source.value);
    copyStatus.textContent = '帖子代码已复制。请在论坛编辑器中切换到纯文本模式后粘贴。';
  } catch {
    source.closest('details').open = true;
    source.focus();
    source.select();
    copyStatus.textContent = '已选中帖子代码，请按 Ctrl+C 复制。';
  }
}

source.addEventListener('input', renderPost);
copyButton.addEventListener('click', copyPost);
renderPost();
