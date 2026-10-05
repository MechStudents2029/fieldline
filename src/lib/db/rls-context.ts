import { AsyncLocalStorage } from "node:async_hooks";

export type OfficeClaim = { authUserId: string };

const claims = new AsyncLocalStorage<OfficeClaim>();

export function officeClaim(): OfficeClaim | undefined {
  return claims.getStore();
}

export function enterOfficeClaim(authUserId: string) {
  claims.enterWith({ authUserId });
}

export function withOfficeClaim<T>(authUserId: string, fn: () => T): T {
  return claims.run({ authUserId }, fn);
}
