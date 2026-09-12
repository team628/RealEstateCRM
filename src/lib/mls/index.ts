import { FakeMlsProvider } from "./fake";
import type { MlsProvider } from "./types";

let instance: MlsProvider | null = null;

/**
 * Returns the configured MLS provider. Until a vendor is connected (OA-005,
 * docs/contracts/mls.md) this is the deterministic demo provider; the UI
 * labels its data as sample inventory.
 */
export function getMlsProvider(): MlsProvider {
  if (!instance) instance = new FakeMlsProvider();
  return instance;
}
