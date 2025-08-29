import { GooglePlayReview } from '../models/Message';
import { CategorizationResult } from './ReviewCategorization';
import { Logger } from '../utils/Logger';
import { EventEmitter } from 'events';

export interface TemplateVariable {
  name: string;
  description: string;
  required: boolean;
  defaultValue?: string;
  validator?: (value: string) => boolean;
  formatter?: (value: string) => string;
}

export interface TemplateCondition {
  field: string;
  operator: 'equals' | 'not_equals' | 'contains' | 'not_contains' | 'greater_than' | 'less_than' | 'in' | 'not_in';
  value: any;
}

export interface AdvancedTemplate {
  id: string;
  name: string;
  description?: string;
  category: 'response' | 'notification' | 'system' | 'custom';
  template: string;
  variables: TemplateVariable[];
  conditions: TemplateCondition[];
  tags: string[];
  priority: number;
  active: boolean;
  version: number;
  author?: string;
  createdAt: Date;
  updatedAt: Date;
  usageCount: number;
  lastUsed?: Date;
}

export interface TemplateRenderContext {
  review?: GooglePlayReview;
  categorization?: CategorizationResult;
  appName?: string;
  appVersion?: string;
  supportEmail?: string;
  companyName?: string;
  userVariables?: Record<string, string>;
  systemVariables?: Record<string, string>;
}

export interface TemplateRenderResult {
  success: boolean;
  rendered?: string;
  error?: string;
  missingVariables?: string[];
  template: AdvancedTemplate;
}

export interface TemplatesConfig {
  enableCustomTemplates: boolean;
  maxTemplatesPerCategory: number;
  allowTemplateOverrides: boolean;
  defaultCategory: string;
  templateDirectory?: string;
  autoBackup: boolean;
  versionControl: boolean;
}

/**
 * Advanced message templating system with variable substitution,
 * conditional logic, and template management
 */
export class MessageTemplates extends EventEmitter {
  private readonly logger: Logger;
  private templates: Map<string, AdvancedTemplate> = new Map();
  private templatesByCategory: Map<string, Set<string>> = new Map();
  private templatesByTag: Map<string, Set<string>> = new Map();

