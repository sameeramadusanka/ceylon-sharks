import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';

export function createSesClient(): SESv2Client {
  return new SESv2Client({});
}

export interface EmailContent {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
}

export async function sendEmail(sesClient: SESv2Client, content: EmailContent): Promise<void> {
  await sesClient.send(
    new SendEmailCommand({
      FromEmailAddress: content.from,
      Destination: { ToAddresses: content.to },
      Content: {
        Simple: {
          Subject: { Data: content.subject, Charset: 'UTF-8' },
          Body: {
            Html: { Data: content.html, Charset: 'UTF-8' },
            Text: { Data: content.text, Charset: 'UTF-8' },
          },
        },
      },
    }),
  );
}
