import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import type { NotifyPlayerOfTheWeekEvent } from './notifyPlayerOfTheWeek.js';

/**
 * Starts the notify-potw Lambda without waiting for it ("Event" invocation):
 * it can take several minutes to see the page go live, far longer than the
 * admin page's request may stay open.
 */
export async function startPlayerOfTheWeekNotification(functionName: string, event: NotifyPlayerOfTheWeekEvent, client: Pick<LambdaClient, 'send'> = new LambdaClient({})): Promise<void> {
  await startAsyncInvoke(functionName, event, client);
}

/** Invokes a Lambda without waiting for it to finish. */
export async function startAsyncInvoke(functionName: string, payload: unknown, client: Pick<LambdaClient, 'send'> = new LambdaClient({})): Promise<void> {
  await client.send(new InvokeCommand({ FunctionName: functionName, InvocationType: 'Event', Payload: Buffer.from(JSON.stringify(payload)) }));
}
