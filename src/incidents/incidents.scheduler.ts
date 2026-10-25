import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { IncidentStatus, Role, SeverityLevel } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

const THREE_HOURS_MS = 3 * 60 * 60 * 1000;

/**
 * CR-001: Nhắc nhở sự cố định kỳ mỗi 3 giờ khi sự cố vẫn REPORTED và chưa được Bác sĩ thú y tiếp nhận.
 * Dừng ngay lập tức khi Bác sĩ thú y chuyển sang UNDER_REVIEW (reviewedAt != null) hoặc sự cố kết thúc.
 * Dedupe bằng dedupeKey: INCIDENT_REMINDER:{incidentId}:{threeHourRound}:{recipientId}.
 */
@Injectable()
export class IncidentsScheduler {
  private readonly logger = new Logger(IncidentsScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron('0 * * * *', { name: 'incident-escalation-reminders' })
  async checkAndSendReminders(now = new Date()): Promise<number> {
    try {
      const unreviewedIncidents = await this.prisma.incidentReport.findMany({
        where: {
          status: IncidentStatus.REPORTED,
          reviewedAt: null,
        },
        include: {
          horse: {
            select: {
              id: true,
              name: true,
              horseCode: true,
            },
          },
        },
      });

      let dispatched = 0;

      for (const incident of unreviewedIncidents) {
        const elapsedMs = now.getTime() - incident.createdAt.getTime();
        if (elapsedMs < THREE_HOURS_MS) {
          continue;
        }

        const threeHourRound = Math.floor(elapsedMs / THREE_HOURS_MS);
        if (threeHourRound < 1) continue;

        const isCritical = incident.severity === SeverityLevel.CRITICAL;
        const dedupeBase = `INCIDENT_REMINDER:${incident.id}:${threeHourRound}`;

        const titlePrefix = isCritical
          ? '🚨 [NHẮC NHỞ KHẨN CẤP] Sự cố chưa được xử lý:'
          : '⚠️ [Nhắc nhở] Sự cố chưa được xử lý:';

        await this.notifications.notifyHorse(
          incident.horseId,
          isCritical
            ? {
                roles: [Role.VETERINARIAN, Role.HEAD_TRAINER, Role.CLUB_MANAGER],
                owner: true,
                groom: true,
              }
            : {
                roles: [Role.VETERINARIAN],
                owner: true,
                groom: true,
              },
          {
            type: 'INCIDENT_ESCALATION_REMINDER',
            category: 'MEDICAL',
            title: `${titlePrefix} ${incident.horse.name} (${incident.horse.horseCode || ''})`,
            message: `Sự cố ${incident.incidentNumber} (${incident.severity}) đã báo cáo ${threeHourRound * 3} giờ trước nhưng chưa được Bác sĩ thú y tiếp nhận xử lý.`,
            params: {
              incidentId: incident.id,
              incidentNumber: incident.incidentNumber || incident.id,
              severity: incident.severity,
              round: threeHourRound,
              elapsedHours: threeHourRound * 3,
            },
            link: '/incidents',
            senderName: 'EquiFlow',
            dedupeKey: dedupeBase,
          },
        );

        dispatched++;
      }

      return dispatched;
    } catch (err) {
      this.logger.error(`Lỗi khi quét nhắc nhở sự cố: ${(err as Error).message}`);
      return 0;
    }
  }
}
