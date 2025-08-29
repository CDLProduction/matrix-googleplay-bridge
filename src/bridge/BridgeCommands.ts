import { Logger } from '../utils/Logger';
import { Config } from '../utils/Config';
import { AuditLogger } from '../utils/AuditLogger';
import { GooglePlayApp } from '../models/Config';
import { AppManager } from '../managers/AppManager';
import { Bridge } from 'matrix-appservice-bridge';

export interface CommandContext {
  roomId: string;
  userId: string;
  message: string;
  args: string[];
}

export interface CommandResult {
  success: boolean;
  message: string;
  htmlMessage?: string;
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

  constructor(
    private readonly bridge: Bridge,
    private readonly appManager: AppManager,
    private readonly googlePlayBridge?: any, // GooglePlayBridge type to avoid circular dependency
    adminUsers: string[] = []
  ) {
    this.logger = Logger.getInstance().setComponent('BridgeCommands');
    this.auditLogger = AuditLogger.getInstance();
    this.adminUsers = new Set(adminUsers);
    this.registerCommands();
  }

  public async handleMessage(roomId: string, userId: string, message: string): Promise<void> {
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
            args: parts.slice(1)
          });
        }
      } else if (matches.length > 1) {
        await this.sendResponse(roomId, {
          success: false,
          message: `Ambiguous command "${commandName}". Did you mean: ${matches.join(', ')}?`
        });
      } else {
        await this.sendResponse(roomId, {
          success: false,
          message: `Unknown command "${commandName}". Use !help to see available commands.`
        });
      }
      return;
    }

    await this.executeCommand(command, {
      roomId,
      userId,
      message: trimmed,
      args: parts.slice(1)
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

  private async executeCommand(command: Command, context: CommandContext): Promise<void> {
    if (command.adminOnly && !this.isAdmin(context.userId)) {
      await this.sendResponse(context.roomId, {
        success: false,
        message: 'This command requires administrator privileges.'
      });
      return;
    }

    try {
      this.logger.info(`Executing command "${command.name}" from user ${context.userId}`);
      const result = await command.handler(context);
      await this.sendResponse(context.roomId, result);
    } catch (error) {
      this.logger.error(`Command "${command.name}" failed:`, error);
      await this.sendResponse(context.roomId, {
        success: false,
        message: `Command failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
    }
  }

  private async sendResponse(roomId: string, result: CommandResult): Promise<void> {
    const intent = this.bridge.getIntent();
    
    const content: any = {
      msgtype: 'm.text',
      body: result.message
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
      handler: async (context) => this.handleHelp(context)
    });

    // App management commands
    this.commands.set('apps', {
      name: 'apps',
      description: 'List all configured apps',
      usage: '!apps [--active|--inactive]',
      adminOnly: false,
      handler: async (context) => this.handleListApps(context)
    });

    this.commands.set('app', {
      name: 'app',
      description: 'Show app details',
      usage: '!app <package-name>',
      adminOnly: false,
      handler: async (context) => this.handleShowApp(context)
    });

    this.commands.set('addapp', {
      name: 'addapp',
      description: 'Add a new app configuration',
      usage: '!addapp <package-name> <room-id> [app-name]',
      adminOnly: true,
      handler: async (context) => this.handleAddApp(context)
    });

    this.commands.set('removeapp', {
      name: 'removeapp',
      description: 'Remove an app configuration',
      usage: '!removeapp <package-name>',
      adminOnly: true,
      handler: async (context) => this.handleRemoveApp(context)
    });

    this.commands.set('enableapp', {
      name: 'enableapp',
      description: 'Enable an app',
      usage: '!enableapp <package-name>',
      adminOnly: true,
      handler: async (context) => this.handleEnableApp(context)
    });

    this.commands.set('disableapp', {
      name: 'disableapp',
      description: 'Disable an app',
      usage: '!disableapp <package-name>',
      adminOnly: true,
      handler: async (context) => this.handleDisableApp(context)
    });

    this.commands.set('updateapp', {
      name: 'updateapp',
      description: 'Update app configuration',
      usage: '!updateapp <package-name> <key>=<value> [key2=value2...]',
      adminOnly: true,
      handler: async (context) => this.handleUpdateApp(context)
    });

    // Statistics and monitoring
    this.commands.set('stats', {
      name: 'stats',
      description: 'Show bridge statistics',
      usage: '!stats [app-name]',
      adminOnly: false,
      handler: async (context) => this.handleStats(context)
    });

    this.commands.set('status', {
      name: 'status',
      description: 'Show bridge status',
      usage: '!status',
      adminOnly: false,
      handler: async (context) => this.handleStatus(context)
    });

    // Room management
    this.commands.set('createroom', {
      name: 'createroom',
      description: 'Create a room for an app',
      usage: '!createroom <package-name>',
      adminOnly: true,
      handler: async (context) => this.handleCreateRoom(context)
    });

    // User management
    this.commands.set('users', {
      name: 'users',
      description: 'List virtual users',
      usage: '!users [package-name]',
      adminOnly: true,
      handler: async (context) => this.handleListUsers(context)
    });

    this.commands.set('cleanup', {
      name: 'cleanup',
      description: 'Clean up inactive users',
      usage: '!cleanup [days]',
      adminOnly: true,
      handler: async (context) => this.handleCleanup(context)
    });

    // Phase 4.2 Feature commands
    this.commands.set('features', {
      name: 'features',
      description: 'Show Phase 4.2 feature status',
      usage: '!features',
      adminOnly: false,
      handler: async (context) => this.handleFeatures(context)
    });

    this.commands.set('categorize', {
      name: 'categorize',
      description: 'Categorize a review text (test categorization)',
      usage: '!categorize <review-text>',
      adminOnly: false,
      handler: async (context) => this.handleCategorize(context)
    });

    this.commands.set('suggest', {
      name: 'suggest',
      description: 'Get response suggestions for a review',
      usage: '!suggest <review-text> <rating>',
      adminOnly: false,
      handler: async (context) => this.handleSuggest(context)
    });

    this.commands.set('templates', {
      name: 'templates',
      description: 'Manage message templates',
      usage: '!templates [list|stats|search <query>]',
      adminOnly: false,
      handler: async (context) => this.handleTemplates(context)
    });

    this.commands.set('threads', {
      name: 'threads',
      description: 'Manage message threads',
      usage: '!threads [list|stats|resolve <thread-id>]',
      adminOnly: false,
      handler: async (context) => this.handleThreads(context)
    });

    // Configuration and maintenance commands (Phase 4.3)
    this.commands.set('reloadconfig', {
      name: 'reloadconfig',
      description: 'Reload configuration without restart',
      usage: '!reloadconfig',
      adminOnly: true,
      handler: async (context) => this.handleReloadConfig(context)
    });

    this.commands.set('maintenance', {
      name: 'maintenance',
      description: 'Enter or exit maintenance mode',
      usage: '!maintenance [on|off|status]',
      adminOnly: true,
      handler: async (context) => this.handleMaintenance(context)
    });

    this.commands.set('audit', {
      name: 'audit',
      description: 'Show audit log entries',
      usage: '!audit [limit] [filter]',
      adminOnly: true,
      handler: async (context) => this.handleAudit(context)
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
          message: `Unknown command "${commandName}".`
        };
      }

      return {
        success: true,
        message: `${command.name}: ${command.description}\nUsage: ${command.usage}${command.adminOnly ? ' (Admin only)' : ''}`,
        htmlMessage: `<strong>${command.name}</strong>: ${command.description}<br>Usage: <code>${command.usage}</code>${command.adminOnly ? '<br><em>Admin only</em>' : ''}`
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
      htmlMessage: `<strong>Available commands:</strong><br>${htmlCommandList}<br><br>Use <code>!help &lt;command&gt;</code> for detailed usage.`
    };
  }

  private async handleListApps(context: CommandContext): Promise<CommandResult> {
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
        message: 'No apps configured.'
      };
    }

    const appList = apps.map((app, index) => {
      const status = app.enabled !== false ? '✅ Active' : '❌ Inactive';
      const stats = this.appManager.getAppStats(app.packageName);
      return `${index + 1}. ${app.appName || app.packageName} (${app.packageName})\n   Status: ${status}\n   Room: ${app.matrixRoom}\n   Reviews: ${stats?.reviewsProcessed || 0}, Replies: ${stats?.repliesSent || 0}`;
    }).join('\n\n');

    const htmlAppList = apps.map((app, index) => {
      const status = app.enabled !== false ? '<span style="color: green">✅ Active</span>' : '<span style="color: red">❌ Inactive</span>';
      const stats = this.appManager.getAppStats(app.packageName);
      return `<strong>${index + 1}. ${app.appName || app.packageName}</strong> (<code>${app.packageName}</code>)<br>&nbsp;&nbsp;&nbsp;&nbsp;Status: ${status}<br>&nbsp;&nbsp;&nbsp;&nbsp;Room: ${app.matrixRoom}<br>&nbsp;&nbsp;&nbsp;&nbsp;Reviews: ${stats?.reviewsProcessed || 0}, Replies: ${stats?.repliesSent || 0}`;
    }).join('<br><br>');

    return {
      success: true,
      message: `Configured apps (${apps.length}):\n\n${appList}`,
      htmlMessage: `<strong>Configured apps (${apps.length}):</strong><br><br>${htmlAppList}`
    };
  }

  private async handleShowApp(context: CommandContext): Promise<CommandResult> {
    const { args } = context;
    
    if (args.length === 0) {
      return {
        success: false,
        message: 'Usage: !app <package-name>'
      };
    }

    const packageName = args[0]!;
    const app = this.appManager.getApp(packageName);
    
    if (!app) {
      return {
        success: false,
        message: `App "${packageName}" not found.`
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
      `  Last Poll: ${stats?.lastPoll ? stats.lastPoll.toISOString() : 'Never'}`
    ].join('\n');

    return {
      success: true,
      message: details
    };
  }

  private async handleAddApp(context: CommandContext): Promise<CommandResult> {
    const { args } = context;
    
    if (args.length < 2) {
      return {
        success: false,
        message: 'Usage: !addapp <package-name> <room-id> [app-name]'
      };
    }

    const [packageName, roomId, appName] = args;
    
    if (!packageName || !roomId) {
      return {
        success: false,
        message: 'Package name and room ID are required.'
      };
    }

    try {
      const app: GooglePlayApp = {
        packageName,
        matrixRoom: roomId,
        ...(appName && { appName }),
        enabled: true,
        autoCreateRoom: false
      };

      await this.appManager.addApp(app);
      
      return {
        success: true,
        message: `Successfully added app "${packageName}" with room "${roomId}".`
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to add app: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  private async handleRemoveApp(context: CommandContext): Promise<CommandResult> {
    const { args } = context;
    
    if (args.length === 0) {
      return {
        success: false,
        message: 'Usage: !removeapp <package-name>'
      };
    }

    const packageName = args[0]!;
    
    try {
      await this.appManager.removeApp(packageName);
      
      return {
        success: true,
        message: `Successfully removed app "${packageName}".`
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to remove app: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  private async handleEnableApp(context: CommandContext): Promise<CommandResult> {
    const { args } = context;
    
    if (args.length === 0) {
      return {
        success: false,
        message: 'Usage: !enableapp <package-name>'
      };
    }

    const packageName = args[0]!;
    
    try {
      await this.appManager.enableApp(packageName);
      
      return {
        success: true,
        message: `Successfully enabled app "${packageName}".`
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to enable app: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  private async handleDisableApp(context: CommandContext): Promise<CommandResult> {
    const { args } = context;
    
    if (args.length === 0) {
      return {
        success: false,
        message: 'Usage: !disableapp <package-name>'
      };
    }

    const packageName = args[0]!;
    
    try {
      await this.appManager.disableApp(packageName);
      
      return {
        success: true,
        message: `Successfully disabled app "${packageName}".`
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to disable app: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  private async handleUpdateApp(context: CommandContext): Promise<CommandResult> {
    const { args } = context;
    
    if (args.length < 2) {
      return {
        success: false,
        message: 'Usage: !updateapp <package-name> <key>=<value> [key2=value2...]'
      };
    }

    const packageName = args[0]!;
    const updates: Partial<GooglePlayApp> = {};

    for (let i = 1; i < args.length; i++) {
      const pair = args[i];
      if (!pair?.includes('=')) {
        return {
          success: false,
          message: `Invalid update format: "${pair}". Use key=value format.`
        };
      }

      const [key, value] = pair.split('=', 2);
      if (!key || value === undefined) {
        return {
          success: false,
          message: `Invalid update format: "${pair}".`
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
            message: `Unknown update key: "${key}"`
          };
      }
    }

    try {
      await this.appManager.updateApp(packageName, updates);
      
      const updatedKeys = Object.keys(updates).join(', ');
      return {
        success: true,
        message: `Successfully updated app "${packageName}". Updated: ${updatedKeys}`
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to update app: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  private async handleStats(_context: CommandContext): Promise<CommandResult> {
    // Implementation would show detailed statistics
    return {
      success: true,
      message: 'Statistics command not yet implemented.'
    };
  }

  private async handleStatus(_context: CommandContext): Promise<CommandResult> {
    const activeApps = this.appManager.getActiveApps().length;
    const totalApps = this.appManager.getAllApps().length;
    
    return {
      success: true,
      message: `Bridge Status: Running\nApps: ${activeApps}/${totalApps} active\nUptime: ${process.uptime()}s`
    };
  }

  private async handleCreateRoom(_context: CommandContext): Promise<CommandResult> {
    // Implementation would create a room for an app
    return {
      success: true,
      message: 'Create room command not yet implemented.'
    };
  }

  private async handleListUsers(_context: CommandContext): Promise<CommandResult> {
    // Implementation would list virtual users
    return {
      success: true,
      message: 'List users command not yet implemented.'
    };
  }

  private async handleCleanup(_context: CommandContext): Promise<CommandResult> {
    // Implementation would clean up inactive users
    return {
      success: true,
      message: 'Cleanup command not yet implemented.'
    };
  }

  // Phase 4.2 Feature command handlers
  private async handleFeatures(_context: CommandContext): Promise<CommandResult> {
    if (!this.googlePlayBridge) {
      return {
        success: false,
        message: 'Bridge features not available'
      };
    }

    try {
      const featuresStatus = this.googlePlayBridge.getFeaturesStatus();
      const lines = [
        '**Phase 4.2 Advanced Features Status:**',
        `• Review Categorization: ${featuresStatus.categorization ? '✅ Enabled' : '❌ Disabled'}`,
        `• Response Suggestions: ${featuresStatus.responseSuggestions ? '✅ Enabled' : '❌ Disabled'}`,
        `• Message Templates: ${featuresStatus.messageTemplates ? '✅ Enabled' : '❌ Disabled'}`,
        `• Message Threading: ${featuresStatus.messageThreading ? '✅ Enabled' : '❌ Disabled'}`
      ];

      return {
        success: true,
        message: lines.join('\n')
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to get feature status: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  private async handleCategorize(context: CommandContext): Promise<CommandResult> {
    if (!this.googlePlayBridge) {
      return {
        success: false,
        message: 'Categorization feature not available'
      };
    }

    const categorization = this.googlePlayBridge.getReviewCategorization();
    if (!categorization) {
      return {
        success: false,
        message: 'Review categorization not enabled'
      };
    }

    const { args } = context;
    if (args.length === 0) {
      return {
        success: false,
        message: 'Usage: !categorize <review-text>'
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
        lastModified: new Date()
      });

      const lines = [
        `**Review Categorization Result:**`,
        `Primary: ${result.primaryCategory?.category.name} (${(result.primaryCategory?.confidence * 100).toFixed(1)}%)`,
        `Sentiment: ${result.sentiment}`,
        `Urgency: ${result.urgency}`,
        `Categories: ${result.secondaryCategories.map((c: any) => `${c.category.name} (${(c.confidence * 100).toFixed(1)}%)`).join(', ')}`
      ];

      return {
        success: true,
        message: lines.join('\n')
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to categorize review: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  private async handleSuggest(context: CommandContext): Promise<CommandResult> {
    if (!this.googlePlayBridge) {
      return {
        success: false,
        message: 'Response suggestions feature not available'
      };
    }

    const responseSuggestions = this.googlePlayBridge.getResponseSuggestions();
    const categorization = this.googlePlayBridge.getReviewCategorization();
    
    if (!responseSuggestions || !categorization) {
      return {
        success: false,
        message: 'Response suggestions or categorization not enabled'
      };
    }

    const { args } = context;
    if (args.length < 2) {
      return {
        success: false,
        message: 'Usage: !suggest <review-text> <rating>'
      };
    }

    const rating = parseInt(args[args.length - 1] || '0');
    const reviewText = args.slice(0, -1).join(' ');

    if (isNaN(rating) || rating < 1 || rating > 5) {
      return {
        success: false,
        message: 'Rating must be a number between 1 and 5'
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
        lastModified: new Date()
      };

      const categorizationResult = await categorization.categorizeReview(review);
      const suggestions = await responseSuggestions.generateSuggestions({
        review,
        categorization: categorizationResult,
        appName: 'Test App',
        supportEmail: 'support@company.com'
      });

      if (suggestions.length === 0) {
        return {
          success: true,
          message: 'No response suggestions found for this review.'
        };
      }

      const lines = ['**Response Suggestions:**'];
      suggestions.forEach((suggestion: any, index: number) => {
        lines.push(`\n**${index + 1}. ${suggestion.template.name}** (${(suggestion.confidence * 100).toFixed(1)}% confidence)`);
        lines.push(suggestion.renderedText);
      });

      return {
        success: true,
        message: lines.join('\n')
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to generate suggestions: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  private async handleTemplates(context: CommandContext): Promise<CommandResult> {
    if (!this.googlePlayBridge) {
      return {
        success: false,
        message: 'Templates feature not available'
      };
    }

    const messageTemplates = this.googlePlayBridge.getMessageTemplates();
    if (!messageTemplates) {
      return {
        success: false,
        message: 'Message templates not enabled'
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
              message: 'No templates found.'
            };
          }

          const lines = ['**Available Templates:**'];
          templates.forEach((template: any) => {
            lines.push(`• ${template.name} (${template.id}) - ${template.category}`);
          });

          return {
            success: true,
            message: lines.join('\n')
          };
        }

        case 'stats': {
          const stats = messageTemplates.getTemplateStats();
          const lines = [
            '**Template Statistics:**',
            `Total: ${stats.total}`,
            `By Category: ${Object.entries(stats.byCategory).map(([cat, count]) => `${cat}: ${count}`).join(', ')}`,
            `Most Used: ${stats.mostUsed.map((t: any) => `${t.name} (${t.usageCount})`).join(', ')}`
          ];

          return {
            success: true,
            message: lines.join('\n')
          };
        }

        case 'search': {
          if (args.length < 2) {
            return {
              success: false,
              message: 'Usage: !templates search <query>'
            };
          }

          const query = args.slice(1).join(' ');
          const results = messageTemplates.searchTemplates(query);
          
          if (results.length === 0) {
            return {
              success: true,
              message: `No templates found matching "${query}"`
            };
          }

          const lines = [`**Templates matching "${query}":**`];
          results.forEach((template: any) => {
            lines.push(`• ${template.name} - ${template.description || 'No description'}`);
          });

          return {
            success: true,
            message: lines.join('\n')
          };
        }

        default:
          return {
            success: false,
            message: 'Usage: !templates [list|stats|search <query>]'
          };
      }
    } catch (error) {
      return {
        success: false,
        message: `Failed to handle templates command: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  private async handleThreads(context: CommandContext): Promise<CommandResult> {
    if (!this.googlePlayBridge) {
      return {
        success: false,
        message: 'Threading feature not available'
      };
    }

    const messageThreading = this.googlePlayBridge.getMessageThreading();
    if (!messageThreading) {
      return {
        success: false,
        message: 'Message threading not enabled'
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
              message: 'No active threads in this room.'
            };
          }

          const lines = ['**Active Threads:**'];
          threads.forEach((thread: any) => {
            const age = Math.round((Date.now() - thread.lastActivity.getTime()) / (1000 * 60 * 60));
            lines.push(`• ${thread.threadId} - ${thread.messageCount} messages, ${age}h old (${thread.status})`);
          });

          return {
            success: true,
            message: lines.join('\n')
          };
        }

        case 'stats': {
          const stats = messageThreading.getThreadingStats();
          const lines = [
            '**Threading Statistics:**',
            `Total threads: ${stats.totalThreads}`,
            `Active: ${stats.activeThreads}, Resolved: ${stats.resolvedThreads}, Archived: ${stats.archivedThreads}`,
            `Avg messages per thread: ${stats.averageMessagesPerThread.toFixed(1)}`,
            `Avg thread lifetime: ${stats.averageThreadLifetime.toFixed(1)}h`
          ];

          return {
            success: true,
            message: lines.join('\n')
          };
        }

        case 'resolve': {
          if (args.length < 2) {
            return {
              success: false,
              message: 'Usage: !threads resolve <thread-id>'
            };
          }

          const threadId = args[1];
          await messageThreading.resolveThread(threadId, userId, 'Resolved via command');

          return {
            success: true,
            message: `Thread ${threadId} has been resolved.`
          };
        }

        default:
          return {
            success: false,
            message: 'Usage: !threads [list|stats|resolve <thread-id>]'
          };
      }
    } catch (error) {
      return {
        success: false,
        message: `Failed to handle threads command: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  // Phase 4.3 Command handlers
  private async handleReloadConfig(context: CommandContext): Promise<CommandResult> {
    try {
      this.logger.info('Reloading configuration', { 
        userId: context.userId, 
        roomId: context.roomId 
      });

      // Reload configuration
      const oldConfig = Config.getInstance().all;
      await Config.reload();
      const newConfig = Config.getInstance().all;

      // Check for critical changes that might require restart
      const criticalChanges = [];
      if (oldConfig.appservice.port !== newConfig.appservice.port) {
        criticalChanges.push('Application service port');
      }
      if (oldConfig.appservice.bind !== newConfig.appservice.bind) {
        criticalChanges.push('Application service bind address');
      }
      if (oldConfig.database.type !== newConfig.database.type) {
        criticalChanges.push('Database type');
      }

      // Notify bridge about config reload if available
      if (this.googlePlayBridge && typeof this.googlePlayBridge.onConfigReload === 'function') {
        await this.googlePlayBridge.onConfigReload(newConfig);
      }

      // Reload app manager configuration
      await this.appManager.reloadConfiguration();

      let message = 'Configuration reloaded successfully.';
      let htmlMessage = '<strong>Configuration reloaded successfully.</strong>';

      if (criticalChanges.length > 0) {
        const warningMsg = `\n\nWARNING: The following critical settings changed and may require a restart: ${criticalChanges.join(', ')}`;
        message += warningMsg;
        htmlMessage += `<br><br><span style="color: orange;"><strong>WARNING:</strong> The following critical settings changed and may require a restart: ${criticalChanges.join(', ')}</span>`;
      }

      this.logger.info('Configuration reloaded successfully', {
        userId: context.userId,
        criticalChanges: criticalChanges.length > 0 ? criticalChanges : null
      });

      // Log successful config reload to audit log
      await this.auditLogger.logConfigReload(
        context.userId,
        true,
        { criticalChanges }
      );

      return {
        success: true,
        message,
        htmlMessage
      };
    } catch (error) {
      const errorMsg = `Failed to reload configuration: ${error instanceof Error ? error.message : 'Unknown error'}`;
      this.logger.error('Configuration reload failed', {
        error: error instanceof Error ? error.message : error,
        userId: context.userId
      });

      // Log failed config reload to audit log
      await this.auditLogger.logConfigReload(
        context.userId,
        false,
        {},
        errorMsg
      );

      return {
        success: false,
        message: errorMsg
      };
    }
  }

  private async handleMaintenance(context: CommandContext): Promise<CommandResult> {
    const { args } = context;
    const action = args.length > 0 ? args[0]?.toLowerCase() : 'status';

    try {
      switch (action) {
        case 'on':
        case 'enable':
          if (this.maintenanceMode) {
            return {
              success: false,
              message: 'Bridge is already in maintenance mode.'
            };
          }

          this.maintenanceMode = true;
          this.maintenanceStartTime = new Date();
          this.maintenanceReason = args.slice(1).join(' ') || 'Manual maintenance';

          // Notify bridge about maintenance mode if available
          if (this.googlePlayBridge && typeof this.googlePlayBridge.onMaintenanceMode === 'function') {
            await this.googlePlayBridge.onMaintenanceMode(true, this.maintenanceReason);
          }

          this.logger.warn('Bridge entered maintenance mode', {
            userId: context.userId,
            reason: this.maintenanceReason
          });

          // Log maintenance mode activation to audit log
          await this.auditLogger.logMaintenanceMode(context.userId, true, this.maintenanceReason);

          return {
            success: true,
            message: `Bridge is now in maintenance mode.\nReason: ${this.maintenanceReason}`,
            htmlMessage: `<strong>Bridge is now in maintenance mode.</strong><br>Reason: ${this.maintenanceReason}`
          };

        case 'off':
        case 'disable':
          if (!this.maintenanceMode) {
            return {
              success: false,
              message: 'Bridge is not in maintenance mode.'
            };
          }

          const duration = this.maintenanceStartTime 
            ? ((Date.now() - this.maintenanceStartTime.getTime()) / 1000 / 60).toFixed(1)
            : 'unknown';

          this.maintenanceMode = false;
          this.maintenanceStartTime = undefined;
          this.maintenanceReason = undefined;

          // Notify bridge about maintenance mode end if available
          if (this.googlePlayBridge && typeof this.googlePlayBridge.onMaintenanceMode === 'function') {
            await this.googlePlayBridge.onMaintenanceMode(false);
          }

          this.logger.info('Bridge exited maintenance mode', {
            userId: context.userId,
            durationMinutes: parseFloat(duration)
          });

          // Log maintenance mode deactivation to audit log
          await this.auditLogger.logMaintenanceMode(context.userId, false);

          return {
            success: true,
            message: `Bridge is no longer in maintenance mode.\nDuration: ${duration} minutes`,
            htmlMessage: `<strong>Bridge is no longer in maintenance mode.</strong><br>Duration: ${duration} minutes`
          };

        case 'status':
        default:
          if (!this.maintenanceMode) {
            return {
              success: true,
              message: 'Bridge is not in maintenance mode.',
              htmlMessage: '<strong>Bridge is not in maintenance mode.</strong>'
            };
          }

          const uptimeMinutes = this.maintenanceStartTime 
            ? ((Date.now() - this.maintenanceStartTime.getTime()) / 1000 / 60).toFixed(1)
            : 'unknown';

          return {
            success: true,
            message: `Bridge is in maintenance mode.\nReason: ${this.maintenanceReason}\nDuration: ${uptimeMinutes} minutes`,
            htmlMessage: `<strong>Bridge is in maintenance mode.</strong><br>Reason: ${this.maintenanceReason}<br>Duration: ${uptimeMinutes} minutes`
          };
      }
    } catch (error) {
      const errorMsg = `Failed to handle maintenance command: ${error instanceof Error ? error.message : 'Unknown error'}`;
      this.logger.error('Maintenance command failed', {
        error: error instanceof Error ? error.message : error,
        userId: context.userId,
        action
      });

      return {
        success: false,
        message: errorMsg
      };
    }
  }

  private async handleAudit(context: CommandContext): Promise<CommandResult> {
    const { args } = context;
    const limit = args.length > 0 && !isNaN(parseInt(args[0]!)) ? parseInt(args[0]!) : 10;
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
          htmlMessage: '<em>No audit log entries found.</em>'
        };
      }

      const message = `Recent audit log entries (${auditEntries.length}):\n\n` + 
        auditEntries.map(entry => 
          `[${entry.timestamp.toISOString()}] ${entry.level.toUpperCase()}: ${entry.action} - ${entry.result}` +
          (entry.userId ? ` (User: ${entry.userId})` : '') +
          (entry.packageName ? ` (App: ${entry.packageName})` : '') +
          (entry.errorMessage ? ` Error: ${entry.errorMessage}` : '')
        ).join('\n');

      const htmlMessage = `<strong>Recent audit log entries (${auditEntries.length}):</strong><br><br>` +
        auditEntries.map(entry => 
          `<code>[${entry.timestamp.toISOString()}]</code> <strong>${entry.level.toUpperCase()}:</strong> ` +
          `${entry.action} - <span style="color: ${entry.result === 'success' ? 'green' : 'red'}">${entry.result}</span>` +
          (entry.userId ? ` <em>(User: ${entry.userId})</em>` : '') +
          (entry.packageName ? ` <em>(App: ${entry.packageName})</em>` : '') +
          (entry.errorMessage ? `<br><span style="color: red;">Error: ${entry.errorMessage}</span>` : '')
        ).join('<br>');

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
        htmlMessage
      };
    } catch (error) {
      const errorMsg = `Failed to retrieve audit log: ${error instanceof Error ? error.message : 'Unknown error'}`;
      this.logger.error('Audit log retrieval failed', {
        error: error instanceof Error ? error.message : error,
        userId: context.userId
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
        message: errorMsg
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
        : undefined
    };
  }
}