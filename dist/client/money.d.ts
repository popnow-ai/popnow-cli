import type { Balance, CreatedTask, CreateTaskRequest, TaskQuote, TaskRecord } from "./types.js";
/** Where API users add funds. Website credits do not pay for API calls. */
export declare const ADD_FUNDS_URL = "https://popnow.ai/api/console/billing";
/** USD prices for every model on the API. */
export declare const API_PRICING_URL = "https://popnow.ai/api/pricing";
/** Exact USD for a legacy credit amount, using integer arithmetic only (1 credit = $0.001). */
export declare function creditsToUsd(credits: unknown): string | undefined;
/** `$0.45`, `-$1.5`: the server's digits unchanged, with a currency sign for people. */
export declare function formatUsd(value: string): string;
/** The exact maximum a quote holds: `maxChargeUsd`, then its legacy aliases, then credits. */
export declare function quoteMaxUsd(quote: TaskQuote): string | undefined;
/** The typical charge of a quote: informational, never used to confirm a hold. */
export declare function quoteExpectedUsd(quote: TaskQuote): string | undefined;
/**
 * The confirmation createTask receives with the quote id: the quote's exact USD maximum as
 * `expectedCostUsd`. Only when a response carries no USD amount at all does it fall back to the
 * deprecated `expectedCredits`; with neither, `quoteId` alone confirms the quoted price.
 */
export declare function holdConfirmation(quote: TaskQuote): Pick<CreateTaskRequest, "expectedCostUsd" | "expectedCredits">;
/** USD held when a task was accepted. */
export declare function createdHoldUsd(task: CreatedTask): string | undefined;
/** A task's final charge once settled, otherwise its hold. */
export declare function taskCostUsd(task: TaskRecord): string | undefined;
export interface BalanceUsd {
    available?: string;
    held?: string;
    total?: string;
}
export declare function balanceUsd(balance: Balance): BalanceUsd;
/** True for "0", "0.000", "-1.5" and so on: nothing left for a new task's hold. */
export declare function isZeroOrNegative(value: string): boolean;
export declare function withoutRedundantCredits(value: unknown): unknown;
