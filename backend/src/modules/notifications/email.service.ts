import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Stub email — log uniquement en dev.
 * En prod : remplacer par Nodemailer + SES/Mailgun/Postmark, ou faire passer par une queue.
 *   import nodemailer from 'nodemailer';
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly from: string;

  constructor(private readonly cfg: ConfigService) {
    this.from = cfg.get<string>('EMAIL_FROM', 'noreply@example.com');
  }

  async send(input: { to: string; subject: string; text: string; html?: string }) {
    if (this.cfg.get<string>('EMAIL_DRIVER', 'log') === 'log') {
      this.logger.log(
        `📧 [stub] to=${input.to} subject="${input.subject}" body="${input.text.slice(0, 140)}"`,
      );
      return { messageId: `stub-${Date.now()}` };
    }
    // TODO prod : intégrer Nodemailer + SMTP/SES
    throw new Error('EMAIL_DRIVER non implémenté');
  }
}
