import { readFileSync } from 'node:fs';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { z } from 'zod';

/**
 * Seeds backend/seed-data/team-members.json (gitignored - see .gitignore)
 * into the deployed TeamMembers table. Run after `sam deploy`:
 *
 *   TEAM_MEMBERS_TABLE=<table-name> npm run seed:team-members
 *
 * Only backend/seed-data/team-members.example.json (fake data) is
 * committed. Never commit the real file - it contains real player
 * email addresses.
 */

const TeamMemberSchema = z.object({
  email: z.email(),
  name: z.string().min(1),
  role: z.enum(['PLAYER', 'CAPTAIN', 'VICE_CAPTAIN']),
  isActive: z.boolean(),
  playerId: z.string().optional(),
});

async function main(): Promise<void> {
  const tableName = process.env.TEAM_MEMBERS_TABLE;
  if (!tableName) {
    throw new Error('Set TEAM_MEMBERS_TABLE to the deployed table name before seeding.');
  }

  const filePath = process.argv[2] ?? 'seed-data/team-members.json';
  const members = z.array(TeamMemberSchema).parse(JSON.parse(readFileSync(filePath, 'utf8')));

  const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const now = new Date().toISOString();

  for (const member of members) {
    await docClient.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          email: member.email.toLowerCase(),
          name: member.name,
          role: member.role,
          isActive: member.isActive,
          ...(member.playerId ? { playerId: member.playerId } : {}),
          createdAt: now,
          updatedAt: now,
        },
      }),
    );
    console.log(`Seeded ${member.email} (${member.role})`);
  }

  console.log(`Done - seeded ${members.length} team member(s) into ${tableName}.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
