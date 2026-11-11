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
import { Injectable, Logger, Optional } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { InventoryService } from './inventory.service';

export interface SupplyDeliveryStartPayload {
  requestId: string;
  requestNumber: string;
  zoneId: string;
  supplyId: string;
  supplyCode: string;
  supplyName: string;
  category: string;
  unit: string;
  approvedQuantity: number;
  dispatchedAt: string;
  animationEndsAt: string;
  fallbackAt: string;
  ackCapability: string;
}

export interface SupplyDeliveryCompletedPayload {
  requestId: string;
  zoneId: string;
  supplyId: string;
  status: 'DELIVERED';
  balance: number;
}

export function getAllowedSupplyOrigins(): string[] {
  const origins = new Set<string>();
  for (const raw of [process.env.FRONTEND_URL, process.env.SIMULATOR_URL]) {
    if (!raw) continue;
    for (const part of raw.split(',')) {
      const normalized = part.trim().replace(/\/+$/, '');
      if (normalized) origins.add(normalized);
    }
  }
  if (process.env.NODE_ENV !== 'production') {
    origins.add('http://localhost:5173');
    origins.add('http://127.0.0.1:5173');
    origins.add('http://localhost:5175');
    origins.add('http://127.0.0.1:5175');
  } else if (origins.size === 0) {
    origins.add('http://localhost:5173');
    origins.add('http://localhost:5175');
  }
  return Array.from(origins);
}

export function isAllowedSupplyOrigin(origin?: string): boolean {
  if (!origin) return true;
  const normalized = origin.trim().replace(/\/+$/, '');
  return getAllowedSupplyOrigins().includes(normalized);
}

@WebSocketGateway({
  namespace: '/supplies',
  cors: {
    origin: (
      requestOrigin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      if (isAllowedSupplyOrigin(requestOrigin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`Origin ${requestOrigin} not allowed by CORS`), false);
    },
    credentials: true,
  },
})
@Injectable()
export class SupplyDeliveryGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(SupplyDeliveryGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly inventoryService: InventoryService,
    @Optional() private readonly jwtService?: JwtService,
  ) {}

  afterInit() {
    this.logger.log('SupplyDeliveryGateway initialized on namespace /supplies');
    this.inventoryService.setGateway(this);
  }

  async handleConnection(client: Socket) {
    this.logger.log(`Supply socket connection attempt: ${client.id}`);

    const originHeader = client?.handshake?.headers?.origin;
    if (typeof originHeader === 'string' && !isAllowedSupplyOrigin(originHeader)) {
      this.logger.warn(
        `Rejected supply socket from disallowed origin [${originHeader}]: ${client.id}`,
      );
      client.disconnect(true);
      return;
    }

    const rawToken =
      client?.handshake?.auth?.token ||
      client?.handshake?.headers?.authorization?.replace(/^Bearer\s+/i, '');

    if (rawToken && this.jwtService) {
      try {
        const payload = await this.jwtService.verifyAsync(rawToken);
        client.data.user = payload;
      } catch (err: any) {
        this.logger.warn(`Supply socket JWT verify failed [${client.id}]: ${err.message}`);
        client.disconnect(true);
        return;
      }
    } else if (!rawToken && client?.data) {
      // Simulator Web chạy chế độ direct access (CR-024) không đăng nhập; thao tác ACK vẫn xác thực qua ackCapability.
      client.data.isDirectSimulator = true;
    }

    try {
      const activeDeliveries = await this.inventoryService.getActiveDeliveriesWithCapabilities();
      client.emit('sys:active_deliveries', activeDeliveries);
    } catch (err: any) {
      this.logger.error(`Error sending active deliveries on connect: ${err?.message}`);
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Supply socket disconnected: ${client.id}`);
  }

  broadcastDeliveryStart(payload: SupplyDeliveryStartPayload) {
    this.logger.log(
      `Broadcasting sys:supply_delivery_start for request ${payload.requestId} (${payload.supplyCode} x ${payload.approvedQuantity})`,
    );
    this.server?.emit('sys:supply_delivery_start', payload);
  }

  broadcastDeliveryCompleted(payload: SupplyDeliveryCompletedPayload) {
    this.logger.log(
      `Broadcasting sys:supply_delivery_completed for request ${payload.requestId} (balance: ${payload.balance})`,
    );
    this.server?.emit('sys:supply_delivery_completed', payload);
  }

  @SubscribeMessage('sim:supply_delivery_ack')
  async handleAck(
    @ConnectedSocket() _client: Socket,
    @MessageBody() data: { requestId: string; ackCapability: string },
  ) {
    if (!data?.requestId || !data?.ackCapability) {
      return { success: false, error: 'INVALID_PAYLOAD' };
    }
    return this.inventoryService.handleSimulatorAck(data.requestId, data.ackCapability);
  }
}
