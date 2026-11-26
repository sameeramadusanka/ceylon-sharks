import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';

// The fine-grained GitHub token lives in SSM Parameter Store as a SecureString
// (created by hand, never in this repo or the CloudFormation template). Cached
// per warm Lambda container so each publish doesn't re-read it.
let cached: { parameterName: string; token: string } | null = null;

export async function getGithubToken(parameterName: string, client: Pick<SSMClient, 'send'> = new SSMClient({})): Promise<string> {
  if (cached?.parameterName === parameterName) return cached.token;
  const result = await client.send(new GetParameterCommand({ Name: parameterName, WithDecryption: true }));
  const token = result.Parameter?.Value?.trim();
  if (!token) throw new Error(`SSM parameter ${parameterName} is empty`);
  cached = { parameterName, token };
  return token;
}

/** Test helper: forget the cached token. */
export function resetGithubTokenCache(): void {
  cached = null;
}
