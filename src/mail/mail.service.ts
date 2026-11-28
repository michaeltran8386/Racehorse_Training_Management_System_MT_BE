import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { Resend } from 'resend';
import { buildOtpEmail, OtpEmailOptions } from './templates/otp-email.template';

/** Thời gian tạm bỏ qua Resend sau khi chạm giới hạn ngày/tốc độ (1 giờ) để đi thẳng qua SMTP/Mailpit fallback. */
const RESEND_QUOTA_COOLDOWN_MS = 60 * 60 * 1000;

function isQuotaOrRateLimitError(err: {
  message?: string | null;
  name?: string | null;
  statusCode?: number | null;
}): boolean {
  if (err.statusCode === 429) return true;
  const text = `${err.name || ''} ${err.message || ''}`.toLowerCase();
  return (
    text.includes('daily') ||
    text.includes('quota') ||
    text.includes('rate_limit') ||
    text.includes('rate limit') ||
    text.includes('limit exceeded') ||
    text.includes('too many requests') ||
    text.includes('429')
  );
}

/**
 * Gửi email (mã OTP, lời mời, kết quả duyệt tài khoản) qua Resend hoặc SMTP.
 * - EMAIL_PROVIDER=resend => gửi qua Resend HTTP API (cần RESEND_API_KEY);
 *   nếu có cấu hình SMTP (Gmail SMTP trên deploy) hoặc MAIL_HOST (Mailpit local)
 *   thì tự động fallback sang SMTP khi Resend thiếu key, lỗi hoặc chạm giới hạn 100 mail/ngày.
 * - EMAIL_PROVIDER=smtp   => gửi qua SMTP (Gmail, Resend SMTP, Mailpit, v.v.).
 * - EMAIL_PROVIDER=mock   hoặc chưa cấu hình credentials => chỉ in log (tiện dev/test).
 * Lỗi gửi mail KHÔNG làm hỏng request: ghi log, người dùng có thể bấm "Resend".
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly provider: 'resend' | 'smtp' | 'mock';
  private readonly resend: Resend | null = null;
  private readonly transporter: nodemailer.Transporter | null = null;
  private readonly from: string;
  private readonly smtpFallbackFrom: string;
  private resendCooldownUntil = 0;

  constructor(config: ConfigService) {
    const provider = (config.get<string>('EMAIL_PROVIDER') || 'mock').toLowerCase();
    const resendApiKey = config.get<string>('RESEND_API_KEY') || '';
    const smtpUser = config.get<string>('SMTP_USER') || '';
    const smtpTransporter = this.createSmtpTransporter(config);

    if (provider === 'resend') {
      if (!resendApiKey) {
        if (smtpTransporter) {
          this.logger.warn(
            'EMAIL_PROVIDER=resend nhưng RESEND_API_KEY đang trống. Tự động fallback sang SMTP/Mailpit.',
          );
          this.provider = 'smtp';
          this.transporter = smtpTransporter;
        } else {
          this.logger.warn(
            'EMAIL_PROVIDER=resend nhưng RESEND_API_KEY đang trống. Chuyển sang chế độ MOCK (in log).',
          );
          this.provider = 'mock';
        }
      } else {
        this.provider = 'resend';
        this.resend = new Resend(resendApiKey);
        this.transporter = smtpTransporter;
      }
    } else if (provider === 'smtp') {
      if (smtpTransporter) {
        this.provider = 'smtp';
        this.transporter = smtpTransporter;
      } else {
        this.logger.warn(
          'EMAIL_PROVIDER=smtp nhưng SMTP_USER và MAIL_HOST đang trống. Chuyển sang chế độ MOCK (in log).',
        );
        this.provider = 'mock';
      }
    } else {
      this.provider = 'mock';
    }

    const defaultFrom =
      this.provider === 'resend'
        ? 'TMEC System <noreply@tmec.site>'
        : smtpUser || 'TMEC System <noreply@tmec.site>';

    this.from = config.get<string>('EMAIL_FROM') || defaultFrom;
    const explicitSmtpFrom = config.get<string>('SMTP_FROM') || '';
    // Khi Resend fallback sang Gmail SMTP (có SMTP_USER), ưu tiên SMTP_FROM hoặc địa chỉ SMTP_USER để tránh lệch DMARC domain của Resend.
    this.smtpFallbackFrom =
      explicitSmtpFrom || (smtpUser.includes('@') ? `TMEC System <${smtpUser}>` : this.from);

    if (this.provider === 'mock') {
      this.logger.warn(
        'Email is NOT sent (EMAIL_PROVIDER=mock or credentials empty): OTP codes are printed to this log. See .env.example.',
      );
    } else {
      const fallbackNote =
        this.provider === 'resend' && this.transporter
          ? ` (${smtpUser ? 'Gmail/SMTP' : 'Mailpit'} fallback ready)`
          : '';
      this.logger.log(
        `MailService initialized with provider: ${this.provider.toUpperCase()} (From: ${this.from})${fallbackNote}`,
      );
    }
  }

  private createSmtpTransporter(config: ConfigService): nodemailer.Transporter | null {
    const smtpUser = config.get<string>('SMTP_USER') || '';

    if (smtpUser) {
      // Deploy / authenticated SMTP (ví dụ Gmail): ưu tiên SMTP_HOST/SMTP_PORT để không bị MAIL_HOST=127.0.0.1 ghi đè.
      const smtpHost = config.get<string>('SMTP_HOST') || config.get<string>('MAIL_HOST') || '';
      const smtpPort = Number(
        config.get<string>('SMTP_PORT') || config.get<string>('MAIL_PORT') || 587,
      );
      return nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465,
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 20000,
        auth: { user: smtpUser, pass: config.get<string>('SMTP_PASS') || '' },
      });
    }

    const mailHost = config.get<string>('MAIL_HOST') || config.get<string>('SMTP_HOST') || '';
    const mailPort = Number(
      config.get<string>('MAIL_PORT') || config.get<string>('SMTP_PORT') || 587,
    );

    if (mailHost) {
      const isLocal = ['127.0.0.1', 'localhost', '::1'].includes(mailHost.toLowerCase());
      if (process.env.NODE_ENV === 'production' && isLocal) {
        return null;
      }
      // Mailpit / SMTP nội bộ không xác thực (NOTE.md §6.1): có host, không user/pass.
      return nodemailer.createTransport({
        host: mailHost,
        port: mailPort,
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 20000,
        secure: false,
      });
    }

    return null;
  }

  /**
   * Gửi OTP với cấu trúc chuẩn hoá để kích hoạt tính năng thông minh của Gmail (nút "Sao chép mã" native).
   */
  async sendOtp(to: string, options: OtpEmailOptions): Promise<void> {
    const { subject, text, html } = buildOtpEmail(options);
    await this.send(to, subject, text, html);
  }

  /**
   * Gửi mail nghiệp vụ (nhắc nợ, cảnh báo, chứng từ). Trả boolean để người gọi
   * ghi nhận trạng thái "SMTP accept" (không đồng nghĩa thư đã vào inbox):
   * - true: provider thật (smtp/resend, hoặc SMTP fallback khi resend lỗi) đã chấp nhận thư.
   * - false: chế độ mock (chỉ in log) hoặc mọi provider đều lỗi.
   * Không bao giờ throw — lỗi được ghi log, giao dịch chính không bị ảnh hưởng.
   */
  async sendBusiness(to: string, subject: string, text: string, html?: string): Promise<boolean> {
    return this.dispatch(to, subject, text, html);
  }

  async send(to: string, subject: string, text: string, html?: string): Promise<void> {
    await this.dispatch(to, subject, text, html);
  }

  private async dispatch(
    to: string,
    subject: string,
    text: string,
    html?: string,
  ): Promise<boolean> {
    if (this.provider === 'mock') {
      this.logger.log(`[mail:console] to=${to} | ${subject}\n${text}`);
      return false;
    }

    const renderedHtml = html || this.wrapDefaultHtml(subject, text);
    const safeSubject = subject.replace(/\d{6}/, '******');

    if (this.provider === 'resend' && this.resend) {
      if (this.transporter && Date.now() < this.resendCooldownUntil) {
        return this.sendViaSmtp(to, subject, text, renderedHtml, safeSubject, true);
      }

      let resendFailed = false;
      try {
        const { data, error } = await this.resend.emails.send({
          from: this.from,
          to,
          subject,
          text,
          html: renderedHtml,
        });
        if (error) {
          this.logger.error(`[mail:resend] error sending "${subject}" to ${to}: ${error.message}`);
          if (isQuotaOrRateLimitError(error) && this.transporter) {
            this.resendCooldownUntil = Date.now() + RESEND_QUOTA_COOLDOWN_MS;
            this.logger.warn(
              '[mail:resend] daily/rate limit reached — switching directly to SMTP/Mailpit fallback for 60 minutes.',
            );
          }
          resendFailed = true;
        } else {
          this.logger.log(`[mail:resend] sent to ${to} (id: ${data?.id}) | ${safeSubject}`);
          return true;
        }
      } catch (err) {
        this.logger.error(`[mail:resend] failed to send "${subject}" to ${to}: ${String(err)}`);
        const errObj =
          typeof err === 'object' && err !== null
            ? (err as { message?: string | null; name?: string | null; statusCode?: number | null })
            : { message: String(err) };
        if (isQuotaOrRateLimitError(errObj) && this.transporter) {
          this.resendCooldownUntil = Date.now() + RESEND_QUOTA_COOLDOWN_MS;
          this.logger.warn(
            '[mail:resend] daily/rate limit reached — switching directly to SMTP/Mailpit fallback for 60 minutes.',
          );
        }
        resendFailed = true;
      }

      if (resendFailed && this.transporter) {
        this.logger.warn(
          `[mail:resend] falling back to SMTP/Mailpit for "${safeSubject}" to ${to}`,
        );
        return this.sendViaSmtp(to, subject, text, renderedHtml, safeSubject, true);
      }
      return false;
    }

    if (this.provider === 'smtp' && this.transporter) {
      return this.sendViaSmtp(to, subject, text, renderedHtml, safeSubject, false);
    }

    return false;
  }

  private async sendViaSmtp(
    to: string,
    subject: string,
    text: string,
    html: string,
    safeSubject: string,
    isFallback: boolean,
  ): Promise<boolean> {
    if (!this.transporter) return false;
    try {
      await this.transporter.sendMail({
        from: isFallback ? this.smtpFallbackFrom : this.from,
        to,
        subject,
        text,
        html,
      });
      this.logger.log(
        `[mail:${isFallback ? 'smtp:fallback' : 'smtp'}] sent to ${to} | ${safeSubject}`,
      );
      return true;
    } catch (err) {
      this.logger.error(
        `[mail:${isFallback ? 'smtp:fallback' : 'smtp'}] failed to send "${subject}" to ${to}: ${String(err)}`,
      );
      return false;
    }
  }

  private wrapDefaultHtml(subject: string, text: string): string {
    const formattedBody = text
      .split('\n\n')
      .map(
        (p) =>
          `<p style="margin: 0 0 16px 0; line-height: 1.6; color: #cbd5e1;">${p.replace(/\n/g, '<br/>')}</p>`,
      )
      .join('');

    return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
</head>
<body style="margin: 0; padding: 32px 0; background-color: #0a161c; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #ede6d3;">
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
    <tr>
      <td align="center" style="padding: 12px;">
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="560" style="background-color: #13262d; border-radius: 12px; border: 1px solid #1d3a44; overflow: hidden; box-shadow: 0 16px 36px -4px rgba(0, 0, 0, 0.75);">
          <tr>
            <td height="4" style="background-color: #f4b942; font-size: 1px; line-height: 1px;">&nbsp;</td>
          </tr>
          <tr>
            <td style="padding: 32px 40px; font-size: 15px; line-height: 1.6; color: #cbd5e1;">
              <div style="font-size: 22px; font-weight: 800; letter-spacing: 2px; color: #ede6d3; text-transform: uppercase; margin-bottom: 4px;">
                EquiFlow
              </div>
              <div style="font-size: 11px; font-weight: 700; color: #f4b942; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 24px;">
                Hệ thống Quản lý Huấn luyện Ngựa đua
              </div>
              <h3 style="color: #ede6d3; margin-top: 0; margin-bottom: 18px; font-size: 17px; font-weight: 700;">${subject}</h3>
              <div>
                ${formattedBody}
              </div>
              <div style="border-top: 1px solid #1d3a44; margin-top: 28px; padding-top: 16px; font-size: 12px; color: #64748b;">
                © ${new Date().getFullYear()} EquiFlow Racehorse Training & Management System. All rights reserved.
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }
}
