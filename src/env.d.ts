/// <reference types="astro/client" />

interface ImportMetaEnv {
  /**
   * Base URL of the independent availability backend (see
   * ceylon-sharks-availability-mvp.md). Not a secret - safe to embed in
   * the static build. Falls back to the deployed stack's API Gateway
   * URL when unset.
   */
  readonly PUBLIC_AVAILABILITY_API_BASE_URL?: string;
}
