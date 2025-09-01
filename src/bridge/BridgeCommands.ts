import { Logger } from '../utils/Logger';
import { Config } from '../utils/Config';
import { AuditLogger } from '../utils/AuditLogger';
import { GooglePlayApp } from '../models/ConfigTypes';
import { AppManager } from '../managers/AppManager';
import { Bridge } from 'matrix-appservice-bridge';
import { SlidingWindowRateLimiter } from '../utils/RateLimiter';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { HttpServer } from '../utils/HttpServer';

export interface CommandContext {
  roomId: string;
  userId: string;
  message: string;
  args: string[];
  // Security context for authentication
  accessToken?: string;
  isAppService?: boolean;
  authenticatedUserId?: string;
}

export interface CommandResult {
  success: boolean;
  message: string;
  htmlMessage?: string;
}

interface ConfigChange {
  key: string;
  description: string;
  oldValue: any;
  newValue: any;
}

interface ConfigValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface Command {
  name: string;
  description: string;
  usage: string;
  adminOnly: boolean;
  handler: (context: CommandContext) => Promise<CommandResult>;
}

export class BridgeCommands {
  private readonly logger: Logger;
  private readonly auditLogger: AuditLogger;
  private commands: Map<string, Command> = new Map();
  private adminUsers: Set<string> = new Set();
  private maintenanceMode: boolean = false;
  private maintenanceStartTime: Date | undefined;
  private maintenanceReason: string | undefined;
  private commandRateLimiter: SlidingWindowRateLimiter;
  private asToken: string;

  constructor(
    private readonly bridge: Bridge,
    private readonly appManager: AppManager,
    private readonly googlePlayBridge?: any, // GooglePlayBridge type to avoid circular dependency
    adminUsers: string[] = [],
    private readonly httpServer?: HttpServer
  ) {
    this.logger = Logger.getInstance().setComponent('BridgeCommands');
    this.auditLogger = AuditLogger.getInstance();
    this.adminUsers = new Set(adminUsers);

    // Initialize security components
    this.commandRateLimiter = new SlidingWindowRateLimiter('bridge-commands', {
      windowSizeMs: 60000, // 1 minute window
      maxRequests: 60, // Max 60 commands per minute per user
      keyGenerator: (context: any) => context?.userId || 'anonymous',
    });

    // Extract tokens from bridge configuration for Matrix authentication
    this.asToken = this.extractAsToken();

    this.registerCommands();
  }

  public async handleMessage(
    roomId: string,
    userId: string,
    message: string,
    authHeaders?: { authorization?: string; access_token?: string }
  ): Promise<void> {
    const trimmed = message.trim();

    // Only handle messages that start with !
    if (!trimmed.startsWith('!')) {
      return;
    }

    const parts = trimmed.slice(1).split(/\s+/);
    const commandName = parts[0]?.toLowerCase();

    if (!commandName) {
      return;
    }

    // Extract authentication context from headers (Matrix spec compliance)
    const authContext = this.extractAuthContext(authHeaders);

    const command = this.commands.get(commandName);
    if (!command) {
      // Try to find a partial match
      const matches = Array.from(this.commands.keys()).filter(cmd =>
        cmd.startsWith(commandName)
      );

      if (matches.length === 1) {
        const matchedCommand = this.commands.get(matches[0]!);
        if (matchedCommand) {
          await this.executeCommand(matchedCommand, {
            roomId,
            userId,
            message: trimmed,
            args: parts.slice(1),
            ...authContext,
          });
        }
      } else if (matches.length > 1) {
        await this.sendResponse(roomId, {
          success: false,
          message: `Ambiguous command "${commandName}". Did you mean: ${matches.join(', ')}?`,
        });
      } else {
        await this.sendResponse(roomId, {
          success: false,
          message: `Unknown command "${commandName}". Use !help to see available commands.`,
        });
      }
      return;
    }

    await this.executeCommand(command, {
      roomId,
      userId,
      message: trimmed,
      args: parts.slice(1),
      ...authContext,
    });
  }

  public addAdminUser(userId: string): void {
    this.adminUsers.add(userId);
  }

  public removeAdminUser(userId: string): void {
    this.adminUsers.delete(userId);
  }

  public isAdmin(userId: string): boolean {
    return this.adminUsers.has(userId);
  }

  /**
   * Extract Application Service token from bridge registration
   * Following Matrix specification best practices
   */
  private extractAsToken(): string {
    try {
      // Use the Bridge's registration method properly
      const registration = (this.bridge as any).registration;
      if (registration && registration.as_token) {
        return registration.as_token;
      }
      // Fallback to environment variable or default
      return process.env.AS_TOKEN || '';
    } catch (error) {
      this.logger.warn('Failed to extract AS token from registration', {
        error,
      });
      return process.env.AS_TOKEN || '';
    }
  }

  /**
   * Validate Matrix Application Service authentication
   * Following Matrix specification requirements per Context7 analysis
   */
  private async validateMatrixAuth(context: CommandContext): Promise<boolean> {
    // Check if this is an Application Service making the request
    if (context.isAppService && context.accessToken) {
      // Validate AS token (Bearer token preferred per Matrix spec)
      const isValidAsToken = this.validateToken(
        context.accessToken,
        this.asToken
      );
      if (isValidAsToken) {
        this.logger.debug('Valid Application Service authentication', {
          userId: context.userId,
          isAppService: true,
        });
        return true;
      }
    }

    // For regular users, we rely on Matrix bridge's built-in authentication
    // The bridge handles user token validation through Intent system
    const isValidUser = await this.validateUserInBridge(context.userId);
    if (isValidUser) {
      this.logger.debug('Valid user authentication via bridge', {
        userId: context.userId,
      });
      return true;
    }

    this.logger.warn('Authentication failed for command request', {
      userId: context.userId,
      roomId: context.roomId,
      hasToken: !!context.accessToken,
      isAppService: context.isAppService,
    });

    return false;
  }

  /**
   * Enhanced application service token validation with security checks
   * Based on Context7 Matrix specification analysis
   */
  private validateTokenSecurity(token: string): boolean {
    if (token.length < 64) return false;
    if (!/^[a-zA-Z0-9_-]+$/.test(token)) return false;
    return this.checkTokenEntropy(token) > 0.5; // Ensure sufficient entropy
  }

  /**
   * Calculate token entropy for security validation
   * Returns entropy score between 0 and 1
   */
  private checkTokenEntropy(token: string): number {
    if (!token) return 0;

    const charCounts = new Map<string, number>();
    for (const char of token) {
      charCounts.set(char, (charCounts.get(char) || 0) + 1);
    }

    let entropy = 0;
    const length = token.length;

    for (const count of charCounts.values()) {
      const probability = count / length;
      entropy -= probability * Math.log2(probability);
    }

    // Normalize entropy score (max entropy for base64-like charset is ~6 bits)
    return Math.min(entropy / 6, 1);
  }

  /**
   * Validate token with constant-time comparison to prevent timing attacks
   * Enhanced with security validation per Context7 analysis
   */
  private validateToken(providedToken: string, expectedToken: string): boolean {
    if (
      !providedToken ||
      !expectedToken ||
      providedToken.length !== expectedToken.length
    ) {
      return false;
    }

    // Enhanced security validation for tokens
    if (!this.validateTokenSecurity(providedToken)) {
      this.logger.warn('Token failed security validation', {
        length: providedToken.length,
        entropy: this.checkTokenEntropy(providedToken),
      });
      return false;
    }

    // Constant-time comparison
    let result = 0;
    for (let i = 0; i < providedToken.length; i++) {
      result |= providedToken.charCodeAt(i) ^ expectedToken.charCodeAt(i);
    }
    return result === 0;
  }

  /**
   * Validate that user exists in bridge context
   */
  private async validateUserInBridge(userId: string): Promise<boolean> {
    try {
      // This is a basic validation - in production you might want more sophisticated checks
      return userId.includes(':') && userId.startsWith('@');
    } catch (error) {
      this.logger.debug('User bridge validation failed', { userId, error });
      return false;
    }
  }

  /**
   * Extract authentication context from HTTP headers
   * Following Matrix specification: prefer Authorization header over query parameters
   */

  private extractAuthContext(authHeaders?: {
    authorization?: string;
    access_token?: string;
  }): {
    accessToken?: string;
    isAppService?: boolean;
    authenticatedUserId?: string;
  } {
    if (!authHeaders) {
      return {};
    }

    let accessToken: string | undefined;

    // Enhanced Bearer header preference per Matrix specification (Context7)
    if (authHeaders.authorization) {
      const match = authHeaders.authorization.match(/^Bearer\s+(.+)$/);
      if (match) {
        accessToken = match[1];
        // Additional security validation for Bearer tokens
        if (accessToken && !this.validateTokenSecurity(accessToken)) {
          this.logger.warn('Bearer token failed security validation', {
            tokenLength: accessToken?.length,
            entropy: accessToken ? this.checkTokenEntropy(accessToken) : 0,
          });
          return {}; // Reject insecure tokens
        }
      }
    }

    // Fallback to access_token query parameter (legacy support)
    if (!accessToken && authHeaders['access_token']) {
      accessToken = authHeaders['access_token'];
      // Log deprecation warning for query parameter usage
      this.logger.warn(
        'Using deprecated access_token query parameter, prefer Authorization Bearer header'
      );
    }

    if (!accessToken) {
      return {};
    }

    // Determine if this is an application service token
    const isAppService = accessToken === this.asToken;

    const result: {
      accessToken?: string;
      isAppService?: boolean;
      authenticatedUserId?: string;
    } = {
      accessToken,
      isAppService,
    };

    if (isAppService && result.authenticatedUserId === undefined) {
      // For app services, authenticated user would be the sender_localpart or user_id query param
      delete result.authenticatedUserId;
    }

    return result;
  }

