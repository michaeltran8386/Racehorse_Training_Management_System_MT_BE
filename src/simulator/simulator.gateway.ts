import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger, OnModuleDestroy } from '@nestjs/common';
import { plainToInstance, type ClassConstructor } from 'class-transformer';
import { validate } from 'class-validator';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { Role, SimulatorSessionStatus, SimulatorSessionType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { IncidentsService } from '../incidents/incidents.service';
import { CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { SimulatorService } from './simulator.service';
import { SimulatorRealtimeService } from './simulator-realtime.service';
import {
  IncidentReportPacketDto,
  RaceProgressPacketDto,
  SessionFinishedPacketDto,
  TelemetryTickPacketDto,
} from './dto/simulator-packet.dto';
import { SimulatorAck } from './simulator.types';
import { ExamFinishedPacketDto } from './dto/exam-packet.dto';

const ALLOWED_SUBSCRIBERS: Role[] = [Role.CLUB_MANAGER, Role.HEAD_TRAINER, Role.VETERINARIAN];

const ALLOWED_PUBLISHERS: Role[] = [Role.CLUB_MANAGER, Role.HEAD_TRAINER];

async function validatePacket<T extends object>(
  type: ClassConstructor<T>,
  packet: unknown,
): Promise<T> {
  try {
    const value = plainToInstance(type, packet);
    const errors = await validate(value, { whitelist: true, forbidNonWhitelisted: true });
    if (errors.length > 0) throw new Error();
    return value;
  } catch {
    throw new Error('INVALID_SIMULATOR_PACKET');
  }
}

@WebSocketGateway({
  namespace: '/simulator',
  cors: {
    origin: '*',
    credentials: true,
  },
})
export class SimulatorGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy
{
  private readonly logger = new Logger(SimulatorGateway.name);
  private readonly disconnectTimers = new Map<string, NodeJS.Timeout>();
  private readonly sessionTimeouts = new Map<string, NodeJS.Timeout>();
  private readonly emittedFinished = new Set<string>();

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly authService: AuthService,
    private readonly simulatorService: SimulatorService,
    private readonly incidentsService: IncidentsService,
    private readonly realtimeService: SimulatorRealtimeService,
    private readonly prisma: PrismaService,
  ) {}

  afterInit(server: Server) {
    this.realtimeService.setServer(server);
    this.logger.log('Simulator WebSocket gateway initialized at namespace /simulator');
  }

  onModuleDestroy() {
    for (const timer of this.disconnectTimers.values()) clearTimeout(timer);
    for (const timer of this.sessionTimeouts.values()) clearTimeout(timer);
    this.disconnectTimers.clear();
    this.sessionTimeouts.clear();
  }

  private clearSessionTimers(sessionId: string): void {
    const dt = this.disconnectTimers.get(sessionId);
    if (dt) {
      clearTimeout(dt);
      this.disconnectTimers.delete(sessionId);
    }
    const st = this.sessionTimeouts.get(sessionId);
    if (st) {
      clearTimeout(st);
      this.sessionTimeouts.delete(sessionId);
    }
  }

  async handleConnection(client: Socket) {
    try {
      const query = client.handshake.query || {};
      if (
        query.token ||
        query.access_token ||
        query.authorization ||
        query.sessionId ||
        query.session_id
      ) {
        this.logger.warn(
          `Rejected connection [${client.id}]: credentials or sessionId forbidden in query parameters`,
        );
        client.disconnect(true);
        return;
      }

      const rawToken =
        client.handshake.auth?.token ||
        client.handshake.headers?.authorization?.replace(/^Bearer\s+/i, '');

      const sessionId =
        client.handshake.auth?.sessionId ||
        client.handshake.auth?.session_id ||
        (client.handshake.headers?.['x-session-id'] as string | undefined);

      if (!sessionId || typeof sessionId !== 'string' || !sessionId.trim()) {
        this.logger.warn(
          `Rejected connection [${client.id}]: missing required sessionId (token-only forbidden)`,
        );
        client.disconnect(true);
        return;
      }

      client.data.authReady = this.authenticateSessionClient(client, sessionId.trim(), rawToken);
      await client.data.authReady;
      return;
    } catch (err: any) {
      this.logger.error(`Error in handleConnection [${client.id}]: ${err.message}`);
      client.disconnect(true);
    }
  }

  private async authenticateSessionClient(
    client: Socket,
    sessionId: string,
    rawToken?: string,
  ): Promise<void> {
    const session = await this.prisma.simulatorSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      this.logger.warn(`Rejected connection [${client.id}]: session ${sessionId} not found`);
      client.disconnect(true);
      return;
    }

    // Cancel pending disconnect timer if client reconnected within grace period
    if (this.disconnectTimers.has(sessionId)) {
      const pending = this.disconnectTimers.get(sessionId);
      if (pending) {
        clearTimeout(pending);
        this.disconnectTimers.delete(sessionId);
        this.logger.log(
          `Client reconnected for session ${sessionId} within 15s grace period; cancelled disconnect abort timer`,
        );
      }
    }

    if (
      session.status === SimulatorSessionStatus.COMPLETED ||
      session.status === SimulatorSessionStatus.ABORTED_INJURY
    ) {
      this.logger.warn(
        `Rejected connection [${client.id}]: session ${sessionId} is terminal (${session.status})`,
      );
      client.disconnect(true);
      return;
    }

    if (
      session.status === SimulatorSessionStatus.PENDING &&
      Date.now() - new Date(session.createdAt).getTime() > 5 * 60 * 1000
    ) {
      this.logger.warn(`Rejected connection [${client.id}]: session ${sessionId} has expired`);
      client.disconnect(true);
      return;
    }

    if (
      session.status !== SimulatorSessionStatus.PENDING &&
      session.status !== SimulatorSessionStatus.RUNNING
    ) {
      this.logger.warn(
        `Rejected connection [${client.id}]: session ${sessionId} status invalid (${session.status})`,
      );
      client.disconnect(true);
      return;
    }

    if (rawToken && typeof rawToken === 'string') {
      try {
        const payload: any = this.jwtService.verify(rawToken);
        if (payload.sub !== session.actorUserId) {
          this.logger.warn(
            `Rejected connection [${client.id}]: cross-actor mismatch (token user ${payload.sub} !== session actor ${session.actorUserId})`,
          );
          client.disconnect(true);
          return;
        }
      } catch (err: any) {
        this.logger.warn(
          `Rejected connection [${client.id}]: invalid JWT token provided with session (${err.message})`,
        );
        client.disconnect(true);
        return;
      }
    }

    const actorUser = await this.prisma.user.findUnique({
      where: { id: session.actorUserId },
    });

    if (!actorUser || actorUser.status !== 'ACTIVE') {
      this.logger.warn(
        `Rejected connection [${client.id}]: actor ${session.actorUserId} not found or inactive`,
      );
      client.disconnect(true);
      return;
    }

    if (!ALLOWED_SUBSCRIBERS.includes(actorUser.role as Role)) {
      this.logger.warn(
        `Rejected connection [${client.id}]: actor role ${actorUser.role} is not permitted in /simulator`,
      );
      client.disconnect(true);
      return;
    }

    if (session.type === SimulatorSessionType.WORKOUT && actorUser.role !== Role.HEAD_TRAINER) {
      this.logger.warn(
        `Rejected connection [${client.id}]: workout session requires HEAD_TRAINER, got ${actorUser.role}`,
      );
      client.disconnect(true);
      return;
    }

    if (session.type === SimulatorSessionType.EXAM && actorUser.role !== Role.VETERINARIAN) {
      this.logger.warn(
        `Rejected connection [${client.id}]: exam session requires VETERINARIAN, got ${actorUser.role}`,
      );
      client.disconnect(true);
      return;
    }

    const user: CurrentUserPayload = {
      userId: actorUser.id,
      email: actorUser.email,
      role: actorUser.role,
      fullName: actorUser.fullName,
    };

    client.data.user = user;
    client.data.session = session;
    this.logger.log(
      `Session client connected [${client.id}] sessionId=${sessionId} actor=${user.email} role=${user.role}`,
    );
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected [${client.id}]`);
    const sessionId: string | undefined = client.data?.session?.id;
    if (sessionId && !this.emittedFinished.has(sessionId)) {
      const activeSession = this.simulatorService.getActiveSession(sessionId);
      const isRunning =
        (activeSession && activeSession.status === SimulatorSessionStatus.RUNNING) ||
        client.data?.session?.status === SimulatorSessionStatus.RUNNING;
      if (isRunning && !this.disconnectTimers.has(sessionId)) {
        this.logger.warn(
          `Client disconnected for running session ${sessionId}; starting 15s disconnect grace timer`,
        );
        const timer = setTimeout(async () => {
          this.disconnectTimers.delete(sessionId);
          await this.abortDueToDisconnect(sessionId);
        }, 15000);
        timer.unref?.();
        this.disconnectTimers.set(sessionId, timer);
      }
    }
  }

  private async abortDueToDisconnect(sessionId: string): Promise<void> {
    try {
      const result = await this.simulatorService.abortSession(sessionId, 'DISCONNECT_TIMEOUT_15S');
      this.clearSessionTimers(sessionId);
      if (result?.transitioned && result?.session) {
        this.emittedFinished.add(sessionId);
        this.server.emit('sim:session_finished', {
          event: 'sim:session_finished',
          session_id: sessionId,
          type: result.session.type,
          status: 'ABORTED_INJURY',
          result: { reason: 'DISCONNECT_TIMEOUT_15S' },
        });
      }
    } catch (err: any) {
      this.logger.error(
        `Error aborting session ${sessionId} after disconnect timeout: ${err.message}`,
      );
    }
  }

  private async abortDueToSessionTimeout(sessionId: string): Promise<void> {
    try {
      const result = await this.simulatorService.abortSession(sessionId, 'SESSION_TIMEOUT_5M');
      this.clearSessionTimers(sessionId);
      if (result?.transitioned && result?.session) {
        this.emittedFinished.add(sessionId);
        this.server.emit('sim:session_finished', {
          event: 'sim:session_finished',
          session_id: sessionId,
          type: result.session.type,
          status: 'ABORTED_INJURY',
          result: { reason: 'SESSION_TIMEOUT_5M' },
        });
      }
    } catch (err: any) {
      this.logger.error(`Error aborting session ${sessionId} after 5m timeout: ${err.message}`);
    }
  }

  private async requirePublisherSession(
    client: Socket,
  ): Promise<{ user: CurrentUserPayload; session: any }> {
    await client.data?.authReady;
    const user: CurrentUserPayload | undefined = client.data?.user;
    const session: any = client.data?.session;
    if (!user || !session) {
      throw new Error('UNAUTHENTICATED');
    }
    if (!ALLOWED_PUBLISHERS.includes(user.role as Role)) {
      throw new Error('FORBIDDEN');
    }
    return { user, session };
  }

  private async requireExamPublisherSession(
    client: Socket,
  ): Promise<{ user: CurrentUserPayload; session: any }> {
    await client.data?.authReady;
    const user: CurrentUserPayload | undefined = client.data?.user;
    const session: any = client.data?.session;
    if (!user || !session) throw new Error('UNAUTHENTICATED');
    if (user.role !== Role.VETERINARIAN) {
      throw new Error('FORBIDDEN');
    }
    return { user, session };
  }

  private assertSessionPacketBinding(
    session: any,
    event: string,
    packetSessionId: string | null | undefined,
    horseIds: string[],
  ): void {
    if (!session || !session.id) {
      throw new Error('UNAUTHENTICATED');
    }

    // 1. Require packet.session_id === client.data.session.id
    if (!packetSessionId || packetSessionId !== session.id) {
      throw new Error('SESSION_MISMATCH');
    }

    // 2. Require every packet horse_id to belong to client.data.session.horseIds
    const sessionHorseIds: string[] = Array.isArray(session.horseIds) ? session.horseIds : [];
    const allowedHorses = new Set(sessionHorseIds);

    for (const hid of horseIds) {
      if (!hid || !allowedHorses.has(hid)) {
        throw new Error('HORSE_MISMATCH');
      }
    }

    // 3. Require the event to be compatible with the authenticated session type
    switch (event) {
      case 'sim:telemetry_tick':
      case 'sim:incident_report':
      case 'sim:session_finished':
        if (
          session.type !== SimulatorSessionType.WORKOUT &&
          session.type !== SimulatorSessionType.RACE
        ) {
          throw new Error('SESSION_TYPE_INCOMPATIBLE');
        }
        break;
      case 'sim:race_progress':
        if (session.type !== SimulatorSessionType.RACE) {
          throw new Error('SESSION_TYPE_INCOMPATIBLE');
        }
        break;
      case 'sim:exam_finished':
        if (session.type !== SimulatorSessionType.EXAM) {
          throw new Error('SESSION_TYPE_INCOMPATIBLE');
        }
        break;
      default:
        throw new Error('SESSION_TYPE_INCOMPATIBLE');
    }
  }

  @SubscribeMessage('sim:telemetry_tick')
  async handleTelemetryTick(
    @ConnectedSocket() client: Socket,
    @MessageBody() packet: TelemetryTickPacketDto,
  ): Promise<SimulatorAck> {
    try {
      const { user, session } = await this.requirePublisherSession(client);
      const validPacket = await validatePacket(TelemetryTickPacketDto, packet);
      this.assertSessionPacketBinding(session, 'sim:telemetry_tick', validPacket.session_id, [
        validPacket.horse.horse_id,
      ]);
      await this.simulatorService.recordTelemetry(validPacket, user);
      if (
        !this.sessionTimeouts.has(validPacket.session_id) &&
        !this.emittedFinished.has(validPacket.session_id)
      ) {
        const timeout = setTimeout(
          async () => {
            this.sessionTimeouts.delete(validPacket.session_id);
            await this.abortDueToSessionTimeout(validPacket.session_id);
          },
          5 * 60 * 1000,
        );
        timeout.unref?.();
        this.sessionTimeouts.set(validPacket.session_id, timeout);
      }
      this.server.emit('sim:telemetry_tick', validPacket);
      return { accepted: true };
    } catch (err: any) {
      return { accepted: false, code: err.message };
    }
  }

  @SubscribeMessage('sim:race_progress')
  async handleRaceProgress(
    @ConnectedSocket() client: Socket,
    @MessageBody() packet: RaceProgressPacketDto,
  ): Promise<SimulatorAck> {
    try {
      const { user, session } = await this.requirePublisherSession(client);
      const validPacket = await validatePacket(RaceProgressPacketDto, packet);
      const horseIds = Array.isArray(validPacket.positions)
        ? validPacket.positions.map((p) => p.horse_id)
        : [];
      this.assertSessionPacketBinding(
        session,
        'sim:race_progress',
        validPacket.session_id,
        horseIds,
      );
      await this.simulatorService.recordRaceProgress(validPacket, user);
      this.server.emit('sim:race_progress', validPacket);
      return { accepted: true };
    } catch (err: any) {
      return { accepted: false, code: err.message };
    }
  }

  @SubscribeMessage('sim:incident_report')
  async handleIncidentReport(
    @ConnectedSocket() client: Socket,
    @MessageBody() packet: IncidentReportPacketDto,
  ): Promise<SimulatorAck> {
    try {
      const { user, session } = await this.requirePublisherSession(client);
      const validPacket = await validatePacket(IncidentReportPacketDto, packet);
      this.assertSessionPacketBinding(session, 'sim:incident_report', validPacket.session_id, [
        validPacket.horse.horse_id,
      ]);
      const incident = await this.incidentsService.createFromSimulator(
        validPacket.packet_id,
        validPacket,
        user,
      );

      // Fan out persisted incident to all connected monitors
      this.server.emit('sim:incident_report', {
        ...validPacket,
        incident_id: incident.id,
        incident_number: incident.incidentNumber,
      });

      return { accepted: true, id: incident.id };
    } catch (err: any) {
      return { accepted: false, code: err.message };
    }
  }

  @SubscribeMessage('sim:session_finished')
  async handleSessionFinished(
    @ConnectedSocket() client: Socket,
    @MessageBody() packet: SessionFinishedPacketDto,
  ): Promise<SimulatorAck> {
    try {
      const { user, session } = await this.requirePublisherSession(client);
      const validPacket = await validatePacket(SessionFinishedPacketDto, packet);
      const horseIds: string[] = [];
      if (validPacket.horse?.horse_id) {
        horseIds.push(validPacket.horse.horse_id);
      }
      if (Array.isArray(validPacket.results)) {
        for (const r of validPacket.results) {
          if (r && r.horse_id) horseIds.push(r.horse_id);
        }
      }
      this.assertSessionPacketBinding(
        session,
        'sim:session_finished',
        validPacket.session_id,
        horseIds,
      );
      const finishResult = await this.simulatorService.recordFinished(validPacket, user);
      const resSession = finishResult.session;
      if (resSession) {
        this.clearSessionTimers(resSession.id);
      }

      if (finishResult.transitioned && resSession) {
        this.emittedFinished.add(resSession.id);
        this.server.emit('sim:session_finished', {
          ...validPacket,
          session_id: resSession.id,
          status: resSession.status,
        });
      }

      return { accepted: true, id: validPacket.session_id };
    } catch (err: any) {
      return { accepted: false, code: err.message };
    }
  }

  @SubscribeMessage('sim:exam_finished')
  async handleExamFinished(
    @ConnectedSocket() client: Socket,
    @MessageBody() packet: ExamFinishedPacketDto,
  ): Promise<SimulatorAck> {
    try {
      const { user, session } = await this.requireExamPublisherSession(client);
      const validPacket = await validatePacket(ExamFinishedPacketDto, packet);
      this.assertSessionPacketBinding(session, 'sim:exam_finished', validPacket.session_id, [
        validPacket.horse_id,
      ]);
      const resSession = await this.simulatorService.recordExamFinished(validPacket, user);
      this.server.emit('sim:exam_finished', validPacket);
      return { accepted: true, id: resSession.id };
    } catch (err: any) {
      return { accepted: false, code: err.message };
    }
  }
}