  // Pre-defined system variables that are always available
  private readonly systemVariables: TemplateVariable[] = [
    {
      name: 'reviewer_name',
      description: 'Name of the reviewer (or fallback)',
      required: false,
      defaultValue: 'there',
      formatter: this.formatReviewerName.bind(this)
    },
    {
      name: 'app_name',
      description: 'Name of the application',
      required: false,
      defaultValue: 'the app'
    },
    {
      name: 'app_version',
      description: 'Version of the application',
      required: false,
      defaultValue: 'latest version'
    },
    {
      name: 'support_email',
      description: 'Support contact email',
      required: false,
      defaultValue: 'support@company.com',
      validator: (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
    },
    {
      name: 'company_name',
      description: 'Company or team name',
      required: false,
      defaultValue: 'our team'
    },
    {
      name: 'rating',
      description: 'Star rating from review',
      required: false,
      defaultValue: '0',
      validator: (value: string) => /^[1-5]$/.test(value)
    },
    {
      name: 'device',
      description: 'Device model from review',
      required: false,
      defaultValue: 'your device'
    },
    {
      name: 'android_version',
      description: 'Android OS version',
      required: false,
      defaultValue: 'your Android version'
    },
    {
      name: 'timestamp',
      description: 'Current timestamp',
      required: false,
      defaultValue: new Date().toISOString(),
      formatter: (value: string) => new Date(value).toLocaleDateString()
    },
    {
      name: 'date',
      description: 'Current date',
      required: false,
      defaultValue: new Date().toISOString(),
      formatter: (value: string) => new Date(value).toLocaleDateString()
    }
  ];

  constructor(private readonly config: TemplatesConfig) {
    super();
    this.logger = Logger.getInstance().child({ component: 'MessageTemplates' });
    this.initializeDefaultTemplates();
  }

  /**
   * Add or update a template
   */
  public async addTemplate(template: Omit<AdvancedTemplate, 'createdAt' | 'updatedAt' | 'usageCount' | 'version'>): Promise<void> {
    const now = new Date();
    const existingTemplate = this.templates.get(template.id);
    
    const fullTemplate: AdvancedTemplate = {
      ...template,
      version: existingTemplate ? existingTemplate.version + 1 : 1,
      createdAt: existingTemplate?.createdAt || now,
      updatedAt: now,
      usageCount: existingTemplate?.usageCount || 0
    };
    
    if (existingTemplate?.lastUsed) {
      fullTemplate.lastUsed = existingTemplate.lastUsed;
    }

    // Validate template
    this.validateTemplate(fullTemplate);

    // Check category limits
    if (!this.canAddToCategory(fullTemplate.category, fullTemplate.id)) {
      throw new Error(`Maximum templates reached for category: ${fullTemplate.category}`);
    }

    // Store template
    this.templates.set(fullTemplate.id, fullTemplate);
    this.updateCategoryIndex(fullTemplate);
    this.updateTagIndex(fullTemplate);

    this.logger.info(`Template ${existingTemplate ? 'updated' : 'added'}: ${fullTemplate.name} (${fullTemplate.id})`);
    this.emit('template:changed', fullTemplate, existingTemplate ? 'updated' : 'added');
  }

  /**
   * Remove a template
   */
  public async removeTemplate(templateId: string): Promise<void> {
    const template = this.templates.get(templateId);
    if (!template) {
      throw new Error(`Template not found: ${templateId}`);
    }

    this.templates.delete(templateId);
    this.removeCategoryIndex(template);
    this.removeTagIndex(template);

    this.logger.info(`Removed template: ${template.name} (${templateId})`);
    this.emit('template:changed', template, 'removed');
  }

  /**
   * Get template by ID
   */
  public getTemplate(templateId: string): AdvancedTemplate | undefined {
    return this.templates.get(templateId);
  }

  /**
   * Get all templates
   */
  public getAllTemplates(): AdvancedTemplate[] {
    return Array.from(this.templates.values())
      .sort((a, b) => b.priority - a.priority);
  }

  /**
   * Get templates by category
   */
  public getTemplatesByCategory(category: string): AdvancedTemplate[] {
    const templateIds = this.templatesByCategory.get(category) || new Set();
    return Array.from(templateIds)
      .map(id => this.templates.get(id))
      .filter((t): t is AdvancedTemplate => t !== undefined)
      .sort((a, b) => b.priority - a.priority);
  }

  /**
   * Get templates by tag
   */
  public getTemplatesByTag(tag: string): AdvancedTemplate[] {
    const templateIds = this.templatesByTag.get(tag) || new Set();
    return Array.from(templateIds)
      .map(id => this.templates.get(id))
      .filter((t): t is AdvancedTemplate => t !== undefined)
      .sort((a, b) => b.priority - a.priority);
  }

  /**
   * Search templates by name or description
   */
  public searchTemplates(query: string): AdvancedTemplate[] {
    const lowerQuery = query.toLowerCase();
    return Array.from(this.templates.values())
      .filter(template => 
        template.name.toLowerCase().includes(lowerQuery) ||
        template.description?.toLowerCase().includes(lowerQuery) ||
        template.tags.some(tag => tag.toLowerCase().includes(lowerQuery))
      )
      .sort((a, b) => b.priority - a.priority);
  }

  /**
   * Find matching templates for given context
   */
  public findMatchingTemplates(context: TemplateRenderContext): AdvancedTemplate[] {
    return Array.from(this.templates.values())
      .filter(template => template.active && this.evaluateConditions(template, context))
      .sort((a, b) => b.priority - a.priority);
  }

  /**
   * Render a template with given context
   */
  public async renderTemplate(templateId: string, context: TemplateRenderContext): Promise<TemplateRenderResult> {
    const template = this.templates.get(templateId);
    if (!template) {
      return {
        success: false,
        error: `Template not found: ${templateId}`,
        template: {} as AdvancedTemplate
      };
    }

    if (!template.active) {
      return {
        success: false,
        error: `Template is inactive: ${templateId}`,
        template
      };
    }

    try {
      // Check conditions
      if (!this.evaluateConditions(template, context)) {
        return {
          success: false,
          error: 'Template conditions not met',
          template
        };
      }

      // Prepare variables
      const variables = this.prepareVariables(template, context);
      const missingRequired = this.findMissingRequiredVariables(template, variables);

      if (missingRequired.length > 0) {
        return {
          success: false,
          error: 'Missing required variables',
          missingVariables: missingRequired,
          template
        };
      }

      // Render template
      const rendered = this.renderTemplateString(template.template, variables);

      // Update usage statistics
      template.usageCount++;
      template.lastUsed = new Date();

      this.logger.debug(`Rendered template: ${template.name} (${templateId})`);

      return {
        success: true,
        rendered,
        template
      };
    } catch (error) {
      this.logger.error(`Error rendering template ${templateId}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        template
      };
    }
  }

  /**
   * Get available variables for template creation
   */
  public getAvailableVariables(): TemplateVariable[] {
    return [...this.systemVariables];
  }

  /**
   * Export templates to JSON
   */
  public exportTemplates(category?: string): string {
    let templates: AdvancedTemplate[];
    
    if (category) {
      templates = this.getTemplatesByCategory(category);
    } else {
      templates = this.getAllTemplates();
    }

    return JSON.stringify(templates, null, 2);
  }

  /**
   * Import templates from JSON
   */
  public async importTemplates(jsonData: string, overwrite: boolean = false): Promise<number> {
    let templates: AdvancedTemplate[];
    
    try {
      templates = JSON.parse(jsonData);
      if (!Array.isArray(templates)) {
        throw new Error('Invalid template format');
      }
    } catch (error) {
      throw new Error('Invalid JSON format');
    }

    let importedCount = 0;

    for (const template of templates) {
      try {
        if (this.templates.has(template.id) && !overwrite && !this.config.allowTemplateOverrides) {
          this.logger.warn(`Skipping existing template: ${template.id}`);
          continue;
        }

        await this.addTemplate(template);
        importedCount++;
      } catch (error) {
        this.logger.error(`Failed to import template ${template.id}:`, error);
      }
    }

    this.logger.info(`Imported ${importedCount} templates`);
    return importedCount;
  }

  /**
   * Get template statistics
   */
  public getTemplateStats(): {
    total: number;
    byCategory: Record<string, number>;
    byTag: Record<string, number>;
    mostUsed: Array<{ id: string; name: string; usageCount: number }>;
    recentlyUsed: Array<{ id: string; name: string; lastUsed: Date }>;
  } {
    const templates = Array.from(this.templates.values());
    
    const byCategory: Record<string, number> = {};
    const byTag: Record<string, number> = {};
    
    for (const template of templates) {
      byCategory[template.category] = (byCategory[template.category] || 0) + 1;
      
      for (const tag of template.tags) {
        byTag[tag] = (byTag[tag] || 0) + 1;
      }
    }

    const mostUsed = templates
      .filter(t => t.usageCount > 0)
      .sort((a, b) => b.usageCount - a.usageCount)
      .slice(0, 10)
      .map(t => ({ id: t.id, name: t.name, usageCount: t.usageCount }));

    const recentlyUsed = templates
      .filter(t => t.lastUsed)
      .sort((a, b) => (b.lastUsed?.getTime() || 0) - (a.lastUsed?.getTime() || 0))
      .slice(0, 10)
      .map(t => ({ id: t.id, name: t.name, lastUsed: t.lastUsed! }));

    return {
      total: templates.length,
      byCategory,
      byTag,
      mostUsed,
      recentlyUsed
    };
  }

  private initializeDefaultTemplates(): void {
    // Convert ResponseSuggestion templates to AdvancedTemplates
    const defaultTemplates: Omit<AdvancedTemplate, 'createdAt' | 'updatedAt' | 'usageCount' | 'version'>[] = [
      {
        id: 'system_welcome',
        name: 'Room Welcome Message',
        description: 'Welcome message for new app review rooms',
        category: 'system',
        template: 'Welcome to the {{app_name}} review room! 🎉\n\nThis room bridges Google Play reviews with Matrix. Reviews will appear here automatically, and you can reply directly to customers.\n\nUse !help for available commands.',
        variables: [
          { name: 'app_name', description: 'Application name', required: true }
        ],
        conditions: [],
        tags: ['welcome', 'system', 'onboarding'],
        priority: 50,
        active: true,
        author: 'system'
      },
      {
        id: 'notification_new_review',
        name: 'New Review Notification',
        description: 'Notification template for new reviews',
        category: 'notification',
        template: '📱 New {{rating}}-star review for {{app_name}}\n👤 Reviewer: {{reviewer_name}}\n📱 Device: {{device}}\n🔗 Reply with: reply [your message]',
        variables: [
          { name: 'rating', description: 'Star rating', required: true },
          { name: 'app_name', description: 'Application name', required: true },
          { name: 'reviewer_name', description: 'Reviewer name', required: true },
          { name: 'device', description: 'Device info', required: false, defaultValue: 'Unknown device' }
        ],
        conditions: [],
        tags: ['notification', 'new-review'],
        priority: 75,
        active: true,
        author: 'system'
      },
      {
        id: 'response_thank_you',
        name: 'Generic Thank You',
        description: 'Generic thank you response for positive reviews',
        category: 'response',
        template: 'Hi {{reviewer_name}}, thank you so much for your {{rating}}-star review! 😊 We\'re thrilled that you\'re enjoying {{app_name}}. Your feedback motivates our team to keep improving. If you have any suggestions, we\'d love to hear them!',
        variables: [
          { name: 'reviewer_name', description: 'Reviewer name', required: true },
          { name: 'rating', description: 'Star rating', required: true },
          { name: 'app_name', description: 'Application name', required: true }
        ],
        conditions: [
          { field: 'rating', operator: 'greater_than', value: 3 }
        ],
        tags: ['response', 'positive', 'thank-you'],
        priority: 60,
        active: true,
        author: 'system'
      },
      {
        id: 'response_apology',
        name: 'Generic Apology',
        description: 'Generic apology for negative reviews',
        category: 'response',
        template: 'Hi {{reviewer_name}}, we\'re sorry to hear about your experience with {{app_name}}. Your feedback is valuable to us and we\'d like to make things right. Please contact us at {{support_email}} so we can help resolve any issues. Thank you for giving us the opportunity to improve.',
        variables: [
          { name: 'reviewer_name', description: 'Reviewer name', required: true },
          { name: 'app_name', description: 'Application name', required: true },
          { name: 'support_email', description: 'Support email', required: true }
        ],
        conditions: [
          { field: 'rating', operator: 'less_than', value: 4 }
        ],
        tags: ['response', 'negative', 'apology'],
        priority: 65,
        active: true,
        author: 'system'
      }
    ];

    for (const template of defaultTemplates) {
      this.addTemplate(template).catch(error => {
        this.logger.error(`Failed to add default template ${template.id}:`, error);
      });
    }

    this.logger.info(`Initialized with ${defaultTemplates.length} default templates`);
  }

  private validateTemplate(template: AdvancedTemplate): void {
    if (!template.id || !template.name || !template.template) {
      throw new Error('Template must have id, name, and template content');
    }

    if (template.id.length > 100) {
      throw new Error('Template ID too long (max 100 characters)');
    }

    if (template.template.length > 10000) {
      throw new Error('Template content too long (max 10000 characters)');
    }

    // Validate variables
    for (const variable of template.variables) {
      if (!variable.name) {
        throw new Error('Variable must have a name');
      }
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(variable.name)) {
        throw new Error(`Invalid variable name: ${variable.name}`);
      }
    }

    // Validate conditions
    for (const condition of template.conditions) {
      if (!condition.field || !condition.operator || condition.value === undefined) {
        throw new Error('Condition must have field, operator, and value');
      }
    }
  }

  private canAddToCategory(category: string, templateId: string): boolean {
    const existing = this.templatesByCategory.get(category) || new Set();
    if (existing.has(templateId)) {
      return true; // Updating existing template
    }
    return existing.size < this.config.maxTemplatesPerCategory;
  }

  private updateCategoryIndex(template: AdvancedTemplate): void {
    if (!this.templatesByCategory.has(template.category)) {
      this.templatesByCategory.set(template.category, new Set());
    }
    this.templatesByCategory.get(template.category)!.add(template.id);
  }

  private removeCategoryIndex(template: AdvancedTemplate): void {
    const categorySet = this.templatesByCategory.get(template.category);
    if (categorySet) {
      categorySet.delete(template.id);
      if (categorySet.size === 0) {
        this.templatesByCategory.delete(template.category);
      }
    }
  }

  private updateTagIndex(template: AdvancedTemplate): void {
    for (const tag of template.tags) {
      if (!this.templatesByTag.has(tag)) {
        this.templatesByTag.set(tag, new Set());
      }
      this.templatesByTag.get(tag)!.add(template.id);
    }
  }

  private removeTagIndex(template: AdvancedTemplate): void {
    for (const tag of template.tags) {
      const tagSet = this.templatesByTag.get(tag);
      if (tagSet) {
        tagSet.delete(template.id);
        if (tagSet.size === 0) {
          this.templatesByTag.delete(tag);
        }
      }
    }
  }

  private evaluateConditions(template: AdvancedTemplate, context: TemplateRenderContext): boolean {
    for (const condition of template.conditions) {
      if (!this.evaluateCondition(condition, context)) {
        return false;
      }
    }
    return true;
  }

  private evaluateCondition(condition: TemplateCondition, context: TemplateRenderContext): boolean {
    const value = this.getContextValue(condition.field, context);
    
    switch (condition.operator) {
      case 'equals':
        return value === condition.value;
      case 'not_equals':
        return value !== condition.value;
      case 'contains':
        return String(value).includes(String(condition.value));
      case 'not_contains':
        return !String(value).includes(String(condition.value));
      case 'greater_than':
        return Number(value) > Number(condition.value);
      case 'less_than':
        return Number(value) < Number(condition.value);
      case 'in':
        return Array.isArray(condition.value) && condition.value.includes(value);
      case 'not_in':
        return Array.isArray(condition.value) && !condition.value.includes(value);
      default:
        return false;
    }
  }

  private getContextValue(field: string, context: TemplateRenderContext): any {
    switch (field) {
      case 'rating':
        return context.review?.starRating;
      case 'sentiment':
        return context.categorization?.sentiment;
      case 'category':
        return context.categorization?.primaryCategory?.category.id;
      case 'urgency':
        return context.categorization?.urgency;
      case 'app_name':
        return context.appName;
      case 'device':
        return context.review?.device;
      default:
        return context.userVariables?.[field] || context.systemVariables?.[field];
    }
  }

  private prepareVariables(_template: AdvancedTemplate, context: TemplateRenderContext): Record<string, string> {
    const variables: Record<string, string> = {};

    // Add system variables
    for (const sysVar of this.systemVariables) {
      let value = this.getSystemVariableValue(sysVar.name, context) || sysVar.defaultValue || '';
      if (sysVar.formatter) {
        value = sysVar.formatter(value);
      }
      variables[sysVar.name] = value;
    }

    // Add context variables
    if (context.userVariables) {
      Object.assign(variables, context.userVariables);
    }
    if (context.systemVariables) {
      Object.assign(variables, context.systemVariables);
    }

    return variables;
  }

  private getSystemVariableValue(name: string, context: TemplateRenderContext): string | undefined {
    switch (name) {
      case 'reviewer_name':
        return context.review?.authorName;
      case 'app_name':
        return context.appName;
      case 'app_version':
        return context.appVersion || context.review?.appVersionName;
      case 'support_email':
        return context.supportEmail;
      case 'company_name':
        return context.companyName;
      case 'rating':
        return context.review?.starRating?.toString();
      case 'device':
        return context.review?.device;
      case 'android_version':
        return context.review?.androidOsVersion?.toString();
      case 'timestamp':
      case 'date':
        return new Date().toISOString();
      default:
        return undefined;
    }
  }

  private findMissingRequiredVariables(template: AdvancedTemplate, variables: Record<string, string>): string[] {
    return template.variables
      .filter(v => v.required && (!variables[v.name] || variables[v.name]?.trim() === ''))
      .map(v => v.name);
  }

  private renderTemplateString(templateStr: string, variables: Record<string, string>): string {
    let rendered = templateStr;

    // Replace all template variables
    for (const [key, value] of Object.entries(variables)) {
      const placeholder = `{{${key}}}`;
      rendered = rendered.replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), value);
    }

    // Remove any unreplaced variables (fallback)
    rendered = rendered.replace(/\{\{[^}]+\}\}/g, '[missing variable]');

    return rendered.trim();
  }

  private formatReviewerName(name: string): string {
    if (!name || name === 'A Google User' || name.toLowerCase().includes('anonymous')) {
      return 'there';
    }
    const firstName = name.split(' ')[0];
    return firstName || 'there';
  }
}