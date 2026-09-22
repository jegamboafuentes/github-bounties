/**
 * Transactional email provider. Server-only.
 * Adapters (Resend today) stay behind this interface. Callers never see API keys.
 */

export type OutboundEmail = {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Provider-level dedupe key. Retries of the same outbox row must reuse it. */
  idempotencyKey: string;
};

export type EmailProviderSendResult =
  | { ok: true; providerMessageId: string }
  | { ok: false; error: string; retryable: boolean };

export interface TransactionalEmailProvider {
  readonly name: string;
  send(message: OutboundEmail): Promise<EmailProviderSendResult>;
}
