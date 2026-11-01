/*
 * USD amounts from the PopNow API. Every amount is an exact decimal string (up to nine decimal
 * places, no exponent) and stays a string here: nothing is parsed into a float, rounded or summed.
 *
 * The integer credit fields (1 credit = $0.001) are deprecated display projections. They are read
 * only when a response carries no USD field, which is how responses from older servers look.
 */
/** Where API users add funds. Website credits do not pay for API calls. */
export const ADD_FUNDS_URL = "https://popnow.ai/api/console/billing";
/** USD prices for every model on the API. */
export const API_PRICING_URL = "https://popnow.ai/api/pricing";
function usd(value) {
    return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}
/** Exact USD for a legacy credit amount, using integer arithmetic only (1 credit = $0.001). */
export function creditsToUsd(credits) {
    if (typeof credits !== "number" || !Number.isSafeInteger(credits))
        return undefined;
    const sign = credits < 0 ? "-" : "";
    const abs = Math.abs(credits);
    const fraction = String(abs % 1000).padStart(3, "0").replace(/0+$/, "");
    return `${sign}${Math.floor(abs / 1000)}${fraction ? `.${fraction}` : ""}`;
}
/** `$0.45`, `-$1.5`: the server's digits unchanged, with a currency sign for people. */
export function formatUsd(value) {
    return value.startsWith("-") ? `-$${value.slice(1)}` : `$${value}`;
}
/** The exact maximum a quote holds: `maxChargeUsd`, then its legacy aliases, then credits. */
export function quoteMaxUsd(quote) {
    return (usd(quote.maxChargeUsd) ?? usd(quote.maxCharge) ?? usd(quote.estimatedCost) ?? creditsToUsd(quote.maxCredits));
}
/** The typical charge of a quote: informational, never used to confirm a hold. */
export function quoteExpectedUsd(quote) {
    return usd(quote.expectedChargeUsd) ?? usd(quote.expectedCharge) ?? creditsToUsd(quote.expectedCredits);
}
/**
 * The confirmation createTask receives with the quote id: the quote's exact USD maximum as
 * `expectedCostUsd`. Only when a response carries no USD amount at all does it fall back to the
 * deprecated `expectedCredits`; with neither, `quoteId` alone confirms the quoted price.
 */
export function holdConfirmation(quote) {
    const exact = usd(quote.maxChargeUsd) ?? usd(quote.maxCharge) ?? usd(quote.estimatedCost);
    if (exact !== undefined)
        return { expectedCostUsd: exact };
    if (typeof quote.maxCredits === "number")
        return { expectedCredits: quote.maxCredits };
    return {};
}
/** USD held when a task was accepted. */
export function createdHoldUsd(task) {
    return usd(task.estimatedCostUsd) ?? usd(task.estimatedCost) ?? creditsToUsd(task.estimatedCredits);
}
/** A task's final charge once settled, otherwise its hold. */
export function taskCostUsd(task) {
    return usd(task.costUsd) ?? usd(task.cost) ?? creditsToUsd(task.credits);
}
export function balanceUsd(balance) {
    const available = usd(balance.availableUsd) ?? usd(balance.available) ?? creditsToUsd(balance.availableCredits);
    const held = usd(balance.heldUsd) ?? usd(balance.held) ?? creditsToUsd(balance.heldCredits);
    const total = usd(balance.totalUsd) ?? usd(balance.total) ?? creditsToUsd(balance.totalCredits);
    return {
        ...(available === undefined ? {} : { available }),
        ...(held === undefined ? {} : { held }),
        ...(total === undefined ? {} : { total }),
    };
}
/** True for "0", "0.000", "-1.5" and so on: nothing left for a new task's hold. */
export function isZeroOrNegative(value) {
    return value.startsWith("-") || /^0*(?:\.0*)?$/.test(value);
}
/**
 * Each deprecated credit field, and the USD fields that make it redundant when present in the
 * same object. Human-readable output leaves the credit field out in that case; `--json` keeps
 * every field the server sent.
 */
const LEGACY_CREDIT_FIELDS = {
    maxCredits: ["maxChargeUsd", "maxCharge"],
    expectedCredits: ["expectedChargeUsd", "expectedCharge"],
    estimatedCredits: ["estimatedCostUsd", "estimatedCost"],
    credits: ["costUsd", "cost", "spend", "usd"],
    exactCredits: ["costUsd", "cost"],
    availableCredits: ["availableUsd", "available"],
    heldCredits: ["heldUsd", "held"],
    totalCredits: ["totalUsd", "total", "totalSpend"],
};
export function withoutRedundantCredits(value) {
    if (Array.isArray(value))
        return value.map(withoutRedundantCredits);
    if (value === null || typeof value !== "object")
        return value;
    const record = value;
    const result = {};
    for (const [key, item] of Object.entries(record)) {
        const replacements = LEGACY_CREDIT_FIELDS[key];
        if (replacements?.some((name) => record[name] !== undefined))
            continue;
        result[key] = withoutRedundantCredits(item);
    }
    return result;
}
