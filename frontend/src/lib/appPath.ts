const configuredBasePath = import.meta.env.BASE_URL || '/';

export const appBasePath = configuredBasePath === '/'
  ? ''
  : `/${configuredBasePath.replace(/^\/+|\/+$/g, '')}`;

export function appPath(path = '/') {
  const normalizedPath = path === '/'
    ? '/'
    : `/${path.replace(/^\/+/, '')}`;

  return `${appBasePath}${normalizedPath}` || '/';
}
