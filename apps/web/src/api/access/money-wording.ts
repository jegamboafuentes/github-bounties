/** Sentence shown only when money actions are off for this deployment. */
export const MONEY_ACTIONS_DISABLED = "Money actions are currently disabled on this deployment.";

export const MONEY_OPERATION_PATHS = [
  "/api/v1/bounties/{id}/fund",
  "/api/v1/bounties/{id}/top-up",
  "/api/v1/bounties/{id}/claim",
  "/api/v1/bounties/{id}/refund",
] as const;

/** Empty when money is on, so callers say nothing about the gate. */
export function moneyActionsNote(enabled: boolean): string {
  return enabled ? "" : MONEY_ACTIONS_DISABLED;
}

/** Lead sentence for the five money MCP tools and the anonymous money error. */
export function moneyScopeRequirement(enabled: boolean): string {
  const note = moneyActionsNote(enabled);
  return note ? `Requires API key with money scope. ${note}` : "Requires API key with money scope.";
}

export function apiKeyRequiredMessage(
  klass: "read" | "write" | "money",
  moneyEnabled: boolean,
): string {
  const lead =
    klass === "money" ? moneyScopeRequirement(moneyEnabled) : `Requires API key (${klass} scope).`;
  return `${lead} Send Authorization: Bearer <api key>. Cookies are not accepted.`;
}

/** OpenAPI money operations start with "Scope money." The disabled sentence follows only when the flag is off. */
export function applyOpenApiMoneyStatus(description: string, enabled: boolean): string {
  const without = description.replace(` ${MONEY_ACTIONS_DISABLED}`, "");
  if (enabled || without.includes(MONEY_ACTIONS_DISABLED)) return without;
  const lead = "Scope money.";
  if (without.startsWith(lead)) {
    return `${lead} ${MONEY_ACTIONS_DISABLED}${without.slice(lead.length)}`;
  }
  return `${without} ${MONEY_ACTIONS_DISABLED}`;
}

const INFO_MONEY_ANCHOR = "headless x402 fund and top-up.";

/** info.description mentions the disabled state only when money is off. */
export function applyInfoMoneyStatus(description: string, enabled: boolean): string {
  const without = description.replace(` ${MONEY_ACTIONS_DISABLED}`, "");
  if (enabled || without.includes(MONEY_ACTIONS_DISABLED)) return without;
  return without.replace(INFO_MONEY_ANCHOR, `${INFO_MONEY_ANCHOR} ${MONEY_ACTIONS_DISABLED}`);
}
