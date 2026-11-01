import { Body, Controller, Get, HttpCode, Post, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import type { Response } from 'express';
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums/role.enum';
import { AiService } from './ai.service';
import { toolsFor } from './ai.tools';
import { KnowledgeService } from './knowledge.service';

export class AssistantChatDto {
  @ApiProperty({ maxLength: 1000 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  message!: string;
}

const MCP_PROTOCOL_VERSION = '2025-06-18';

@ApiTags('AI Assistant')
@ApiBearerAuth('JWT-auth')
@Controller('ai')
export class AiController {
  constructor(
    private readonly ai: AiService,
    private readonly knowledge: KnowledgeService,
  ) {}

  @Post('assistant/chat')
  @HttpCode(200)
  @ApiOperation({ summary: 'Hỏi trợ lý (RAG trên đặc tả + dữ liệu trong phạm vi quyền, chỉ đọc)' })
  chat(@Body() dto: AssistantChatDto, @CurrentUser() user: CurrentUserPayload) {
    return this.ai.chat(dto.message, user);
  }

  @Get('assistant/quota')
  @ApiOperation({ summary: 'Số lượt hỏi đã dùng hôm nay' })
  quota(@CurrentUser() user: CurrentUserPayload) {
    return this.ai.quota(user.userId);
  }

  @Get('traces')
  @Roles(UserRole.CLUB_MANAGER)
  @ApiOperation({
    summary: 'Trace gần nhất của trợ lý: công cụ đã gọi, thời gian, cache, trạng thái',
  })
  traces() {
    return this.ai.recentTraces();
  }

  /**
   * MCP qua Streamable HTTP (JSON-RPC 2.0, chỉ trả JSON, không SSE). Cùng JWT/RBAC với REST,
   * nên client MCP chỉ thấy dữ liệu trong phạm vi của tài khoản đã đăng nhập.
   */
  @Post('mcp')
  @ApiOperation({
    summary: 'Máy chủ MCP: initialize, tools/list, tools/call, resources/list, resources/read',
  })
  async mcp(@Body() body: unknown, @CurrentUser() user: CurrentUserPayload, @Res() res: Response) {
    const msg = (body ?? {}) as {
      jsonrpc?: string;
      id?: string | number | null;
      method?: string;
      params?: any;
    };
    const reply = (payload: Record<string, unknown>) =>
      res.status(200).json({ jsonrpc: '2.0', id: msg.id ?? null, ...payload });
    const fail = (code: number, message: string) => reply({ error: { code, message } });

    if (msg.jsonrpc !== '2.0' || typeof msg.method !== 'string')
      return fail(-32600, 'Invalid Request');
    if (msg.id === undefined) return res.status(202).end(); // notification, vd notifications/initialized

    switch (msg.method) {
      case 'initialize':
        return reply({
          result: {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: {
              tools: { listChanged: false },
              resources: { listChanged: false, subscribe: false },
            },
            serverInfo: { name: 'tmec-assistant', version: '2.0.0' },
            instructions:
              'Read-only TMEC tools and role guides. Tools and resources are scoped to the authenticated user role.',
          },
        });
      case 'ping':
        return reply({ result: {} });
      case 'tools/list':
        return reply({
          result: {
            tools: toolsFor(user.role).map(({ name, description, inputSchema }) => ({
              name,
              description,
              inputSchema,
            })),
          },
        });
      case 'resources/list':
        return reply({ result: { resources: this.knowledge.listDocs(user.role) } });
      case 'resources/read': {
        const uri = msg.params?.uri;
        const text = typeof uri === 'string' ? this.knowledge.readDoc(uri, user.role) : null;
        if (text === null) return fail(-32002, `Resource not found: ${String(uri)}`);
        return reply({ result: { contents: [{ uri, mimeType: 'text/markdown', text }] } });
      }
      case 'tools/call': {
        const name = msg.params?.name;
        const args = msg.params?.arguments ?? {};
        if (typeof name !== 'string' || typeof args !== 'object' || Array.isArray(args)) {
          return fail(-32602, 'Invalid params');
        }
        if (!toolsFor(user.role).some((t) => t.name === name))
          return fail(-32602, `Unknown tool: ${name}`);
        const out = await this.ai.mcpCall(name, args, user);
        return reply({
          result: {
            content: [
              {
                type: 'text',
                text: out.ok ? JSON.stringify(out.result) : (out.error ?? 'Tool failed'),
              },
            ],
            ...(out.ok
              ? {
                  structuredContent: Array.isArray(out.result)
                    ? { items: out.result }
                    : (out.result as Record<string, unknown>),
                }
              : {}),
            isError: !out.ok,
          },
        });
      }
      default:
        return fail(-32601, `Method not found: ${msg.method}`);
    }
  }
}
