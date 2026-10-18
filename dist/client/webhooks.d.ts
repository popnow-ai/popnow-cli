export interface WebhookVerification {
    valid: boolean;
    /** Why verification failed; absent when it succeeded. */
    reason?: string;
    kind: "task-callback" | "account-endpoint";
    taskId?: string;
    state?: string;
    /** The delivery ID to de-duplicate on: `request_id` (callbacks) or `webhook-id` (endpoints). */
    deliveryId?: string;
    eventType?: string;
    /** Seconds between the signed timestamp and now, positive when the timestamp is in the past. */
    ageSeconds?: number;
}
export interface VerifyTaskCallbackInput {
    rawBody: Uint8Array;
    timestamp: string;
    signature: string;
    secret: string;
    payloadVersion?: number;
    toleranceSeconds?: number;
    nowSeconds?: number;
}
export interface VerifyEndpointInput {
    rawBody: Uint8Array;
    webhookId: string;
    timestamp: string;
    signature: string;
    secret: string;
    toleranceSeconds?: number;
    nowSeconds?: number;
}
export declare function verifyTaskCallback(input: VerifyTaskCallbackInput): WebhookVerification;
export declare function verifyAccountEndpoint(input: VerifyEndpointInput): WebhookVerification;
