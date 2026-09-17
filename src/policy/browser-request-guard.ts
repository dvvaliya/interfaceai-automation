import type { BrowserContext } from "playwright";

export type BrowserRequestGuardPolicy = {
  allowedOrigins: readonly string[];
  allowedPathPrefixes: readonly string[];
};

export async function installBrowserRequestGuard(
  context: BrowserContext,
  policy: BrowserRequestGuardPolicy,
  onBlocked?: (url: string) => void,
): Promise<void> {
  await context.route("**/*", async (route) => {
    const request = route.request();
    const isMainNavigation =
      request.isNavigationRequest() && request.frame() === request.frame().page().mainFrame();

    if (isBrowserRequestAllowed(request.url(), isMainNavigation, policy)) {
      await route.continue();
      return;
    }

    onBlocked?.(request.url());
    await route.abort("blockedbyclient");
  });
}

export function isBrowserRequestAllowed(
  rawUrl: string,
  isMainNavigation: boolean,
  policy: BrowserRequestGuardPolicy,
): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }

  if (url.protocol === "data:" || url.protocol === "blob:") return !isMainNavigation;
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (!policy.allowedOrigins.includes(url.origin)) return false;
  if (!isMainNavigation) return true;

  return policy.allowedPathPrefixes.some((prefix) => pathMatches(url.pathname, prefix));
}

function pathMatches(pathname: string, allowedPrefix: string): boolean {
  if (allowedPrefix === "/") return pathname === "/";
  return pathname === allowedPrefix || pathname.startsWith(`${allowedPrefix}/`);
}
