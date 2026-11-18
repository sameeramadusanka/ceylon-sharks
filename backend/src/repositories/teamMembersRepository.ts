import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';

export interface TeamMember {
  email: string;
  playerId?: string;
  name: string;
  role: 'PLAYER' | 'CAPTAIN' | 'VICE_CAPTAIN';
  isActive: boolean;
}

export async function listActiveMembers(docClient: DynamoDBDocumentClient, tableName: string): Promise<TeamMember[]> {
  const members: TeamMember[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const result = await docClient.send(
      new ScanCommand({
        TableName: tableName,
        FilterExpression: 'isActive = :active',
        ExpressionAttributeValues: { ':active': true },
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );
    members.push(...((result.Items as TeamMember[] | undefined) ?? []));
    exclusiveStartKey = result.LastEvaluatedKey;
  } while (exclusiveStartKey);

  return members;
}
