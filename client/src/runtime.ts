const configuredBasePath = import.meta.env.BASE_URL || '/';

export const appBasePath = configuredBasePath.replace(/\/+$/, '') || '/';
export const routerBasename = appBasePath === '/' ? undefined : appBasePath;
export const apiBaseUrl = appBasePath === '/' ? '/api' : `${appBasePath}/api`;

export function appPath(route: string): string {
  const normalizedRoute = route.startsWith('/') ? route : `/${route}`;
  return appBasePath === '/' ? normalizedRoute : `${appBasePath}${normalizedRoute}`;
}
