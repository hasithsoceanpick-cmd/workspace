import { useEffect, useState } from 'react';

// URLs look like  #/<app>/<page>?a=1&b=2   e.g.  #/tasks/calendar?view=week
export type Params = Record<string, string>;
export interface Route { app: string; page: string; params: Params }

function parse(): Route {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  const [app = '', page = ''] = path.split('/');
  const params: Params = {};
  new URLSearchParams(query).forEach((v, k) => (params[k] = v));
  return { app, page, params };
}

const build = (app: string, page: string, params: Params) => {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null)).toString();
  return `#/${app}${page ? '/' + page : ''}${q ? '?' + q : ''}`;
};

export function go(app: string, page = '', params: Params = {}) {
  window.location.hash = build(app, page, params);
}

/** Go somewhere without adding a history entry (e.g. the first page an app lands on) */
export function replaceRoute(app: string, page = '', params: Params = {}) {
  history.replaceState(null, '', build(app, page, params));
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

/** Change some params of the current page without adding history entries */
export function setParams(patch: Params) {
  const { app, page, params } = parse();
  history.replaceState(null, '', build(app, page, { ...params, ...patch }));
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

export function useRoute(): Route {
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const on = () => setRoute(parse());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