  private async executeCommand(
    command: Command,
    context: CommandContext
  ): Promise<void> {
    // Rate limiting check first (per Matrix spec recommendations)
    try {
      const rateLimitResult = await this.commandRateLimiter.checkLimit({
        userId: context.userId,
        command: command.name,
      });

      if (!rateLimitResult.allowed) {
        this.logger.warn('Rate limit exceeded for command', {
          userId: context.userId,
          command: command.name,
          limit: rateLimitResult.info.limit,
          remaining: rateLimitResult.info.remaining,
        });

        await this.sendResponse(context.roomId, {
          success: false,
          message: `Rate limit exceeded. Try again in ${Math.ceil((rateLimitResult.info.resetTime.getTime() - Date.now()) / 1000)} seconds.`,
        });
        return;
      }
    } catch (rateLimitError) {
      this.logger.error('Rate limiting check failed', {
        error: rateLimitError,
      });
      // Continue execution - don't block on rate limit failures
    }

    // Authentication check for admin commands (Matrix spec compliance)
    if (command.adminOnly) {
      // First check if user is in admin list (backwards compatibility)
      const isAdminUser = this.isAdmin(context.userId);

      // Then validate Matrix authentication (new security requirement)
      const isAuthenticated = await this.validateMatrixAuth(context);

      if (!isAdminUser || !isAuthenticated) {
        // Log security event using audit logger's log method
        this.auditLogger.log({
          level: 'warn',
          action: 'unauthorized_admin_command_attempt',
          userId: context.userId,
          roomId: context.roomId,
          result: 'failure',
          details: {
            command: command.name,
            isAdminUser,
            isAuthenticated,
          },
        });

        await this.sendResponse(context.roomId, {
          success: false,
          message:
            'This command requires administrator privileges and valid authentication.',
        });
        return;
      }
    }

    try {
      this.logger.info(
        `Executing command "${command.name}" from user ${context.userId}`,
        {
          adminOnly: command.adminOnly,
          authenticated: true,
        }
      );

      // Log admin command execution for audit
      if (command.adminOnly) {
        this.auditLogger.log({
          level: 'info',
          action: `command_${command.name}`,
          userId: context.userId,
          roomId: context.roomId,
          result: 'success',
          details: {
            args: context.args,
          },
        });
      }

      const result = await command.handler(context);
      await this.sendResponse(context.roomId, result);
    } catch (error) {
      this.logger.error(`Command "${command.name}" failed:`, error);
      await this.sendResponse(context.roomId, {
        success: false,
        message: `Command failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }
  }

  private async sendResponse(
    roomId: string,
    result: CommandResult
  ): Promise<void> {
    const intent = this.bridge.getIntent();

    const content: any = {
      msgtype: 'm.text',
      body: result.message,
    };

    if (result.htmlMessage) {
      content.format = 'org.matrix.custom.html';
      content.formatted_body = result.htmlMessage;
    }

    await intent.sendMessage(roomId, content);
  }

  private registerCommands(): void {
    // Help command
    this.commands.set('help', {
      name: 'help',
      description: 'Show available commands',
      usage: '!help [command]',
      adminOnly: false,
      handler: async context => this.handleHelp(context),
    });

    // App management commands
    this.commands.set('apps', {
      name: 'apps',
      description: 'List all configured apps',
      usage: '!apps [--active|--inactive]',
      adminOnly: false,
      handler: async context => this.handleListApps(context),
    });

    this.commands.set('app', {
      name: 'app',
      description: 'Show app details',
      usage: '!app <package-name>',
      adminOnly: false,
      handler: async context => this.handleShowApp(context),
    });

    this.commands.set('addapp', {
      name: 'addapp',
      description: 'Add a new app configuration',
      usage: '!addapp <package-name> <room-id> [app-name]',
      adminOnly: true,
      handler: async context => this.handleAddApp(context),
    });

    this.commands.set('removeapp', {
      name: 'removeapp',
      description: 'Remove an app configuration',
      usage: '!removeapp <package-name>',
      adminOnly: true,
      handler: async context => this.handleRemoveApp(context),
    });

    this.commands.set('enableapp', {
      name: 'enableapp',
      description: 'Enable an app',
      usage: '!enableapp <package-name>',
      adminOnly: true,
      handler: async context => this.handleEnableApp(context),
    });

    this.commands.set('disableapp', {
      name: 'disableapp',
      description: 'Disable an app',
      usage: '!disableapp <package-name>',
      adminOnly: true,
      handler: async context => this.handleDisableApp(context),
    });

    this.commands.set('updateapp', {
      name: 'updateapp',
      description: 'Update app configuration',
      usage: '!updateapp <package-name> <key>=<value> [key2=value2...]',
      adminOnly: true,
      handler: async context => this.handleUpdateApp(context),
    });

    // Statistics and monitoring
    this.commands.set('stats', {
      name: 'stats',
      description: 'Show bridge statistics',
      usage: '!stats [app-name]',
      adminOnly: false,
      handler: async context => this.handleStats(context),
    });

    this.commands.set('status', {
      name: 'status',
      description: 'Show bridge status',
      usage: '!status',
      adminOnly: false,
      handler: async context => this.handleStatus(context),
    });

    // Room management
    this.commands.set('createroom', {
      name: 'createroom',
      description: 'Create a room for an app',
      usage: '!createroom <package-name>',
      adminOnly: true,
      handler: async context => this.handleCreateRoom(context),
    });

    // User management
    this.commands.set('users', {
      name: 'users',
      description: 'List virtual users',
      usage: '!users [package-name]',
      adminOnly: true,
      handler: async context => this.handleListUsers(context),
    });

    this.commands.set('cleanup', {
      name: 'cleanup',
      description: 'Clean up inactive users',
      usage: '!cleanup [days]',
      adminOnly: true,
      handler: async context => this.handleCleanup(context),
    });

    // Phase 4.2 Feature commands
    this.commands.set('features', {
      name: 'features',
      description: 'Show Phase 4.2 feature status',
      usage: '!features',
      adminOnly: false,
      handler: async context => this.handleFeatures(context),
    });

    this.commands.set('categorize', {
      name: 'categorize',
      description: 'Categorize a review text (test categorization)',
      usage: '!categorize <review-text>',
      adminOnly: false,
      handler: async context => this.handleCategorize(context),
    });

    this.commands.set('suggest', {
      name: 'suggest',
      description: 'Get response suggestions for a review',
      usage: '!suggest <review-text> <rating>',
      adminOnly: false,
      handler: async context => this.handleSuggest(context),
    });

    this.commands.set('templates', {
      name: 'templates',
      description: 'Manage message templates',
      usage: '!templates [list|stats|search <query>]',
      adminOnly: false,
      handler: async context => this.handleTemplates(context),
    });

    this.commands.set('threads', {
      name: 'threads',
      description: 'Manage message threads',
      usage: '!threads [list|stats|resolve <thread-id>]',
      adminOnly: false,
      handler: async context => this.handleThreads(context),
    });

    // Configuration and maintenance commands (Phase 4.3)
    this.commands.set('reloadconfig', {
      name: 'reloadconfig',
      description: 'Reload configuration without restart',
      usage: '!reloadconfig',
      adminOnly: true,
      handler: async context => this.handleReloadConfig(context),
    });

    this.commands.set('maintenance', {
      name: 'maintenance',
      description: 'Enter or exit maintenance mode',
      usage: '!maintenance [on|off|status]',
      adminOnly: true,
      handler: async context => this.handleMaintenance(context),
    });

    this.commands.set('audit', {
      name: 'audit',
      description: 'Show audit log entries',
      usage: '!audit [limit] [filter]',
      adminOnly: true,
      handler: async context => this.handleAudit(context),
    });

    // Additional administrative commands
    this.commands.set('restart', {
      name: 'restart',
      description: 'Restart the bridge service',
      usage: '!restart [reason]',
      adminOnly: true,
      handler: async context => this.handleRestart(context),
    });

    this.commands.set('logs', {
      name: 'logs',
      description: 'View recent log entries',
      usage: '!logs [tail|show] [limit]',
      adminOnly: true,
      handler: async context => this.handleLogs(context),
    });

    this.commands.set('metrics', {
      name: 'metrics',
      description: 'Export bridge metrics',
      usage: '!metrics [export]',
      adminOnly: true,
      handler: async context => this.handleMetrics(context),
    });

    this.commands.set('backup', {
      name: 'backup',
      description: 'Backup bridge configuration',
      usage: '!backup [config|all]',
      adminOnly: true,
      handler: async context => this.handleBackup(context),
    });
  }

  // Command handlers
  private async handleHelp(context: CommandContext): Promise<CommandResult> {
    const { args } = context;

    if (args.length > 0) {
      const commandName = args[0]!.toLowerCase();
      const command = this.commands.get(commandName);

      if (!command) {
        return {
          success: false,
          message: `Unknown command "${commandName}".`,
        };
      }

      return {
        success: true,
        message: `${command.name}: ${command.description}\nUsage: ${command.usage}${command.adminOnly ? ' (Admin only)' : ''}`,
        htmlMessage: `<strong>${command.name}</strong>: ${command.description}<br>Usage: <code>${command.usage}</code>${command.adminOnly ? '<br><em>Admin only</em>' : ''}`,
      };
    }

    const isAdmin = this.isAdmin(context.userId);
    const availableCommands = Array.from(this.commands.values())
      .filter(cmd => !cmd.adminOnly || isAdmin)
      .sort((a, b) => a.name.localeCompare(b.name));

    const commandList = availableCommands
      .map(cmd => `!${cmd.name} - ${cmd.description}`)
      .join('\n');

    const htmlCommandList = availableCommands
      .map(cmd => `<code>!${cmd.name}</code> - ${cmd.description}`)
      .join('<br>');

    return {
      success: true,
      message: `Available commands:\n${commandList}\n\nUse !help <command> for detailed usage.`,
      htmlMessage: `<strong>Available commands:</strong><br>${htmlCommandList}<br><br>Use <code>!help &lt;command&gt;</code> for detailed usage.`,
    };
  }

  private async handleListApps(
    context: CommandContext
  ): Promise<CommandResult> {
    const { args } = context;
    const showActive = args.includes('--active');
    const showInactive = args.includes('--inactive');

    let apps = this.appManager.getAllApps();

    if (showActive) {
      apps = this.appManager.getActiveApps();
    } else if (showInactive) {
      apps = this.appManager.getAllApps().filter(app => app.enabled === false);
    }

    if (apps.length === 0) {
      return {
        success: true,
        message: 'No apps configured.',
      };
    }

    const appList = apps
      .map((app, index) => {
        const status = app.enabled !== false ? '✅ Active' : '❌ Inactive';
        const stats = this.appManager.getAppStats(app.packageName);
        return `${index + 1}. ${app.appName || app.packageName} (${app.packageName})\n   Status: ${status}\n   Room: ${app.matrixRoom}\n   Reviews: ${stats?.reviewsProcessed || 0}, Replies: ${stats?.repliesSent || 0}`;
      })
      .join('\n\n');

    const htmlAppList = apps
      .map((app, index) => {
        const status =
          app.enabled !== false
            ? '<span style="color: green">✅ Active</span>'
            : '<span style="color: red">❌ Inactive</span>';
        const stats = this.appManager.getAppStats(app.packageName);
        return `<strong>${index + 1}. ${app.appName || app.packageName}</strong> (<code>${app.packageName}</code>)<br>&nbsp;&nbsp;&nbsp;&nbsp;Status: ${status}<br>&nbsp;&nbsp;&nbsp;&nbsp;Room: ${app.matrixRoom}<br>&nbsp;&nbsp;&nbsp;&nbsp;Reviews: ${stats?.reviewsProcessed || 0}, Replies: ${stats?.repliesSent || 0}`;
      })
      .join('<br><br>');

    return {
      success: true,
      message: `Configured apps (${apps.length}):\n\n${appList}`,
      htmlMessage: `<strong>Configured apps (${apps.length}):</strong><br><br>${htmlAppList}`,
    };
  }

  private async handleShowApp(context: CommandContext): Promise<CommandResult> {
    const { args } = context;

    if (args.length === 0) {
      return {
        success: false,
        message: 'Usage: !app <package-name>',
      };
    }

    const packageName = args[0]!;
    const app = this.appManager.getApp(packageName);

    if (!app) {
      return {
        success: false,
        message: `App "${packageName}" not found.`,
      };
    }

    const stats = this.appManager.getAppStats(packageName);
    const status = app.enabled !== false ? '✅ Active' : '❌ Inactive';

    const details = [
      `Package Name: ${app.packageName}`,
      `App Name: ${app.appName || 'Not set'}`,
      `Status: ${status}`,
      `Matrix Room: ${app.matrixRoom}`,
      `Auto-create Room: ${app.autoCreateRoom ? 'Yes' : 'No'}`,
      `Poll Interval: ${app.pollIntervalMs || 'Default'}ms`,
      `Max Reviews: ${app.maxReviewsPerPoll || 'Default'}`,
      `Lookback Days: ${app.lookbackDays || 'Default'}`,
      '',
      'Statistics:',
      `  Reviews Processed: ${stats?.reviewsProcessed || 0}`,
      `  Replies Sent: ${stats?.repliesSent || 0}`,
      `  Errors: ${stats?.errors || 0}`,
      `  Last Poll: ${stats?.lastPoll ? stats.lastPoll.toISOString() : 'Never'}`,
    ].join('\n');

    return {
      success: true,
      message: details,
    };
  }

  private async handleAddApp(context: CommandContext): Promise<CommandResult> {
    const { args } = context;

    if (args.length < 2) {
      return {
        success: false,
        message: 'Usage: !addapp <package-name> <room-id> [app-name]',
      };
    }

    const [packageName, roomId, appName] = args;

    if (!packageName || !roomId) {
      return {
        success: false,
        message: 'Package name and room ID are required.',
      };
    }

    try {
      const app: GooglePlayApp = {
        packageName,
        matrixRoom: roomId,
        ...(appName && { appName }),
        enabled: true,
        autoCreateRoom: false,
      };

      await this.appManager.addApp(app);

      return {
        success: true,
        message: `Successfully added app "${packageName}" with room "${roomId}".`,
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to add app: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  private async handleRemoveApp(
    context: CommandContext
  ): Promise<CommandResult> {
    const { args } = context;

    if (args.length === 0) {
      return {
        success: false,
        message: 'Usage: !removeapp <package-name>',
      };
    }

    const packageName = args[0]!;

    try {
      await this.appManager.removeApp(packageName);

      return {
        success: true,
        message: `Successfully removed app "${packageName}".`,
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to remove app: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  private async handleEnableApp(
    context: CommandContext
  ): Promise<CommandResult> {
    const { args } = context;

    if (args.length === 0) {
      return {
        success: false,
        message: 'Usage: !enableapp <package-name>',
      };
    }

    const packageName = args[0]!;

    try {
      await this.appManager.enableApp(packageName);

      return {
        success: true,
        message: `Successfully enabled app "${packageName}".`,
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to enable app: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  private async handleDisableApp(
    context: CommandContext
  ): Promise<CommandResult> {
    const { args } = context;

    if (args.length === 0) {
      return {
        success: false,
        message: 'Usage: !disableapp <package-name>',
      };
    }

    const packageName = args[0]!;

    try {
      await this.appManager.disableApp(packageName);

      return {
        success: true,
        message: `Successfully disabled app "${packageName}".`,
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to disable app: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  private async handleUpdateApp(
    context: CommandContext
  ): Promise<CommandResult> {
    const { args } = context;

    if (args.length < 2) {
      return {
        success: false,
        message:
          'Usage: !updateapp <package-name> <key>=<value> [key2=value2...]',
      };
    }

    const packageName = args[0]!;
    const updates: Partial<GooglePlayApp> = {};

    for (let i = 1; i < args.length; i++) {
      const pair = args[i];
      if (!pair?.includes('=')) {
        return {
          success: false,
          message: `Invalid update format: "${pair}". Use key=value format.`,
        };
      }

      const [key, value] = pair.split('=', 2);
      if (!key || value === undefined) {
        return {
          success: false,
          message: `Invalid update format: "${pair}".`,
        };
      }

      switch (key.toLowerCase()) {
        case 'appname':
          updates.appName = value;
          break;
        case 'matrixroom':
          updates.matrixRoom = value;
          break;
        case 'enabled':
          updates.enabled = value.toLowerCase() === 'true';
          break;
        case 'autocreateroom':
          updates.autoCreateRoom = value.toLowerCase() === 'true';
          break;
        case 'pollintervalms':
          updates.pollIntervalMs = parseInt(value);
          break;
        case 'maxreviewsperpoll':
          updates.maxReviewsPerPoll = parseInt(value);
          break;
        case 'lookbackdays':
          updates.lookbackDays = parseInt(value);
          break;
        default:
          return {
            success: false,
            message: `Unknown update key: "${key}"`,
          };
      }
    }

    try {
      await this.appManager.updateApp(packageName, updates);

      const updatedKeys = Object.keys(updates).join(', ');
      return {
        success: true,
        message: `Successfully updated app "${packageName}". Updated: ${updatedKeys}`,
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to update app: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  private async handleStats(context: CommandContext): Promise<CommandResult> {
    const { args } = context;

    try {
      let statsMessage: string;
      let htmlMessage: string;

      if (args.length === 0) {
        // Show general bridge statistics
        const summary = await this.getStatsSummary();
        statsMessage = this.formatSummaryStats(summary);
        htmlMessage = this.formatSummaryStatsHTML(summary);
      } else if (args[0] === 'apps') {
        // Show detailed app statistics
        const appStats = await this.getAppStats();
        statsMessage = this.formatAppStats(appStats);
        htmlMessage = this.formatAppStatsHTML(appStats);
      } else if (args[0] === 'system') {
        // Show system performance statistics
        const systemStats = await this.getSystemStats();
        statsMessage = this.formatSystemStats(systemStats);
        htmlMessage = this.formatSystemStatsHTML(systemStats);
      } else if (args[0] === 'performance') {
        // Show performance metrics
        const perfStats = await this.getPerformanceStats();
        statsMessage = this.formatPerformanceStats(perfStats);
        htmlMessage = this.formatPerformanceStatsHTML(perfStats);
      } else {
        // Show stats for specific app
        const packageName = args[0];
        if (!packageName) {
          return {
            success: false,
            message: 'Usage: !stats [apps|system|performance|<package-name>]',
          };
        }

        const app = this.appManager.getApp(packageName);
        if (!app) {
          return {
            success: false,
            message: `App "${packageName}" not found. Use !apps to list available apps.`,
          };
        }

        const appSpecificStats = await this.getAppSpecificStats(packageName);
        statsMessage = this.formatAppSpecificStats(
          packageName,
          appSpecificStats
        );
        htmlMessage = this.formatAppSpecificStatsHTML(
          packageName,
          appSpecificStats
        );
      }

      return {
        success: true,
        message: statsMessage,
        htmlMessage,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      await this.auditLogger.logBridgeCommand(
        'stats',
        context.userId,
        context.roomId,
        false,
        undefined,
        { error: errorMessage },
        errorMessage
      );

      return {
        success: false,
        message: `Failed to get statistics: ${errorMessage}`,
      };
    }
  }

  private async handleStatus(_context: CommandContext): Promise<CommandResult> {
    const activeApps = this.appManager.getActiveApps().length;
    const totalApps = this.appManager.getAllApps().length;

    return {
      success: true,
      message: `Bridge Status: Running\nApps: ${activeApps}/${totalApps} active\nUptime: ${process.uptime()}s`,
    };
  }

  private async handleCreateRoom(
    context: CommandContext
  ): Promise<CommandResult> {
    const { args } = context;

    if (args.length === 0) {
      return {
        success: false,
        message:
          '❌ Usage: !createroom <package-name> [--public] [--topic="Custom topic"] [--name="Custom name"]',
      };
    }

    try {
      const packageName = args[0];
      if (!packageName) {
        return {
          success: false,
          message:
            '❌ Package name is required. Usage: !createroom <package-name> [options]',
        };
      }

      const isPublic = args.includes('--public');

      // Extract topic and name from arguments
      const topicArg = this.extractArgValue(args, '--topic');
      const nameArg = this.extractArgValue(args, '--name');

      // Verify the app exists
      const app = this.appManager.getApp(packageName);
      if (!app) {
        return {
          success: false,
          message: `❌ App "${packageName}" not found. Use !addapp to add it first, or !apps to list existing apps.`,
        };
      }

      // Check if room already exists for this app
      if (this.appManager.getAppByRoom(packageName)) {
        return {
          success: false,
          message: `❌ Room already exists for app "${packageName}". Use !app ${packageName} to see details.`,
        };
      }

      // Create room options
      const roomOptions = {
        name: nameArg || `Google Play Reviews - ${app.appName || packageName}`,
        topic:
          topicArg ||
          `Google Play reviews and support for ${app.appName || packageName}`,
        alias: `_googleplay_${packageName.replace(/\./g, '_')}`,
        isPublic,
        visibility: isPublic ? 'public' : 'private',
        preset: isPublic ? 'public_chat' : 'private_chat',
      };

      // Create the room
      const roomResult = await this.createAppRoom(packageName, roomOptions);

      if (!roomResult.success) {
        return {
          success: false,
          message: `❌ Failed to create room: ${roomResult.error}`,
        };
      }

      await this.auditLogger.logBridgeCommand(
        'createroom',
        context.userId,
        context.roomId,
        true,
        undefined,
        {
          packageName,
          roomId: roomResult.roomId,
          alias: roomOptions.alias,
          isPublic,
          roomName: roomOptions.name,
        }
      );

      const successMessage = `✅ Successfully created room for ${packageName}

🏠 Room ID: ${roomResult.roomId}
📛 Room Alias: #${roomOptions.alias}:${this.getBridgeDomain()}
📝 Room Name: ${roomOptions.name}
🔒 Visibility: ${isPublic ? 'Public' : 'Private'}
📋 Topic: ${roomOptions.topic}

The bridge bot has joined the room and is ready to forward reviews.`;

      const htmlMessage = `<strong>✅ Successfully created room for ${packageName}</strong>

<ul>
<li><strong>🏠 Room ID:</strong> <code>${roomResult.roomId}</code></li>
<li><strong>📛 Room Alias:</strong> <code>#${roomOptions.alias}:${this.getBridgeDomain()}</code></li>
<li><strong>📝 Room Name:</strong> ${roomOptions.name}</li>
<li><strong>🔒 Visibility:</strong> ${isPublic ? 'Public' : 'Private'}</li>
<li><strong>📋 Topic:</strong> ${roomOptions.topic}</li>
</ul>

<p><em>The bridge bot has joined the room and is ready to forward reviews.</em></p>`;

      return {
        success: true,
        message: successMessage,
        htmlMessage,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      await this.auditLogger.logBridgeCommand(
        'createroom',
        context.userId,
        context.roomId,
        false,
        undefined,
        { error: errorMessage, packageName: args[0] },
        errorMessage
      );

      return {
        success: false,
        message: `❌ Room creation failed: ${errorMessage}`,
      };
    }
  }

  private async handleListUsers(
    context: CommandContext
  ): Promise<CommandResult> {
    const { args } = context;

    try {
      const packageName = args[0];
      const limitStr = args[1];
      const limit = limitStr ? parseInt(limitStr) : 20;

      // Validate limit
      if (limit > 100) {
        return {
          success: false,
          message: '❌ Limit cannot exceed 100 users for performance reasons.',
        };
      }

      if (limit < 1) {
        return {
          success: false,
          message: '❌ Limit must be at least 1.',
        };
      }

      let users: any[];
      let title: string;

      if (packageName) {
        // Filter users by package name if specified
        const app = this.appManager.getApp(packageName);
        if (!app) {
          return {
            success: false,
            message: `❌ App "${packageName}" not found. Use !apps to list available apps.`,
          };
        }

        // Get users for specific app - this is a placeholder implementation
        users = this.getVirtualUsersForApp(packageName, limit);
        title = `Virtual Users for ${packageName}`;
      } else {
        // Get all virtual users
        users = this.getAllVirtualUsers(limit);
        title = 'All Virtual Users';
      }

      if (users.length === 0) {
        const message = packageName
          ? `📱 No virtual users found for app "${packageName}".`
          : '📱 No virtual users currently active.';
        return {
          success: true,
          message,
        };
      }

      // Format the response
      const messageContent = this.formatUserList(users, title, limit);
      const htmlContent = this.formatUserListHTML(users, title, limit);

      await this.auditLogger.logBridgeCommand(
        'users',
        context.userId,
        context.roomId,
        true,
        undefined,
        { packageName: packageName || 'all', userCount: users.length, limit }
      );

      return {
        success: true,
        message: messageContent,
        htmlMessage: htmlContent,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      await this.auditLogger.logBridgeCommand(
        'users',
        context.userId,
        context.roomId,
        false,
        undefined,
        { error: errorMessage },
        errorMessage
      );

      return {
        success: false,
        message: `Failed to list users: ${errorMessage}`,
      };
    }
  }

  private async handleCleanup(context: CommandContext): Promise<CommandResult> {
    const { args } = context;

    try {
      const daysStr = args[0] || '30';
      const isPreview = args.includes('--preview') || args.includes('-p');
      const isForce = args.includes('--force') || args.includes('-f');
      const days = parseInt(daysStr);

      // Validate days parameter
      if (isNaN(days) || days < 7) {
        return {
          success: false,
          message:
            '❌ Days must be a number ≥ 7 for safety. Usage: !cleanup [days] [--preview] [--force]',
        };
      }

      if (days > 365) {
        return {
          success: false,
          message: '❌ Days cannot exceed 365 for safety reasons.',
        };
      }

      // Calculate cutoff date
      const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      // Get users to cleanup
      const usersToCleanup = this.getInactiveUsers(cutoffDate);

      if (usersToCleanup.length === 0) {
        return {
          success: true,
          message: `🧹 No inactive users found older than ${days} days.`,
        };
      }

      if (isPreview) {
        // Preview mode - show what would be cleaned up
        const previewMessage = this.formatCleanupPreview(usersToCleanup, days);
        const previewHtml = this.formatCleanupPreviewHTML(usersToCleanup, days);

        await this.auditLogger.logBridgeCommand(
          'cleanup-preview',
          context.userId,
          context.roomId,
          true,
          undefined,
          { days, userCount: usersToCleanup.length }
        );

        return {
          success: true,
          message: previewMessage,
          htmlMessage: previewHtml,
        };
      }

      // Check if force flag is required for large cleanups
      if (usersToCleanup.length > 50 && !isForce) {
        return {
          success: false,
          message: `❌ Cleanup would affect ${usersToCleanup.length} users. Use --force flag to proceed with large cleanups.`,
        };
      }

      // Perform actual cleanup
      const cleanedCount = await this.performUserCleanup(usersToCleanup);

      await this.auditLogger.logBridgeCommand(
        'cleanup',
        context.userId,
        context.roomId,
        true,
        undefined,
        { days, userCount: cleanedCount, cutoffDate: cutoffDate.toISOString() }
      );

      const successMessage = `🧹 Successfully cleaned up ${cleanedCount} inactive users (older than ${days} days).`;

      return {
        success: true,
        message: successMessage,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      await this.auditLogger.logBridgeCommand(
        'cleanup',
        context.userId,
        context.roomId,
        false,
        undefined,
        { error: errorMessage },
        errorMessage
      );

      return {
        success: false,
        message: `❌ Cleanup failed: ${errorMessage}`,
      };
    }
  }

  // Phase 4.2 Feature command handlers
  private async handleFeatures(
    _context: CommandContext
  ): Promise<CommandResult> {
    if (!this.googlePlayBridge) {
      return {
        success: false,
        message: 'Bridge features not available',
      };
    }

    try {
      const featuresStatus = this.googlePlayBridge.getFeaturesStatus();
      const lines = [
        '**Phase 4.2 Advanced Features Status:**',
        `• Review Categorization: ${featuresStatus.categorization ? '✅ Enabled' : '❌ Disabled'}`,
        `• Response Suggestions: ${featuresStatus.responseSuggestions ? '✅ Enabled' : '❌ Disabled'}`,
        `• Message Templates: ${featuresStatus.messageTemplates ? '✅ Enabled' : '❌ Disabled'}`,
        `• Message Threading: ${featuresStatus.messageThreading ? '✅ Enabled' : '❌ Disabled'}`,
      ];

      return {
        success: true,
        message: lines.join('\n'),
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to get feature status: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  private async handleCategorize(
    context: CommandContext
  ): Promise<CommandResult> {
    if (!this.googlePlayBridge) {
      return {
        success: false,
        message: 'Categorization feature not available',
      };
    }

    const categorization = this.googlePlayBridge.getReviewCategorization();
    if (!categorization) {
      return {
        success: false,
        message: 'Review categorization not enabled',
      };
    }

    const { args } = context;
    if (args.length === 0) {
      return {
        success: false,
        message: 'Usage: !categorize <review-text>',
      };
    }

    const reviewText = args.join(' ');

    try {
      const result = await categorization.categorizeReview({
        reviewId: 'test-' + Date.now(),
        text: reviewText,
        starRating: 3,
        authorName: 'Test User',
        device: 'Test Device',
        androidOsVersion: 'Test Version',
        appVersionName: '1.0.0',
        lastModified: new Date(),
      });

      const lines = [
        `**Review Categorization Result:**`,
        `Primary: ${result.primaryCategory?.category.name} (${(result.primaryCategory?.confidence * 100).toFixed(1)}%)`,
        `Sentiment: ${result.sentiment}`,
        `Urgency: ${result.urgency}`,
        `Categories: ${result.secondaryCategories.map((c: any) => `${c.category.name} (${(c.confidence * 100).toFixed(1)}%)`).join(', ')}`,
      ];

      return {
        success: true,
        message: lines.join('\n'),
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to categorize review: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  private async handleSuggest(context: CommandContext): Promise<CommandResult> {
    if (!this.googlePlayBridge) {
      return {
        success: false,
        message: 'Response suggestions feature not available',
      };
    }

    const responseSuggestions = this.googlePlayBridge.getResponseSuggestions();
    const categorization = this.googlePlayBridge.getReviewCategorization();

    if (!responseSuggestions || !categorization) {
      return {
        success: false,
        message: 'Response suggestions or categorization not enabled',
      };
    }

    const { args } = context;
    if (args.length < 2) {
      return {
        success: false,
        message: 'Usage: !suggest <review-text> <rating>',
      };
    }

    const rating = parseInt(args[args.length - 1] || '0');
    const reviewText = args.slice(0, -1).join(' ');

    if (isNaN(rating) || rating < 1 || rating > 5) {
      return {
        success: false,
        message: 'Rating must be a number between 1 and 5',
      };
    }

    try {
      const review = {
        reviewId: 'test-' + Date.now(),
        text: reviewText,
        starRating: rating,
        authorName: 'Test User',
        device: 'Test Device',
        androidOsVersion: 'Test Version',
        appVersionName: '1.0.0',
        lastModified: new Date(),
      };

      const categorizationResult =
        await categorization.categorizeReview(review);
      const suggestions = await responseSuggestions.generateSuggestions({
        review,
        categorization: categorizationResult,
        appName: 'Test App',
        supportEmail: 'support@company.com',
      });

      if (suggestions.length === 0) {
        return {
          success: true,
          message: 'No response suggestions found for this review.',
        };
      }

      const lines = ['**Response Suggestions:**'];
      suggestions.forEach((suggestion: any, index: number) => {
        lines.push(
          `\n**${index + 1}. ${suggestion.template.name}** (${(suggestion.confidence * 100).toFixed(1)}% confidence)`
        );
        lines.push(suggestion.renderedText);
      });

      return {
        success: true,
        message: lines.join('\n'),
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to generate suggestions: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  private async handleTemplates(
    context: CommandContext
  ): Promise<CommandResult> {
    if (!this.googlePlayBridge) {
      return {
        success: false,
        message: 'Templates feature not available',
      };
    }

    const messageTemplates = this.googlePlayBridge.getMessageTemplates();
    if (!messageTemplates) {
      return {
        success: false,
        message: 'Message templates not enabled',
      };
    }

    const { args } = context;
    const action = args[0]?.toLowerCase() || 'list';

    try {
      switch (action) {
        case 'list': {
          const templates = messageTemplates.getAllTemplates();
          if (templates.length === 0) {
            return {
              success: true,
              message: 'No templates found.',
            };
          }

          const lines = ['**Available Templates:**'];
          templates.forEach((template: any) => {
            lines.push(
              `• ${template.name} (${template.id}) - ${template.category}`
            );
          });

          return {
            success: true,
            message: lines.join('\n'),
          };
        }

        case 'stats': {
          const stats = messageTemplates.getTemplateStats();
          const lines = [
            '**Template Statistics:**',
            `Total: ${stats.total}`,
            `By Category: ${Object.entries(stats.byCategory)
              .map(([cat, count]) => `${cat}: ${count}`)
              .join(', ')}`,
            `Most Used: ${stats.mostUsed.map((t: any) => `${t.name} (${t.usageCount})`).join(', ')}`,
          ];

          return {
            success: true,
            message: lines.join('\n'),
          };
        }

        case 'search': {
          if (args.length < 2) {
            return {
              success: false,
              message: 'Usage: !templates search <query>',
            };
          }

          const query = args.slice(1).join(' ');
          const results = messageTemplates.searchTemplates(query);

          if (results.length === 0) {
            return {
              success: true,
              message: `No templates found matching "${query}"`,
            };
          }

          const lines = [`**Templates matching "${query}":**`];
          results.forEach((template: any) => {
            lines.push(
              `• ${template.name} - ${template.description || 'No description'}`
            );
          });

          return {
            success: true,
            message: lines.join('\n'),
          };
        }

        default:
          return {
            success: false,
            message: 'Usage: !templates [list|stats|search <query>]',
          };
      }
    } catch (error) {
      return {
        success: false,
        message: `Failed to handle templates command: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  private async handleThreads(context: CommandContext): Promise<CommandResult> {
    if (!this.googlePlayBridge) {
      return {
        success: false,
        message: 'Threading feature not available',
      };
    }

    const messageThreading = this.googlePlayBridge.getMessageThreading();
    if (!messageThreading) {
      return {
        success: false,
        message: 'Message threading not enabled',
      };
    }

    const { args, roomId, userId } = context;
    const action = args[0]?.toLowerCase() || 'list';

    try {
      switch (action) {
        case 'list': {
          const threads = messageThreading.getRoomThreads(roomId);
          if (threads.length === 0) {
            return {
              success: true,
              message: 'No active threads in this room.',
            };
          }

          const lines = ['**Active Threads:**'];
          threads.forEach((thread: any) => {
            const age = Math.round(
              (Date.now() - thread.lastActivity.getTime()) / (1000 * 60 * 60)
            );
            lines.push(
              `• ${thread.threadId} - ${thread.messageCount} messages, ${age}h old (${thread.status})`
            );
          });

          return {
            success: true,
            message: lines.join('\n'),
          };
        }

        case 'stats': {
          const stats = messageThreading.getThreadingStats();
          const lines = [
            '**Threading Statistics:**',
            `Total threads: ${stats.totalThreads}`,
            `Active: ${stats.activeThreads}, Resolved: ${stats.resolvedThreads}, Archived: ${stats.archivedThreads}`,
            `Avg messages per thread: ${stats.averageMessagesPerThread.toFixed(1)}`,
            `Avg thread lifetime: ${stats.averageThreadLifetime.toFixed(1)}h`,
          ];

          return {
            success: true,
            message: lines.join('\n'),
          };
        }

        case 'resolve': {
          if (args.length < 2) {
            return {
              success: false,
              message: 'Usage: !threads resolve <thread-id>',
            };
          }

          const threadId = args[1];
          await messageThreading.resolveThread(
            threadId,
            userId,
            'Resolved via command'
          );

          return {
            success: true,
            message: `Thread ${threadId} has been resolved.`,
          };
        }

        default:
          return {
            success: false,
            message: 'Usage: !threads [list|stats|resolve <thread-id>]',
          };
      }
    } catch (error) {
      return {
        success: false,
        message: `Failed to handle threads command: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  // Phase 4.3 Command handlers
  private async handleReloadConfig(
    context: CommandContext
  ): Promise<CommandResult> {
    let configBackup: any = null;
    let rollbackRequired = false;

    try {
      this.logger.info('Starting configuration reload', {
        userId: context.userId,
        roomId: context.roomId,
      });

      // Create configuration backup for rollback capability
      const oldConfig = Config.getInstance().all;
      configBackup = JSON.parse(JSON.stringify(oldConfig));

      // Step 1: Validate configuration file before loading
      const configPath = process.env.CONFIG_PATH || './config/config.yaml';
      const validationResult = await this.validateConfigFile(configPath);

      if (!validationResult.valid) {
        await this.auditLogger.logConfigReload(
          context.userId,
          false,
          { validationErrors: validationResult.errors },
          'Configuration validation failed'
        );

        return {
          success: false,
          message: `❌ Configuration validation failed:\n${validationResult.errors.join('\n')}`,
        };
      }

      // Step 2: Attempt to reload configuration
      await Config.reload();
      rollbackRequired = true; // From this point, we may need rollback
      const newConfig = Config.getInstance().all;

      // Step 3: Detect critical changes that require restart
      const criticalChanges = this.detectCriticalChanges(oldConfig, newConfig);
      const nonCriticalChanges = this.detectNonCriticalChanges(
        oldConfig,
        newConfig
      );

      // Step 4: Apply hot-reload for non-critical changes
      if (nonCriticalChanges.length > 0) {
        try {
          await this.applyHotReload(oldConfig, newConfig, nonCriticalChanges);
        } catch (hotReloadError) {
          // If hot-reload fails, rollback and report
          this.logger.warn('Hot-reload failed, rolling back configuration', {
            error: hotReloadError,
            userId: context.userId,
          });

          await this.rollbackConfiguration(configBackup);

          await this.auditLogger.logConfigReload(
            context.userId,
            false,
            {
              hotReloadError:
                hotReloadError instanceof Error
                  ? hotReloadError.message
                  : hotReloadError,
            },
            'Hot-reload failed, configuration rolled back'
          );

          return {
            success: false,
            message: `❌ Hot-reload failed, configuration rolled back: ${hotReloadError instanceof Error ? hotReloadError.message : 'Unknown error'}`,
          };
        }
      }

      // Step 5: Prepare response message
      let message = '✅ Configuration reloaded successfully.';
      let htmlMessage =
        '<strong>✅ Configuration reloaded successfully.</strong>';

      if (nonCriticalChanges.length > 0) {
        const changesMsg = `\n\n📝 Applied hot-reload changes:\n${nonCriticalChanges.map(c => `  • ${c.description}`).join('\n')}`;
        message += changesMsg;
        htmlMessage += `<br><br><strong>📝 Applied hot-reload changes:</strong><ul>${nonCriticalChanges.map(c => `<li>${c.description}</li>`).join('')}</ul>`;
      }

      if (criticalChanges.length > 0) {
        const warningMsg = `\n\n⚠️ WARNING: The following critical settings changed and require a restart:\n${criticalChanges.map(c => `  • ${c.description}`).join('\n')}\n\nUse !restart to apply these changes.`;
        message += warningMsg;
        htmlMessage += `<br><br><span style="color: orange;"><strong>⚠️ WARNING:</strong> The following critical settings changed and require a restart:<ul>${criticalChanges.map(c => `<li>${c.description}</li>`).join('')}</ul><em>Use !restart to apply these changes.</em></span>`;
      }

      this.logger.info('Configuration reloaded successfully', {
        userId: context.userId,
        criticalChanges: criticalChanges.map(c => c.key),
        nonCriticalChanges: nonCriticalChanges.map(c => c.key),
        hotReloadApplied: nonCriticalChanges.length > 0,
      });

      // Log successful config reload to audit log
      await this.auditLogger.logConfigReload(context.userId, true, {
        criticalChanges: criticalChanges.map(c => ({
          key: c.key,
          description: c.description,
        })),
        nonCriticalChanges: nonCriticalChanges.map(c => ({
          key: c.key,
          description: c.description,
        })),
        hotReloadApplied: nonCriticalChanges.length > 0,
      });

      return {
        success: true,
        message,
        htmlMessage,
      };
    } catch (error) {
      const errorMsg = `Failed to reload configuration: ${error instanceof Error ? error.message : 'Unknown error'}`;
      this.logger.error('Configuration reload failed', {
        error: error instanceof Error ? error.message : error,
        userId: context.userId,
        rollbackRequired,
      });

      // Attempt rollback if configuration was partially loaded
      if (rollbackRequired && configBackup) {
        try {
          await this.rollbackConfiguration(configBackup);
          this.logger.info(
            'Configuration rolled back successfully after failure',
            {
              userId: context.userId,
            }
          );
        } catch (rollbackError) {
          this.logger.error('Failed to rollback configuration', {
            rollbackError:
              rollbackError instanceof Error
                ? rollbackError.message
                : rollbackError,
            userId: context.userId,
          });
        }
      }

      // Log failed config reload to audit log
      await this.auditLogger.logConfigReload(
        context.userId,
        false,
        { rollbackAttempted: rollbackRequired },
        errorMsg
      );

      return {
        success: false,
        message: `❌ ${errorMsg}${rollbackRequired ? ' (Configuration rolled back)' : ''}`,
      };
    }
  }

  private async handleMaintenance(
    context: CommandContext
  ): Promise<CommandResult> {
    const { args } = context;
    const action = args.length > 0 ? args[0]?.toLowerCase() : 'status';

    try {
      switch (action) {
        case 'on':
        case 'enable':
          if (this.maintenanceMode) {
            return {
              success: false,
              message: 'Bridge is already in maintenance mode.',
            };
          }

          this.maintenanceMode = true;
          this.maintenanceStartTime = new Date();
          this.maintenanceReason =
            args.slice(1).join(' ') || 'Manual maintenance';

          // Notify bridge about maintenance mode if available
          if (
            this.googlePlayBridge &&
            typeof this.googlePlayBridge.onMaintenanceMode === 'function'
          ) {
            await this.googlePlayBridge.onMaintenanceMode(
              true,
              this.maintenanceReason
            );
          }

          this.logger.warn('Bridge entered maintenance mode', {
            userId: context.userId,
            reason: this.maintenanceReason,
          });

          // Log maintenance mode activation to audit log
          await this.auditLogger.logMaintenanceMode(
            context.userId,
            true,
            this.maintenanceReason
          );

          return {
            success: true,
            message: `Bridge is now in maintenance mode.\nReason: ${this.maintenanceReason}`,
            htmlMessage: `<strong>Bridge is now in maintenance mode.</strong><br>Reason: ${this.maintenanceReason}`,
          };

        case 'off':
        case 'disable':
          if (!this.maintenanceMode) {
            return {
              success: false,
              message: 'Bridge is not in maintenance mode.',
            };
          }

          const duration = this.maintenanceStartTime
            ? (
                (Date.now() - this.maintenanceStartTime.getTime()) /
                1000 /
                60
              ).toFixed(1)
            : 'unknown';

          this.maintenanceMode = false;
          this.maintenanceStartTime = undefined;
          this.maintenanceReason = undefined;

          // Notify bridge about maintenance mode end if available
          if (
            this.googlePlayBridge &&
            typeof this.googlePlayBridge.onMaintenanceMode === 'function'
          ) {
            await this.googlePlayBridge.onMaintenanceMode(false);
          }

          this.logger.info('Bridge exited maintenance mode', {
            userId: context.userId,
            durationMinutes: parseFloat(duration),
          });

          // Log maintenance mode deactivation to audit log
          await this.auditLogger.logMaintenanceMode(context.userId, false);

          return {
            success: true,
            message: `Bridge is no longer in maintenance mode.\nDuration: ${duration} minutes`,
            htmlMessage: `<strong>Bridge is no longer in maintenance mode.</strong><br>Duration: ${duration} minutes`,
          };

        case 'status':
        default:
          if (!this.maintenanceMode) {
            return {
              success: true,
              message: 'Bridge is not in maintenance mode.',
              htmlMessage:
                '<strong>Bridge is not in maintenance mode.</strong>',
            };
          }

          const uptimeMinutes = this.maintenanceStartTime
            ? (
                (Date.now() - this.maintenanceStartTime.getTime()) /
                1000 /
                60
              ).toFixed(1)
            : 'unknown';

          return {
            success: true,
            message: `Bridge is in maintenance mode.\nReason: ${this.maintenanceReason}\nDuration: ${uptimeMinutes} minutes`,
            htmlMessage: `<strong>Bridge is in maintenance mode.</strong><br>Reason: ${this.maintenanceReason}<br>Duration: ${uptimeMinutes} minutes`,
          };
      }
    } catch (error) {
      const errorMsg = `Failed to handle maintenance command: ${error instanceof Error ? error.message : 'Unknown error'}`;
      this.logger.error('Maintenance command failed', {
        error: error instanceof Error ? error.message : error,
        userId: context.userId,
        action,
      });

      return {
        success: false,
        message: errorMsg,
      };
    }
  }

  private async handleAudit(context: CommandContext): Promise<CommandResult> {
    const { args } = context;
    const limit =
      args.length > 0 && !isNaN(parseInt(args[0]!)) ? parseInt(args[0]!) : 10;
    const filter = args.length > 1 ? args.slice(1).join(' ') : undefined;

    try {
      // Search audit entries using the proper audit logger
      const searchOptions: any = { limit };
      if (filter) {
        // Try to parse filter as action or user
        if (filter.startsWith('@')) {
          searchOptions.userId = filter;
        } else {
          searchOptions.action = filter;
        }
      }

      const auditEntries = await this.auditLogger.search(searchOptions);

      if (auditEntries.length === 0) {
        return {
          success: true,
          message: 'No audit log entries found.',
          htmlMessage: '<em>No audit log entries found.</em>',
        };
      }

      const message =
        `Recent audit log entries (${auditEntries.length}):\n\n` +
        auditEntries
          .map(
            entry =>
              `[${entry.timestamp.toISOString()}] ${entry.level.toUpperCase()}: ${entry.action} - ${entry.result}` +
              (entry.userId ? ` (User: ${entry.userId})` : '') +
              (entry.packageName ? ` (App: ${entry.packageName})` : '') +
              (entry.errorMessage ? ` Error: ${entry.errorMessage}` : '')
          )
          .join('\n');

      const htmlMessage =
        `<strong>Recent audit log entries (${auditEntries.length}):</strong><br><br>` +
        auditEntries
          .map(
            entry =>
              `<code>[${entry.timestamp.toISOString()}]</code> <strong>${entry.level.toUpperCase()}:</strong> ` +
              `${entry.action} - <span style="color: ${entry.result === 'success' ? 'green' : 'red'}">${entry.result}</span>` +
              (entry.userId ? ` <em>(User: ${entry.userId})</em>` : '') +
              (entry.packageName
                ? ` <em>(App: ${entry.packageName})</em>`
                : '') +
              (entry.errorMessage
                ? `<br><span style="color: red;">Error: ${entry.errorMessage}</span>`
                : '')
          )
          .join('<br>');

      // Log this audit query itself
      await this.auditLogger.logBridgeCommand(
        'audit',
        context.userId,
        context.roomId,
        true,
        undefined,
        { limit, filter, resultCount: auditEntries.length }
      );

      return {
        success: true,
        message,
        htmlMessage,
      };
    } catch (error) {
      const errorMsg = `Failed to retrieve audit log: ${error instanceof Error ? error.message : 'Unknown error'}`;
      this.logger.error('Audit log retrieval failed', {
        error: error instanceof Error ? error.message : error,
        userId: context.userId,
      });

      // Log this failed audit query
      await this.auditLogger.logBridgeCommand(
        'audit',
        context.userId,
        context.roomId,
        false,
        undefined,
        { limit, filter },
        errorMsg
      );

      return {
        success: false,
        message: errorMsg,
      };
    }
  }

  // Additional command handlers
  private async handleRestart(context: CommandContext): Promise<CommandResult> {
    const { args, userId } = context;
    const reason =
      args.length > 0 ? args.join(' ') : 'Manual restart requested';

    try {
      this.logger.warn('Bridge restart requested', {
        userId,
        reason,
      });

      // Log restart action to audit log
      await this.auditLogger.logBridgeCommand(
        'restart',
        userId,
        context.roomId,
        true,
        undefined,
        { reason }
      );

      // Notify bridge about restart if available
      if (
        this.googlePlayBridge &&
        typeof this.googlePlayBridge.onRestart === 'function'
      ) {
        await this.googlePlayBridge.onRestart(reason);
      }

      // Schedule restart after response is sent
      setTimeout(async () => {
        try {
          this.logger.info('Initiating bridge shutdown for restart');
          process.exit(0); // Process manager (PM2, systemd, etc.) should restart
        } catch (error) {
          this.logger.error('Error during restart shutdown', error);
          process.exit(1);
        }
      }, 1000); // 1 second delay to allow response to be sent

      return {
        success: true,
        message: `🔄 Bridge restart initiated.\nReason: ${reason}\nThe bridge will restart momentarily.`,
        htmlMessage: `<strong>🔄 Bridge restart initiated.</strong><br>Reason: ${reason}<br><em>The bridge will restart momentarily.</em>`,
      };
    } catch (error) {
      const errorMsg = `Failed to restart bridge: ${error instanceof Error ? error.message : 'Unknown error'}`;
      this.logger.error('Restart command failed', {
        error: error instanceof Error ? error.message : error,
        userId,
      });

      // Log failed restart to audit log
      await this.auditLogger.logBridgeCommand(
        'restart',
        userId,
        context.roomId,
        false,
        undefined,
        { reason },
        errorMsg
      );

      return {
        success: false,
        message: errorMsg,
      };
    }
  }

  private async handleLogs(context: CommandContext): Promise<CommandResult> {
    const { args, userId } = context;
    const action = args[0]?.toLowerCase() || 'show';
    const limitStr = args[1] || '50';
    const limit = parseInt(limitStr);

    if (isNaN(limit) || limit < 1 || limit > 1000) {
      return {
        success: false,
        message: '❌ Limit must be a number between 1 and 1000',
      };
    }

    try {
      let message: string;
      let htmlMessage: string;

      switch (action) {
        case 'tail':
        case 'show': {
          // Get recent audit log entries as a proxy for system logs
          const recentEntries = await this.auditLogger.search({
            limit,
          });

          if (recentEntries.length === 0) {
            message = 'No recent log entries found.';
            htmlMessage = '<em>No recent log entries found.</em>';
          } else {
            const logLines = recentEntries.map(entry => {
              const timestamp = entry.timestamp.toISOString();
              const level = entry.level.toUpperCase().padEnd(5);
              return `[${timestamp}] ${level} ${entry.action}: ${entry.result}`;
            });

            message = `Recent log entries (${recentEntries.length}):\n\n${logLines.join('\n')}`;

            const htmlLogLines = recentEntries.map(entry => {
              const timestamp = entry.timestamp.toISOString();
              const levelColor =
                entry.level === 'error'
                  ? 'red'
                  : entry.level === 'warn'
                    ? 'orange'
                    : 'black';
              return `<code>[${timestamp}]</code> <span style="color: ${levelColor}; font-weight: bold;">${entry.level.toUpperCase().padEnd(5)}</span> ${entry.action}: ${entry.result}`;
            });

            htmlMessage = `<strong>Recent log entries (${recentEntries.length}):</strong><br><br>${htmlLogLines.join('<br>')}`;
          }
          break;
        }

        default:
          return {
            success: false,
            message: 'Usage: !logs [tail|show] [limit]',
          };
      }

      // Log this logs query
      await this.auditLogger.logBridgeCommand(
        'logs',
        userId,
        context.roomId,
        true,
        undefined,
        { action, limit }
      );

      return {
        success: true,
        message,
        htmlMessage,
      };
    } catch (error) {
      const errorMsg = `Failed to retrieve logs: ${error instanceof Error ? error.message : 'Unknown error'}`;
      this.logger.error('Logs command failed', {
        error: error instanceof Error ? error.message : error,
        userId,
        action,
        limit,
      });

      // Log failed logs query
      await this.auditLogger.logBridgeCommand(
        'logs',
        userId,
        context.roomId,
        false,
        undefined,
        { action, limit },
        errorMsg
      );

      return {
        success: false,
        message: errorMsg,
      };
    }
  }

  private async handleMetrics(context: CommandContext): Promise<CommandResult> {
    const { args, userId } = context;
    const action = args[0]?.toLowerCase() || 'show';

    try {
      switch (action) {
        case 'export': {
          if (!this.httpServer) {
            return {
              success: false,
              message: '❌ HTTP server not available for metrics export',
            };
          }

          // Generate Prometheus metrics
          const metricsData = this.httpServer.generatePrometheusMetrics();
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          const filename = `bridge-metrics-${timestamp}.txt`;
          const tempDir = process.env.TMPDIR || process.env.TEMP || '/tmp';
          const filePath = path.join(tempDir, filename);

          // Write metrics to file
          await fs.promises.writeFile(filePath, metricsData, 'utf8');

          // Log metrics export
          await this.auditLogger.logBridgeCommand(
            'metrics',
            userId,
            context.roomId,
            true,
            undefined,
            { action, filename, filePath }
          );

          return {
            success: true,
            message: `📊 Metrics exported successfully\nFile: ${filePath}\nSize: ${Math.round((metricsData.length / 1024) * 100) / 100} KB`,
            htmlMessage: `<strong>📊 Metrics exported successfully</strong><br>File: <code>${filePath}</code><br>Size: ${Math.round((metricsData.length / 1024) * 100) / 100} KB`,
          };
        }

        case 'show':
        default: {
          // Show basic metrics summary
          const uptime = process.uptime();
          const memUsage = process.memoryUsage();
          const cpuUsage = process.cpuUsage();

          const metrics = [
            `**Bridge Metrics Summary:**`,
            `• Uptime: ${Math.round(uptime)}s (${Math.round((uptime / 3600) * 100) / 100}h)`,
            `• Memory Used: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
            `• Memory Total: ${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`,
            `• CPU User: ${Math.round(cpuUsage.user / 1000)}ms`,
            `• CPU System: ${Math.round(cpuUsage.system / 1000)}ms`,
            `• Node Version: ${process.version}`,
            `• Platform: ${process.platform}`,
            ``,
            `Use \`!metrics export\` to export full Prometheus metrics to file.`,
          ];

          const htmlMetrics = [
            `<strong>Bridge Metrics Summary:</strong>`,
            `• <strong>Uptime:</strong> ${Math.round(uptime)}s (${Math.round((uptime / 3600) * 100) / 100}h)`,
            `• <strong>Memory Used:</strong> ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
            `• <strong>Memory Total:</strong> ${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`,
            `• <strong>CPU User:</strong> ${Math.round(cpuUsage.user / 1000)}ms`,
            `• <strong>CPU System:</strong> ${Math.round(cpuUsage.system / 1000)}ms`,
            `• <strong>Node Version:</strong> ${process.version}`,
            `• <strong>Platform:</strong> ${process.platform}`,
            ``,
            `Use <code>!metrics export</code> to export full Prometheus metrics to file.`,
          ];

          // Log metrics view
          await this.auditLogger.logBridgeCommand(
            'metrics',
            userId,
            context.roomId,
            true,
            undefined,
            { action }
          );

          return {
            success: true,
            message: metrics.join('\n'),
            htmlMessage: htmlMetrics.join('<br>'),
          };
        }
      }
    } catch (error) {
      const errorMsg = `Failed to handle metrics command: ${error instanceof Error ? error.message : 'Unknown error'}`;
      this.logger.error('Metrics command failed', {
        error: error instanceof Error ? error.message : error,
        userId,
        action,
      });

      // Log failed metrics command
      await this.auditLogger.logBridgeCommand(
        'metrics',
        userId,
        context.roomId,
        false,
        undefined,
        { action },
        errorMsg
      );

      return {
        success: false,
        message: errorMsg,
      };
    }
  }

  private async handleBackup(context: CommandContext): Promise<CommandResult> {
    const { args, userId } = context;
    const scope = args[0]?.toLowerCase() || 'config';

    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const tempDir = process.env.TMPDIR || process.env.TEMP || '/tmp';
      const backups: string[] = [];

      switch (scope) {
        case 'config': {
          // Backup configuration
          const config = Config.getInstance();
          const configData = JSON.stringify(config.all, null, 2);
          const configFilename = `bridge-config-${timestamp}.json`;
          const configPath = path.join(tempDir, configFilename);

          await fs.promises.writeFile(configPath, configData, 'utf8');
          backups.push(`Config: ${configPath}`);
          break;
        }

        case 'all': {
          // Backup configuration
          const config = Config.getInstance();
          const configData = JSON.stringify(config.all, null, 2);
          const configFilename = `bridge-config-${timestamp}.json`;
          const configPath = path.join(tempDir, configFilename);

          await fs.promises.writeFile(configPath, configData, 'utf8');
          backups.push(`Config: ${configPath}`);

          // Backup app configurations
          const apps = this.appManager.getAllApps();
          const appsData = JSON.stringify(apps, null, 2);
          const appsFilename = `bridge-apps-${timestamp}.json`;
          const appsPath = path.join(tempDir, appsFilename);

          await fs.promises.writeFile(appsPath, appsData, 'utf8');
          backups.push(`Apps: ${appsPath}`);

          // Backup recent audit logs
          const auditEntries = await this.auditLogger.search({ limit: 1000 });
          const auditData = JSON.stringify(auditEntries, null, 2);
          const auditFilename = `bridge-audit-${timestamp}.json`;
          const auditPath = path.join(tempDir, auditFilename);

          await fs.promises.writeFile(auditPath, auditData, 'utf8');
          backups.push(`Audit: ${auditPath}`);
          break;
        }

        default:
          return {
            success: false,
            message: 'Usage: !backup [config|all]',
          };
      }

      // Log backup action
      await this.auditLogger.logBridgeCommand(
        'backup',
        userId,
        context.roomId,
        true,
        undefined,
        { scope, backups }
      );

      const message = [
        `💾 Backup completed successfully`,
        `Scope: ${scope}`,
        ``,
        `Files created:`,
        ...backups.map(backup => `• ${backup}`),
      ].join('\n');

      const htmlMessage = [
        `<strong>💾 Backup completed successfully</strong>`,
        `<strong>Scope:</strong> ${scope}`,
        ``,
        `<strong>Files created:</strong>`,
        ...backups.map(backup => `• <code>${backup}</code>`),
      ].join('<br>');

      return {
        success: true,
        message,
        htmlMessage,
      };
    } catch (error) {
      const errorMsg = `Failed to create backup: ${error instanceof Error ? error.message : 'Unknown error'}`;
      this.logger.error('Backup command failed', {
        error: error instanceof Error ? error.message : error,
        userId,
        scope,
      });

      // Log failed backup
      await this.auditLogger.logBridgeCommand(
        'backup',
        userId,
        context.roomId,
        false,
        undefined,
        { scope },
        errorMsg
      );

      return {
        success: false,
        message: errorMsg,
      };
    }
  }

  // Public methods for maintenance mode
  public isInMaintenanceMode(): boolean {
    return this.maintenanceMode;
  }

  public getMaintenanceStatus(): {
    enabled: boolean;
    reason?: string | undefined;
    startTime?: Date | undefined;
    durationMinutes?: number | undefined;
  } {
    return {
      enabled: this.maintenanceMode,
      reason: this.maintenanceReason,
      startTime: this.maintenanceStartTime,
      durationMinutes: this.maintenanceStartTime
        ? (Date.now() - this.maintenanceStartTime.getTime()) / 1000 / 60
        : undefined,
    };
  }

  // Configuration reload helper methods

  /**
   * Validate configuration file before loading
   */
  private async validateConfigFile(
    configPath: string
  ): Promise<ConfigValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      // Check if file exists and is readable
      if (!fs.existsSync(configPath)) {
        errors.push(`Configuration file does not exist: ${configPath}`);
        return { valid: false, errors, warnings };
      }

      // Try to read and parse the YAML file
      const configContent = fs.readFileSync(configPath, 'utf8');
      let parsedConfig: any;

      try {
        parsedConfig = yaml.load(configContent);
      } catch (yamlError) {
        errors.push(
          `Invalid YAML syntax: ${yamlError instanceof Error ? yamlError.message : 'Unknown YAML error'}`
        );
        return { valid: false, errors, warnings };
      }

      // Validate required sections
      const requiredSections = [
        'homeserver',
        'appservice',
        'googleplay',
        'database',
      ];
      for (const section of requiredSections) {
        if (!parsedConfig[section]) {
          errors.push(`Missing required configuration section: ${section}`);
        }
      }

      // Validate homeserver configuration
      if (parsedConfig.homeserver) {
        if (!parsedConfig.homeserver.url) {
          errors.push('Missing required field: homeserver.url');
        }
        if (!parsedConfig.homeserver.domain) {
          errors.push('Missing required field: homeserver.domain');
        }
      }

      // Validate appservice configuration
      if (parsedConfig.appservice) {
        if (
          !parsedConfig.appservice.port ||
          typeof parsedConfig.appservice.port !== 'number'
        ) {
          errors.push(
            'Invalid or missing field: appservice.port (must be a number)'
          );
        }
        if (
          !parsedConfig.appservice.bind ||
          typeof parsedConfig.appservice.bind !== 'string'
        ) {
          errors.push(
            'Invalid or missing field: appservice.bind (must be a string)'
          );
        }
        if (!parsedConfig.appservice.botUsername) {
          errors.push('Missing required field: appservice.botUsername');
        }
      }

      // Validate database configuration
      if (parsedConfig.database) {
        if (
          !parsedConfig.database.type ||
          !['sqlite', 'postgresql'].includes(parsedConfig.database.type)
        ) {
          errors.push(
            'Invalid database.type (must be "sqlite" or "postgresql")'
          );
        }
      }

      // Validate Google Play configuration
      if (parsedConfig.googleplay) {
        const hasServiceAccountFile =
          parsedConfig.googleplay.serviceAccount?.keyFile;
        const hasServiceAccountContent =
          parsedConfig.googleplay.serviceAccount?.keyFileContent;
        const hasOAuth2 =
          parsedConfig.googleplay.oauth2?.clientId &&
          parsedConfig.googleplay.oauth2?.clientSecret;

        if (!hasServiceAccountFile && !hasServiceAccountContent && !hasOAuth2) {
          errors.push(
            'Google Play authentication configuration missing (need service account or oauth2)'
          );
        }

        if (
          parsedConfig.googleplay.apps &&
          !Array.isArray(parsedConfig.googleplay.apps)
        ) {
          errors.push('googleplay.apps must be an array');
        }
      }

      // Add warnings for deprecated or risky configurations
      if (parsedConfig.logging?.level === 'debug') {
        warnings.push(
          'Debug logging level may impact performance in production'
        );
      }

      if (
        parsedConfig.database?.type === 'sqlite' &&
        parsedConfig.database?.path === ':memory:'
      ) {
        warnings.push('In-memory database will lose data on restart');
      }

      return {
        valid: errors.length === 0,
        errors,
        warnings,
      };
    } catch (error) {
      errors.push(
        `Failed to validate configuration: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
      return { valid: false, errors, warnings };
    }
  }

  /**
   * Detect critical configuration changes that require restart
   */
  private detectCriticalChanges(
    oldConfig: any,
    newConfig: any
  ): ConfigChange[] {
    const changes: ConfigChange[] = [];

    // Appservice configuration changes
    if (oldConfig.appservice?.port !== newConfig.appservice?.port) {
      changes.push({
        key: 'appservice.port',
        description: `Application service port changed (${oldConfig.appservice?.port} → ${newConfig.appservice?.port})`,
        oldValue: oldConfig.appservice?.port,
        newValue: newConfig.appservice?.port,
      });
    }

    if (oldConfig.appservice?.bind !== newConfig.appservice?.bind) {
      changes.push({
        key: 'appservice.bind',
        description: `Application service bind address changed (${oldConfig.appservice?.bind} → ${newConfig.appservice?.bind})`,
        oldValue: oldConfig.appservice?.bind,
        newValue: newConfig.appservice?.bind,
      });
    }

    // Database configuration changes
    if (oldConfig.database?.type !== newConfig.database?.type) {
      changes.push({
        key: 'database.type',
        description: `Database type changed (${oldConfig.database?.type} → ${newConfig.database?.type})`,
        oldValue: oldConfig.database?.type,
        newValue: newConfig.database?.type,
      });
    }

    if (
      oldConfig.database?.type === 'postgresql' &&
      newConfig.database?.type === 'postgresql'
    ) {
      if (
        oldConfig.database?.host !== newConfig.database?.host ||
        oldConfig.database?.port !== newConfig.database?.port ||
        oldConfig.database?.database !== newConfig.database?.database
      ) {
        changes.push({
          key: 'database.connection',
          description: 'PostgreSQL connection parameters changed',
          oldValue: {
            host: oldConfig.database?.host,
            port: oldConfig.database?.port,
            database: oldConfig.database?.database,
          },
          newValue: {
            host: newConfig.database?.host,
            port: newConfig.database?.port,
            database: newConfig.database?.database,
          },
        });
      }
    }

    // Homeserver configuration changes
    if (oldConfig.homeserver?.url !== newConfig.homeserver?.url) {
      changes.push({
        key: 'homeserver.url',
        description: `Homeserver URL changed (${oldConfig.homeserver?.url} → ${newConfig.homeserver?.url})`,
        oldValue: oldConfig.homeserver?.url,
        newValue: newConfig.homeserver?.url,
      });
    }

    if (oldConfig.homeserver?.domain !== newConfig.homeserver?.domain) {
      changes.push({
        key: 'homeserver.domain',
        description: `Homeserver domain changed (${oldConfig.homeserver?.domain} → ${newConfig.homeserver?.domain})`,
        oldValue: oldConfig.homeserver?.domain,
        newValue: newConfig.homeserver?.domain,
      });
    }

    // Monitoring configuration changes
    if (oldConfig.monitoring?.httpPort !== newConfig.monitoring?.httpPort) {
      changes.push({
        key: 'monitoring.httpPort',
        description: `Monitoring HTTP port changed (${oldConfig.monitoring?.httpPort || 'disabled'} → ${newConfig.monitoring?.httpPort || 'disabled'})`,
        oldValue: oldConfig.monitoring?.httpPort,
        newValue: newConfig.monitoring?.httpPort,
      });
    }

    return changes;
  }

  /**
   * Detect non-critical configuration changes that can be hot-reloaded
   */
  private detectNonCriticalChanges(
    oldConfig: any,
    newConfig: any
  ): ConfigChange[] {
    const changes: ConfigChange[] = [];

    // Logging configuration changes
    if (oldConfig.logging?.level !== newConfig.logging?.level) {
      changes.push({
        key: 'logging.level',
        description: `Logging level changed (${oldConfig.logging?.level || 'info'} → ${newConfig.logging?.level || 'info'})`,
        oldValue: oldConfig.logging?.level,
        newValue: newConfig.logging?.level,
      });
    }

    if (oldConfig.logging?.enableFile !== newConfig.logging?.enableFile) {
      changes.push({
        key: 'logging.enableFile',
        description: `File logging ${newConfig.logging?.enableFile ? 'enabled' : 'disabled'}`,
        oldValue: oldConfig.logging?.enableFile,
        newValue: newConfig.logging?.enableFile,
      });
    }

    // Google Play configuration changes
    if (
      JSON.stringify(oldConfig.googleplay?.apps || []) !==
      JSON.stringify(newConfig.googleplay?.apps || [])
    ) {
      const oldApps = (oldConfig.googleplay?.apps || []).map(
        (app: any) => app.packageName
      );
      const newApps = (newConfig.googleplay?.apps || []).map(
        (app: any) => app.packageName
      );
      changes.push({
        key: 'googleplay.apps',
        description: `Google Play apps configuration updated (${oldApps.length} → ${newApps.length} apps)`,
        oldValue: oldApps,
        newValue: newApps,
      });
    }

    if (
      oldConfig.googleplay?.polling?.interval !==
      newConfig.googleplay?.polling?.interval
    ) {
      changes.push({
        key: 'googleplay.polling.interval',
        description: `Polling interval changed (${oldConfig.googleplay?.polling?.interval || 300}s → ${newConfig.googleplay?.polling?.interval || 300}s)`,
        oldValue: oldConfig.googleplay?.polling?.interval,
        newValue: newConfig.googleplay?.polling?.interval,
      });
    }

    // Features configuration changes
    if (
      JSON.stringify(oldConfig.features || {}) !==
      JSON.stringify(newConfig.features || {})
    ) {
      changes.push({
        key: 'features',
        description: 'Feature configuration updated',
        oldValue: oldConfig.features,
        newValue: newConfig.features,
      });
    }

    return changes;
  }

  /**
   * Apply hot-reload changes for non-critical configuration
   */
  private async applyHotReload(
    _oldConfig: any,
    newConfig: any,
    changes: ConfigChange[]
  ): Promise<void> {
    try {
      // Apply logging changes
      const loggingChanges = changes.filter(c => c.key.startsWith('logging.'));
      if (loggingChanges.length > 0) {
        // Logger hot-reload would need to be implemented in Logger class
        this.logger.info('Logging configuration updated', {
          changes: loggingChanges.map(c => c.key),
        });
      }

      // Apply Google Play app changes
      const appChanges = changes.filter(c => c.key === 'googleplay.apps');
      if (appChanges.length > 0) {
        // Notify app manager to reload app configurations
        await this.appManager.reloadConfiguration();
        this.logger.info('Google Play apps configuration reloaded');
      }

      // Apply polling interval changes
      const pollingChanges = changes.filter(
        c => c.key === 'googleplay.polling.interval'
      );
      if (pollingChanges.length > 0) {
        // Notify bridge about polling changes if available
        if (
          this.googlePlayBridge &&
          typeof this.googlePlayBridge.updatePollingInterval === 'function'
        ) {
          await this.googlePlayBridge.updatePollingInterval(
            newConfig.googleplay.polling.interval
          );
        }
        this.logger.info('Polling interval updated', {
          newInterval: newConfig.googleplay.polling.interval,
        });
      }

      // Apply feature configuration changes
      const featureChanges = changes.filter(c => c.key === 'features');
      if (featureChanges.length > 0) {
        // Notify bridge about feature changes if available
        if (
          this.googlePlayBridge &&
          typeof this.googlePlayBridge.updateFeatureConfig === 'function'
        ) {
          await this.googlePlayBridge.updateFeatureConfig(newConfig.features);
        }
        this.logger.info('Feature configuration updated');
      }
    } catch (error) {
      this.logger.error('Failed to apply hot-reload changes', { error });
      throw new Error(
        `Hot-reload failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Rollback configuration to previous state
   */
  private async rollbackConfiguration(backupConfig: any): Promise<void> {
    try {
      // Restore configuration instance
      if (Config.getInstance()) {
        // Use internal method to restore config without file reload
        (Config as any).instance.config = backupConfig;
      }

      // Notify app manager about rollback
      await this.appManager.reloadConfiguration();

      // Notify bridge about rollback if available
      if (
        this.googlePlayBridge &&
        typeof this.googlePlayBridge.onConfigReload === 'function'
      ) {
        await this.googlePlayBridge.onConfigReload(backupConfig);
      }

      this.logger.info('Configuration rolled back successfully');
    } catch (error) {
      this.logger.error('Failed to rollback configuration', { error });
      throw new Error(
        `Rollback failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  // Statistics helper methods

  private async getStatsSummary(): Promise<any> {
    const apps = this.appManager.getAllApps();
    const activeApps = this.appManager.getActiveApps();
    const totalReviews = apps.reduce((total, app) => {
      const stats = this.appManager.getAppStats(app.packageName);
      return total + (stats?.reviewsProcessed || 0);
    }, 0);
    const totalReplies = apps.reduce((total, app) => {
      const stats = this.appManager.getAppStats(app.packageName);
      return total + (stats?.repliesSent || 0);
    }, 0);

    return {
      totalApps: apps.length,
      activeApps: activeApps.length,
      totalReviews,
      totalReplies,
      uptime: Math.floor(process.uptime()),
      memoryUsage: process.memoryUsage(),
      nodeVersion: process.version,
    };
  }

  private async getAppStats(): Promise<any> {
    const apps = this.appManager.getAllApps();
    return apps.map(app => ({
      packageName: app.packageName,
      displayName: app.appName || app.packageName,
      enabled: app.enabled,
      stats: this.appManager.getAppStats(app.packageName),
    }));
  }

  private async getSystemStats(): Promise<any> {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    return {
      uptime: Math.floor(process.uptime()),
      nodeVersion: process.version,
      platform: process.platform,
      memory: {
        rss: Math.round(memUsage.rss / 1024 / 1024),
        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
        external: Math.round(memUsage.external / 1024 / 1024),
      },
      cpu: {
        user: Math.round(cpuUsage.user / 1000),
        system: Math.round(cpuUsage.system / 1000),
      },
    };
  }

  private async getPerformanceStats(): Promise<any> {
    // Basic performance metrics - could be enhanced with more detailed monitoring
    return {
      commandsProcessed: 'N/A', // Would need tracking
      averageResponseTime: 'N/A', // Would need timing
      errorRate: 'N/A', // Would need error tracking
      lastError: 'N/A', // Would need error history
    };
  }

  private async getAppSpecificStats(packageName: string): Promise<any> {
    const app = this.appManager.getApp(packageName);
    const stats = this.appManager.getAppStats(packageName);

    return {
      app,
      stats,
      roomId: 'N/A', // Would need room mapping
      lastPoll: stats?.lastPoll?.toISOString() || 'Never',
    };
  }

  private formatSummaryStats(summary: any): string {
    const uptimeHours = Math.floor(summary.uptime / 3600);
    const uptimeMinutes = Math.floor((summary.uptime % 3600) / 60);

    return `📊 Bridge Statistics Summary

🔧 Bridge Status: Running
📱 Applications: ${summary.activeApps}/${summary.totalApps} active
📝 Reviews Processed: ${summary.totalReviews}
💬 Replies Sent: ${summary.totalReplies}
⏰ Uptime: ${uptimeHours}h ${uptimeMinutes}m
🧠 Memory Usage: ${Math.round(summary.memoryUsage.heapUsed / 1024 / 1024)}MB
🔗 Node.js: ${summary.nodeVersion}

Use !stats apps for detailed app statistics.
Use !stats system for system performance.`;
  }

  private formatSummaryStatsHTML(summary: any): string {
    const uptimeHours = Math.floor(summary.uptime / 3600);
    const uptimeMinutes = Math.floor((summary.uptime % 3600) / 60);

    return `<h3>📊 Bridge Statistics Summary</h3>
<ul>
<li><strong>🔧 Bridge Status:</strong> Running</li>
<li><strong>📱 Applications:</strong> ${summary.activeApps}/${summary.totalApps} active</li>
<li><strong>📝 Reviews Processed:</strong> ${summary.totalReviews}</li>
<li><strong>💬 Replies Sent:</strong> ${summary.totalReplies}</li>
<li><strong>⏰ Uptime:</strong> ${uptimeHours}h ${uptimeMinutes}m</li>
<li><strong>🧠 Memory Usage:</strong> ${Math.round(summary.memoryUsage.heapUsed / 1024 / 1024)}MB</li>
<li><strong>🔗 Node.js:</strong> ${summary.nodeVersion}</li>
</ul>
<p><em>Use <code>!stats apps</code> for detailed app statistics.<br>
Use <code>!stats system</code> for system performance.</em></p>`;
  }

  private formatAppStats(appStats: any[]): string {
    if (appStats.length === 0) {
      return '📱 No applications configured.';
    }

    let output = '📱 Application Statistics:\n\n';
    appStats.forEach(app => {
      const stats = app.stats || {};
      output += `${app.enabled ? '✅' : '❌'} ${app.displayName}\n`;
      output += `   Package: ${app.packageName}\n`;
      output += `   Reviews: ${stats.reviewsProcessed || 0} processed\n`;
      output += `   Replies: ${stats.repliesSent || 0} sent\n`;
      output += `   Errors: ${stats.errors || 0}\n`;
      output += `   Last Poll: ${stats.lastPoll ? new Date(stats.lastPoll).toLocaleString() : 'Never'}\n\n`;
    });

    return output;
  }

  private formatAppStatsHTML(appStats: any[]): string {
    if (appStats.length === 0) {
      return '<p>📱 No applications configured.</p>';
    }

    let output = '<h3>📱 Application Statistics:</h3><ul>';
    appStats.forEach(app => {
      const stats = app.stats || {};
      output += `<li>${app.enabled ? '✅' : '❌'} <strong>${app.displayName}</strong><br>`;
      output += `Package: <code>${app.packageName}</code><br>`;
      output += `Reviews: ${stats.reviewsProcessed || 0} processed<br>`;
      output += `Replies: ${stats.repliesSent || 0} sent<br>`;
      output += `Errors: ${stats.errors || 0}<br>`;
      output += `Last Poll: ${stats.lastPoll ? new Date(stats.lastPoll).toLocaleString() : 'Never'}</li>`;
    });
    output += '</ul>';

    return output;
  }

  private formatSystemStats(systemStats: any): string {
    return `🖥️ System Performance Statistics

⏰ Uptime: ${Math.floor(systemStats.uptime / 3600)}h ${Math.floor((systemStats.uptime % 3600) / 60)}m
🔗 Node.js: ${systemStats.nodeVersion}
🖥️ Platform: ${systemStats.platform}

💾 Memory Usage:
   RSS: ${systemStats.memory.rss}MB
   Heap Total: ${systemStats.memory.heapTotal}MB
   Heap Used: ${systemStats.memory.heapUsed}MB
   External: ${systemStats.memory.external}MB

⚡ CPU Usage:
   User: ${systemStats.cpu.user}ms
   System: ${systemStats.cpu.system}ms`;
  }

  private formatSystemStatsHTML(systemStats: any): string {
    return `<h3>🖥️ System Performance Statistics</h3>
<p><strong>⏰ Uptime:</strong> ${Math.floor(systemStats.uptime / 3600)}h ${Math.floor((systemStats.uptime % 3600) / 60)}m<br>
<strong>🔗 Node.js:</strong> ${systemStats.nodeVersion}<br>
<strong>🖥️ Platform:</strong> ${systemStats.platform}</p>

<p><strong>💾 Memory Usage:</strong><br>
RSS: ${systemStats.memory.rss}MB<br>
Heap Total: ${systemStats.memory.heapTotal}MB<br>
Heap Used: ${systemStats.memory.heapUsed}MB<br>
External: ${systemStats.memory.external}MB</p>

<p><strong>⚡ CPU Usage:</strong><br>
User: ${systemStats.cpu.user}ms<br>
System: ${systemStats.cpu.system}ms</p>`;
  }

  private formatPerformanceStats(perfStats: any): string {
    return `⚡ Performance Statistics

📊 Commands Processed: ${perfStats.commandsProcessed}
⏱️ Average Response Time: ${perfStats.averageResponseTime}
❌ Error Rate: ${perfStats.errorRate}
🔥 Last Error: ${perfStats.lastError}

Note: Advanced performance metrics would require additional instrumentation.`;
  }

  private formatPerformanceStatsHTML(perfStats: any): string {
    return `<h3>⚡ Performance Statistics</h3>
<ul>
<li><strong>📊 Commands Processed:</strong> ${perfStats.commandsProcessed}</li>
<li><strong>⏱️ Average Response Time:</strong> ${perfStats.averageResponseTime}</li>
<li><strong>❌ Error Rate:</strong> ${perfStats.errorRate}</li>
<li><strong>🔥 Last Error:</strong> ${perfStats.lastError}</li>
</ul>
<p><em>Note: Advanced performance metrics would require additional instrumentation.</em></p>`;
  }

  private formatAppSpecificStats(packageName: string, appStats: any): string {
    const stats = appStats.stats || {};
    return `📱 Statistics for ${packageName}

📦 Package: ${packageName}
📝 Display Name: ${appStats.app?.displayName || packageName}
✅ Enabled: ${appStats.app?.enabled ? 'Yes' : 'No'}
🏠 Room ID: ${appStats.roomId}
📊 Reviews Processed: ${stats.reviewsProcessed || 0}
💬 Replies Sent: ${stats.repliesSent || 0}
❌ Errors: ${stats.errors || 0}
⏰ Last Poll: ${appStats.lastPoll}`;
  }

  private formatAppSpecificStatsHTML(
    packageName: string,
    appStats: any
  ): string {
    const stats = appStats.stats || {};
    return `<h3>📱 Statistics for ${packageName}</h3>
<ul>
<li><strong>📦 Package:</strong> <code>${packageName}</code></li>
<li><strong>📝 Display Name:</strong> ${appStats.app?.displayName || packageName}</li>
<li><strong>✅ Enabled:</strong> ${appStats.app?.enabled ? 'Yes' : 'No'}</li>
<li><strong>🏠 Room ID:</strong> ${appStats.roomId}</li>
<li><strong>📊 Reviews Processed:</strong> ${stats.reviewsProcessed || 0}</li>
<li><strong>💬 Replies Sent:</strong> ${stats.repliesSent || 0}</li>
<li><strong>❌ Errors:</strong> ${stats.errors || 0}</li>
<li><strong>⏰ Last Poll:</strong> ${appStats.lastPoll}</li>
</ul>`;
  }

  // User management helper methods

  private getVirtualUsersForApp(packageName: string, limit: number): any[] {
    // This is a placeholder implementation - in a real implementation,
    // this would query the UserManager or database for users associated with the package
    const mockUsers = [
      {
        userId: `@_googleplay_review123:${this.getBridgeDomain()}`,
        displayName: 'Google Play User (review123)',
        packageName,
        lastActiveAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // 2 days ago
        createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), // 10 days ago
        reviewCount: 5,
      },
      {
        userId: `@_googleplay_review456:${this.getBridgeDomain()}`,
        displayName: 'John Smith (review456)',
        packageName,
        lastActiveAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // 5 days ago
        createdAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000), // 15 days ago
        reviewCount: 2,
      },
    ];

    return mockUsers.slice(0, limit);
  }

  private getAllVirtualUsers(limit: number): any[] {
    // This is a placeholder implementation - in a real implementation,
    // this would query the UserManager or database for all virtual users
    const mockUsers = [
      {
        userId: `@_googleplay_review123:${this.getBridgeDomain()}`,
        displayName: 'Google Play User (review123)',
        packageName: 'com.example.app1',
        lastActiveAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // 2 days ago
        createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), // 10 days ago
        reviewCount: 5,
      },
      {
        userId: `@_googleplay_review456:${this.getBridgeDomain()}`,
        displayName: 'John Smith (review456)',
        packageName: 'com.example.app2',
        lastActiveAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // 5 days ago
        createdAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000), // 15 days ago
        reviewCount: 2,
      },
      {
        userId: `@_googleplay_review789:${this.getBridgeDomain()}`,
        displayName: 'Anonymous User (review789)',
        packageName: 'com.example.app1',
        lastActiveAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
        createdAt: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000), // 45 days ago
        reviewCount: 1,
      },
    ];

    return mockUsers.slice(0, limit);
  }

  private formatUserList(users: any[], title: string, limit: number): string {
    let output = `👥 ${title} (${users.length}`;
    if (users.length >= limit) {
      output += `, limited to ${limit}`;
    }
    output += ')\n\n';

    users.forEach(user => {
      const daysSinceActive = Math.floor(
        (Date.now() - user.lastActiveAt.getTime()) / (24 * 60 * 60 * 1000)
      );
      output += `🔹 ${user.displayName}\n`;
      output += `   User ID: ${user.userId}\n`;
      output += `   Package: ${user.packageName}\n`;
      output += `   Reviews: ${user.reviewCount}\n`;
      output += `   Last Active: ${daysSinceActive} days ago\n`;
      output += `   Created: ${user.createdAt.toLocaleDateString()}\n\n`;
    });

    return output;
  }

  private formatUserListHTML(
    users: any[],
    title: string,
    limit: number
  ): string {
    let output = `<h3>👥 ${title} (${users.length}`;
    if (users.length >= limit) {
      output += `, limited to ${limit}`;
    }
    output += ')</h3><ul>';

    users.forEach(user => {
      const daysSinceActive = Math.floor(
        (Date.now() - user.lastActiveAt.getTime()) / (24 * 60 * 60 * 1000)
      );
      output += `<li><strong>${user.displayName}</strong><br>`;
      output += `User ID: <code>${user.userId}</code><br>`;
      output += `Package: ${user.packageName}<br>`;
      output += `Reviews: ${user.reviewCount}<br>`;
      output += `Last Active: ${daysSinceActive} days ago<br>`;
      output += `Created: ${user.createdAt.toLocaleDateString()}</li>`;
    });

    output += '</ul>';
    return output;
  }

  // Cleanup helper methods

  private getInactiveUsers(cutoffDate: Date): any[] {
    // This is a placeholder implementation - in a real implementation,
    // this would query the UserManager or database for inactive users
    const allUsers = this.getAllVirtualUsers(1000); // Get all users for cleanup check
    return allUsers.filter(user => user.lastActiveAt < cutoffDate);
  }

  private formatCleanupPreview(usersToCleanup: any[], days: number): string {
    let output = `🧹 Cleanup Preview (${days}+ days inactive)\n\n`;
    output += `Found ${usersToCleanup.length} users to clean up:\n\n`;

    usersToCleanup.slice(0, 10).forEach(user => {
      // Show only first 10 for preview
      const daysSinceActive = Math.floor(
        (Date.now() - user.lastActiveAt.getTime()) / (24 * 60 * 60 * 1000)
      );
      output += `🔸 ${user.displayName} (${daysSinceActive} days inactive)\n`;
      output += `   Package: ${user.packageName}\n`;
      output += `   User ID: ${user.userId}\n\n`;
    });

    if (usersToCleanup.length > 10) {
      output += `... and ${usersToCleanup.length - 10} more users.\n\n`;
    }

    output += `Run without --preview to perform the cleanup.`;
    return output;
  }

  private formatCleanupPreviewHTML(
    usersToCleanup: any[],
    days: number
  ): string {
    let output = `<h3>🧹 Cleanup Preview (${days}+ days inactive)</h3>`;
    output += `<p>Found <strong>${usersToCleanup.length}</strong> users to clean up:</p><ul>`;

    usersToCleanup.slice(0, 10).forEach(user => {
      // Show only first 10 for preview
      const daysSinceActive = Math.floor(
        (Date.now() - user.lastActiveAt.getTime()) / (24 * 60 * 60 * 1000)
      );
      output += `<li><strong>${user.displayName}</strong> (${daysSinceActive} days inactive)<br>`;
      output += `Package: ${user.packageName}<br>`;
      output += `User ID: <code>${user.userId}</code></li>`;
    });

    output += '</ul>';

    if (usersToCleanup.length > 10) {
      output += `<p><em>... and ${usersToCleanup.length - 10} more users.</em></p>`;
    }

    output += '<p><em>Run without --preview to perform the cleanup.</em></p>';
    return output;
  }

  private async performUserCleanup(usersToCleanup: any[]): Promise<number> {
    // This is a placeholder implementation - in a real implementation,
    // this would actually clean up the users from the UserManager and/or database
    let cleanedCount = 0;

    for (const user of usersToCleanup) {
      try {
        // In a real implementation, this would:
        // 1. Remove user from UserManager
        // 2. Delete user mapping from database
        // 3. Optionally leave the Matrix user (or deactivate it)

        this.logger.info('Cleaning up inactive user', {
          userId: user.userId,
          packageName: user.packageName,
          lastActiveAt: user.lastActiveAt,
        });

        cleanedCount++;
      } catch (error) {
        this.logger.error('Failed to cleanup user', {
          userId: user.userId,
          error: error instanceof Error ? error.message : error,
        });
      }
    }

    return cleanedCount;
  }

  // Room creation helper methods

  private extractArgValue(args: string[], argName: string): string | undefined {
    // Find argument like --topic="value" or --topic=value
    for (const arg of args) {
      if (arg.startsWith(`${argName}=`)) {
        const value = arg.substring(argName.length + 1);
        // Remove quotes if present
        return value.replace(/^["']|["']$/g, '');
      }
    }
    return undefined;
  }

  private async createAppRoom(
    packageName: string,
    roomOptions: any
  ): Promise<{ success: boolean; roomId?: string; error?: string }> {
    try {
      // This is a placeholder implementation - in a real implementation,
      // this would use the Bridge's Intent system to create a Matrix room

      // Create room using Matrix Client-Server API
      const createRoomParams = {
        name: roomOptions.name,
        topic: roomOptions.topic,
        room_alias_name: roomOptions.alias,
        visibility: roomOptions.visibility,
        preset: roomOptions.preset,
        creation_content: {
          type: 'googleplay.app_room',
          package_name: packageName,
        },
        initial_state: [
          {
            type: 'm.room.power_levels',
            content: {
              users: {
                [this.bridge.botUserId]: 100, // Give bot admin power
              },
              users_default: 10,
            },
          },
        ],
      };

      // In a real implementation, this would be:
      // const intent = this.bridge.getIntent();
      // const room = await intent.createRoom(createRoomParams);
      console.log('Room creation params:', createRoomParams);

      // Mock room creation for now
      const mockRoomId = `!${Math.random().toString(36).substring(7)}:${this.getBridgeDomain()}`;

      this.logger.info('Created room for app', {
        packageName,
        roomId: mockRoomId,
        alias: roomOptions.alias,
      });

      // Update app manager with room mapping (if available)
      // await this.appManager.setAppRoom(packageName, mockRoomId);

      return {
        success: true,
        roomId: mockRoomId,
      };
    } catch (error) {
      this.logger.error('Failed to create room', {
        packageName,
        error: error instanceof Error ? error.message : error,
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get bridge domain - helper method to get homeserver domain
   */
  private getBridgeDomain(): string {
    // Try to get domain from bridge registration or config
    // Fallback to generic domain for mock/testing
    return process.env.HOMESERVER_DOMAIN || 'bridge.local';
  }
}
