import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { MailService } from './mail.service';

describe('MailService', () => {
  it('should initialize in mock mode when EMAIL_PROVIDER is mock', async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MailService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              if (key === 'EMAIL_PROVIDER') return 'mock';
              return null;
            },
          },
        },
      ],
    }).compile();

    const service = module.get<MailService>(MailService);
    expect(service).toBeDefined();

    // Calling send should not throw
    await expect(service.send('test@example.com', 'Subject', 'Body')).resolves.not.toThrow();
  });

  it('should fall back to mock mode when EMAIL_PROVIDER is resend but RESEND_API_KEY is missing', async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MailService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              if (key === 'EMAIL_PROVIDER') return 'resend';
              if (key === 'RESEND_API_KEY') return '';
              return null;
            },
          },
        },
      ],
    }).compile();

    const service = module.get<MailService>(MailService);
    expect(service).toBeDefined();
    await expect(service.send('test@example.com', 'Subject', 'Body')).resolves.not.toThrow();
  });

  it('should initialize resend client when RESEND_API_KEY is provided', async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MailService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              if (key === 'EMAIL_PROVIDER') return 'resend';
              if (key === 'RESEND_API_KEY') return 're_test_key_12345';
              if (key === 'EMAIL_FROM') return 'EquiFlow <onboarding@resend.dev>';
              return null;
            },
          },
        },
      ],
    }).compile();

    const service = module.get<MailService>(MailService);
    expect(service).toBeDefined();
  });

  describe('business send over unauthenticated SMTP (Mailpit)', () => {
    const mailpitConfig = {
      provide: ConfigService,
      useValue: {
        get: (key: string) => {
          if (key === 'EMAIL_PROVIDER') return 'smtp';
          if (key === 'MAIL_HOST') return '127.0.0.1';
          if (key === 'MAIL_PORT') return '1025';
          if (key === 'EMAIL_FROM') return 'EquiFlow <noreply@tmec.site>';
          return null;
        },
      },
    };

    it('uses a real SMTP transporter (not mock) when SMTP_USER is empty but MAIL_HOST is set', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [MailService, mailpitConfig],
      }).compile();
      const service = module.get<MailService>(MailService);
      const transporter = (service as unknown as { transporter: { sendMail: () => unknown } })
        .transporter;
      expect(transporter).toBeDefined();
      const sendMail = jest.fn().mockResolvedValue({ messageId: 'accept' });
      transporter.sendMail = sendMail;
      const accepted = await service.sendBusiness('owner@example.com', 'Nhắc hạn', 'Body');
      expect(sendMail).toHaveBeenCalledTimes(1);
      expect(accepted).toBe(true);
    });

    it('returns false (does not throw) when SMTP rejects', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [MailService, mailpitConfig],
      }).compile();
      const service = module.get<MailService>(MailService);
      const transporter = (service as unknown as { transporter: { sendMail: () => unknown } })
        .transporter;
      transporter.sendMail = jest.fn().mockRejectedValue(new Error('connection refused'));
      await expect(service.sendBusiness('owner@example.com', 'Nhắc hạn', 'Body')).resolves.toBe(
        false,
      );
    });
  });

  describe('resend with Mailpit SMTP fallback', () => {
    it('uses Mailpit SMTP immediately when EMAIL_PROVIDER=resend without RESEND_API_KEY and MAIL_HOST is set', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          MailService,
          {
            provide: ConfigService,
            useValue: {
              get: (key: string) => {
                if (key === 'EMAIL_PROVIDER') return 'resend';
                if (key === 'RESEND_API_KEY') return '';
                if (key === 'MAIL_HOST') return '127.0.0.1';
                if (key === 'MAIL_PORT') return '1025';
                return null;
              },
            },
          },
        ],
      }).compile();

      const service = module.get<MailService>(MailService);
      const transporter = (service as unknown as { transporter: { sendMail: () => unknown } })
        .transporter;
      expect(transporter).toBeDefined();
      const sendMail = jest.fn().mockResolvedValue({ messageId: 'mailpit-1' });
      transporter.sendMail = sendMail;

      const sent = await service.sendBusiness('owner@example.com', 'OTP', 'Code 123456');
      expect(sent).toBe(true);
      expect(sendMail).toHaveBeenCalledTimes(1);
    });

    it('falls back to Mailpit SMTP when Resend returns an error or throws', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          MailService,
          {
            provide: ConfigService,
            useValue: {
              get: (key: string) => {
                if (key === 'EMAIL_PROVIDER') return 'resend';
                if (key === 'RESEND_API_KEY') return 're_test_key_12345';
                if (key === 'MAIL_HOST') return '127.0.0.1';
                if (key === 'MAIL_PORT') return '1025';
                return null;
              },
            },
          },
        ],
      }).compile();

      const service = module.get<MailService>(MailService);
      const internal = service as unknown as {
        resend: { emails: { send: jest.Mock } };
        transporter: { sendMail: jest.Mock };
      };
      internal.resend.emails.send = jest.fn().mockResolvedValue({
        data: null,
        error: { message: 'Domain not verified' },
      });
      internal.transporter.sendMail = jest.fn().mockResolvedValue({ messageId: 'fallback-1' });

      const first = await service.sendBusiness('owner@example.com', 'OTP', 'Code 123456');
      expect(first).toBe(true);
      expect(internal.transporter.sendMail).toHaveBeenCalledTimes(1);

      internal.resend.emails.send = jest.fn().mockRejectedValue(new Error('network timeout'));
      await expect(service.send('owner@example.com', 'Test', 'Hello')).resolves.not.toThrow();
      expect(internal.transporter.sendMail).toHaveBeenCalledTimes(2);
    });

    it('uses Gmail SMTP_HOST (not local MAIL_HOST) & SMTP_USER From and activates quota cooldown on daily limit', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          MailService,
          {
            provide: ConfigService,
            useValue: {
              get: (key: string) => {
                if (key === 'EMAIL_PROVIDER') return 'resend';
                if (key === 'RESEND_API_KEY') return 're_test_key_12345';
                if (key === 'EMAIL_FROM') return 'TMEC System <noreply@tmec.site>';
                if (key === 'SMTP_HOST') return 'smtp.gmail.com';
                if (key === 'SMTP_PORT') return '587';
                if (key === 'SMTP_USER') return 'club.mailer@gmail.com';
                if (key === 'SMTP_PASS') return 'app-password';
                if (key === 'MAIL_HOST') return '127.0.0.1';
                if (key === 'MAIL_PORT') return '1025';
                return null;
              },
            },
          },
        ],
      }).compile();

      const service = module.get<MailService>(MailService);
      const internal = service as unknown as {
        resend: { emails: { send: jest.Mock } };
        transporter: {
          options: { host: string; port: number };
          sendMail: jest.Mock;
        };
      };

      expect(internal.transporter.options.host).toBe('smtp.gmail.com');
      expect(internal.transporter.options.port).toBe(587);

      internal.resend.emails.send = jest.fn().mockResolvedValue({
        data: null,
        error: { message: 'Daily email sending quota exceeded', statusCode: 429 },
      });
      internal.transporter.sendMail = jest.fn().mockResolvedValue({ messageId: 'gmail-1' });

      const first = await service.sendBusiness('owner@example.com', 'OTP 1', 'Body');
      expect(first).toBe(true);
      expect(internal.resend.emails.send).toHaveBeenCalledTimes(1);
      expect(internal.transporter.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          from: 'TMEC System <club.mailer@gmail.com>',
          to: 'owner@example.com',
        }),
      );

      // Cooldown active: second call skips Resend and goes directly to Gmail SMTP fallback.
      const second = await service.sendBusiness('owner@example.com', 'OTP 2', 'Body');
      expect(second).toBe(true);
      expect(internal.resend.emails.send).toHaveBeenCalledTimes(1);
      expect(internal.transporter.sendMail).toHaveBeenCalledTimes(2);
    });
  });

  it('should format and send OTP email without error in mock mode', async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MailService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              if (key === 'EMAIL_PROVIDER') return 'mock';
              return null;
            },
          },
        },
      ],
    }).compile();

    const service = module.get<MailService>(MailService);
    await expect(
      service.sendOtp('user@gmail.com', {
        code: '654321',
        purposeLabel: 'xác thực tài khoản',
        expiresInMinutes: 10,
      }),
    ).resolves.not.toThrow();
  });
});
