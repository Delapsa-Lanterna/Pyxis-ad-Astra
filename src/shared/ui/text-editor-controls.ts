import { EditorView, runScopeHandlers, type Panel } from '@codemirror/view';
import {
  SearchQuery,
  getSearchQuery,
  setSearchQuery,
  closeSearchPanel,
  findNext,
  findPrevious,
  selectMatches,
  replaceNext,
  replaceAll,
} from '@codemirror/search';

function icon(path: string) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'ui-control-icon');
  const shape = document.createElementNS(svg.namespaceURI, 'path');
  shape.setAttribute('d', path);
  svg.append(shape);
  return svg;
}
export function textFoldMarker(open: boolean) {
  const marker = document.createElement('span');
  marker.className = 'text-fold-marker';
  marker.title = open ? '折叠代码' : '展开代码';
  marker.append(icon(open ? 'm4 6 4 4 4-4' : 'm6 4 4 4-4 4'));
  return marker;
}
export function textFoldPlaceholder(view: EditorView, unfold: (event: MouseEvent) => void) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'cm-foldPlaceholder';
  button.title = view.state.phrase('unfold');
  button.setAttribute('aria-label', view.state.phrase('folded code'));
  button.append(icon('M4 3H2v10h2m8-10h2v10h-2M6 8h4'));
  button.onclick = unfold;
  return button;
}

export function createTextSearchPanel(view: EditorView): Panel {
  const dom = document.createElement('div');
  dom.className = 'cm-search';
  let query = getSearchQuery(view.state);
  const field = (name: string, label: string) => {
    const input = document.createElement('input');
    input.name = name;
    input.className = 'cm-textfield';
    input.placeholder = input.ariaLabel = view.state.phrase(label);
    input.oninput = commit;
    return input;
  };
  const search = field('search', 'Find'),
    replace = field('replace', 'Replace');
  search.setAttribute('main-field', 'true');
  const row = (className: string) => {
    const element = document.createElement('div');
    element.className = className;
    dom.append(element);
    return element;
  };
  const button = (name: string, label: string, action: (view: EditorView) => boolean) => {
    const element = document.createElement('button');
    element.type = 'button';
    element.name = name;
    element.className = 'cm-button';
    element.textContent = view.state.phrase(label);
    element.onclick = () => action(view);
    return element;
  };
  const findRow = row('text-search-row');
  findRow.append(
    search,
    button('next', 'next', findNext),
    button('prev', 'previous', findPrevious),
    button('select', 'all', selectMatches),
  );
  const close = button('close', 'close', closeSearchPanel);
  close.classList.add('ui-control-center');
  close.ariaLabel = close.textContent;
  close.replaceChildren(icon('m4 4 8 8m0-8-8 8'));
  findRow.append(close);
  const replaceRow = row('text-search-row');
  replaceRow.append(replace, button('replace', 'replace', replaceNext), button('replaceAll', 'replace all', replaceAll));
  const options = row('text-search-options');
  const check = (name: string, label: string) => {
    const input = document.createElement('input'),
      wrapper = document.createElement('label');
    input.type = 'checkbox';
    input.name = name;
    input.onchange = commit;
    wrapper.append(input, view.state.phrase(label));
    options.append(wrapper);
    return input;
  };
  const sensitive = check('case', 'match case'),
    regexp = check('re', 'regexp'),
    word = check('word', 'by word');
  function commit() {
    const next = new SearchQuery({
      search: search.value,
      replace: replace.value,
      caseSensitive: sensitive.checked,
      regexp: regexp.checked,
      wholeWord: word.checked,
    });
    if (!next.eq(query)) view.dispatch({ effects: setSearchQuery.of(next) });
  }
  function sync() {
    query = getSearchQuery(view.state);
    search.value = query.search;
    replace.value = query.replace;
    sensitive.checked = query.caseSensitive;
    regexp.checked = query.regexp;
    word.checked = query.wholeWord;
    search.setAttribute('aria-invalid', String(query.search !== '' && !query.valid));
    replaceRow.hidden = view.state.readOnly;
  }
  dom.onkeydown = (event) => {
    if (runScopeHandlers(view, event, 'search-panel')) event.preventDefault();
    else if (event.key === 'Enter' && (event.target === search || event.target === replace)) {
      event.preventDefault();
      if (event.target === search) (event.shiftKey ? findPrevious : findNext)(view);
      else if (event.target === replace) replaceNext(view);
    }
  };
  sync();
  return {
    dom,
    top: true,
    mount: () => search.select(),
    update: (update) => {
      if (!getSearchQuery(update.state).eq(query) || update.state.readOnly !== update.startState.readOnly) sync();
    },
  };
}
