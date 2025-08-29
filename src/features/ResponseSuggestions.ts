import { GooglePlayReview } from '../models/Message';
import { CategorizationResult } from './ReviewCategorization';
import { Logger } from '../utils/Logger';

export interface ResponseTemplate {
  id: string;
  name: string;
  categoryIds: string[];
  sentiment?: 'positive' | 'neutral' | 'negative';
  ratingRange?: { min: number; max: number };
  urgencyLevels?: ('low' | 'medium' | 'high' | 'critical')[];
  template: string;
  variables: string[];
  tone: 'formal' | 'friendly' | 'apologetic' | 'grateful' | 'helpful';
  priority: number; // Higher = more likely to be suggested
}

export interface ResponseSuggestion {
  template: ResponseTemplate;
  renderedText: string;
  confidence: number;
  reasoning: string[];
  variables: Record<string, string>;
}

export interface SuggestionContext {
  review: GooglePlayReview;
  categorization: CategorizationResult;
  appName?: string;
  appVersion?: string;
  supportEmail?: string;
  companyName?: string;
  additionalContext?: Record<string, string>;
}

export interface ResponseSuggestionsConfig {
  maxSuggestions: number;
  minConfidence: number;
  enablePersonalization: boolean;
  defaultTone: 'formal' | 'friendly' | 'apologetic' | 'grateful' | 'helpful';
  customTemplates?: ResponseTemplate[];
  companyInfo?: {
    name: string;
    supportEmail?: string;
    website?: string;
  };
}

/**
 * Intelligent response suggestion system that analyzes reviews and
 * suggests appropriate templated responses based on context
 */
export class ResponseSuggestions {
  private readonly logger: Logger;
  private templates: Map<string, ResponseTemplate> = new Map();

  private readonly defaultTemplates: ResponseTemplate[] = [
    // Crash/Critical Issues
    {
      id: 'crash_apology',
      name: 'Crash Issue Apology',
      categoryIds: ['crash'],
      sentiment: 'negative',
      ratingRange: { min: 1, max: 2 },
      urgencyLevels: ['critical', 'high'],
      template: 'Hi {{reviewer_name}}, thank you for bringing this crash issue to our attention. We sincerely apologize for the inconvenience. Our development team is actively working on resolving this issue. Could you please share more details about when the crash occurs ({{app_name}} version {{app_version}})? You can also contact us directly at {{support_email}} for faster assistance.',
      variables: ['reviewer_name', 'app_name', 'app_version', 'support_email'],
      tone: 'apologetic',
      priority: 95
    },
    {
      id: 'crash_investigation',
      name: 'Crash Investigation Request',
      categoryIds: ['crash', 'bug'],
      sentiment: 'negative',
      template: 'Thank you for reporting this issue, {{reviewer_name}}. We take crashes very seriously and would like to investigate further. Could you please let us know: 1) What device you\'re using, 2) When the crash typically happens, 3) Any error messages you see? This information will help us fix the issue faster.',
      variables: ['reviewer_name'],
      tone: 'helpful',
      priority: 90
    },

    // Bug Reports
    {
      id: 'bug_acknowledgment',
      name: 'Bug Acknowledgment',
      categoryIds: ['bug', 'performance'],
      sentiment: 'negative',
      template: 'Hi {{reviewer_name}}, thank you for the detailed feedback about this bug. We\'ve noted the issue you described and our team is investigating. We aim to resolve bugs quickly and will include a fix in our next update. We appreciate your patience!',
      variables: ['reviewer_name'],
      tone: 'apologetic',
      priority: 85
    },

    // Performance Issues  
    {
      id: 'performance_optimization',
      name: 'Performance Optimization',
      categoryIds: ['performance'],
      template: 'Thanks for letting us know about the performance issues, {{reviewer_name}}. We\'re constantly working on optimizing {{app_name}} for better speed and responsiveness. Try clearing the app cache or restarting the app as a temporary fix. We have performance improvements coming in the next update!',
      variables: ['reviewer_name', 'app_name'],
      tone: 'helpful',
      priority: 80
    },

    // Feature Requests
    {
      id: 'feature_request_thanks',
      name: 'Feature Request Appreciation',
      categoryIds: ['feature_request'],
      sentiment: 'neutral',
      ratingRange: { min: 3, max: 5 },
      template: 'Hi {{reviewer_name}}, thank you for the great suggestion! We really value user feedback like yours. While we can\'t implement every requested feature immediately, we\'ve noted your idea and will consider it for future updates. Keep the feedback coming!',
      variables: ['reviewer_name'],
      tone: 'grateful',
      priority: 70
    },

    // Login/Authentication Issues
    {
      id: 'login_help',
      name: 'Login Assistance',
      categoryIds: ['login_auth'],
      template: 'Hi {{reviewer_name}}, sorry you\'re having trouble logging in! Here are a few things to try: 1) Make sure you\'re using the correct email/password, 2) Try the "Forgot Password" option, 3) Check your internet connection. If you\'re still having trouble, please contact us at {{support_email}} with your account email.',
      variables: ['reviewer_name', 'support_email'],
      tone: 'helpful',
      priority: 90
    },

    // Billing Issues
    {
      id: 'billing_urgent',
      name: 'Billing Issue Priority',
      categoryIds: ['billing'],
      sentiment: 'negative',
      urgencyLevels: ['critical', 'high'],
      template: 'Hi {{reviewer_name}}, we apologize for any billing confusion! Payment issues are our top priority. Please contact our support team immediately at {{support_email}} with your order details, and we\'ll resolve this as quickly as possible. Thank you for your patience.',
      variables: ['reviewer_name', 'support_email'],
      tone: 'apologetic',
      priority: 100
    },

    // Positive Feedback
    {
      id: 'positive_gratitude',
      name: 'Positive Feedback Thanks',
      categoryIds: ['positive_feedback'],
      sentiment: 'positive',
      ratingRange: { min: 4, max: 5 },
      template: 'Thank you so much for the kind words, {{reviewer_name}}! ⭐ Reviews like yours motivate our team to keep improving {{app_name}}. We\'re thrilled you\'re enjoying the app. If you have any suggestions for making it even better, we\'d love to hear them!',
      variables: ['reviewer_name', 'app_name'],
      tone: 'grateful',
      priority: 75
    },

    // Device Compatibility
    {
      id: 'device_compatibility',
      name: 'Device Compatibility Help',
      categoryIds: ['compatibility'],
      template: 'Hi {{reviewer_name}}, thanks for reporting this compatibility issue. We strive to support as many devices as possible. Could you please let us know your specific device model and Android version? This helps us prioritize compatibility fixes. You can reach us at {{support_email}} for device-specific support.',
      variables: ['reviewer_name', 'support_email'],
      tone: 'helpful',
      priority: 80
    },

    // Update Issues
    {
      id: 'update_regression',
      name: 'Update Issue Apology',
      categoryIds: ['update_issues'],
      sentiment: 'negative',
      template: 'Hi {{reviewer_name}}, we\'re sorry the latest update caused issues for you. Sometimes new features can have unexpected side effects. We\'re working on a hotfix and will release it soon. In the meantime, you might try clearing the app cache or restarting your device.',
      variables: ['reviewer_name'],
      tone: 'apologetic',
      priority: 85
    },

    // Support Requests
    {
      id: 'support_assistance',
      name: 'General Support',
      categoryIds: ['support_request'],
      template: 'Hi {{reviewer_name}}, we\'re here to help! For the fastest assistance with your question, please contact our support team at {{support_email}} or check out our help documentation. We typically respond within 24 hours and will make sure to get your issue resolved.',
      variables: ['reviewer_name', 'support_email'],
      tone: 'helpful',
      priority: 85
    },

    // Generic Negative Response
    {
      id: 'generic_negative',
      name: 'Generic Negative Response',
      categoryIds: [], // Matches any category
      sentiment: 'negative',
      ratingRange: { min: 1, max: 3 },
      template: 'Hi {{reviewer_name}}, thank you for your feedback. We\'re sorry {{app_name}} didn\'t meet your expectations. We take all user feedback seriously and are constantly working to improve. If you\'d like to share more specific details, please contact us at {{support_email}}.',
      variables: ['reviewer_name', 'app_name', 'support_email'],
      tone: 'apologetic',
      priority: 50
    },

    // Generic Positive Response
    {
      id: 'generic_positive',
      name: 'Generic Positive Response',
      categoryIds: [], // Matches any category
      sentiment: 'positive',
      ratingRange: { min: 4, max: 5 },
      template: 'Hi {{reviewer_name}}, thank you for the wonderful review! We\'re so happy you\'re enjoying {{app_name}}. Your support means the world to our team. If you have any suggestions for future improvements, we\'d love to hear them!',
      variables: ['reviewer_name', 'app_name'],
      tone: 'grateful',
      priority: 40
    }
  ];

  constructor(private readonly config: ResponseSuggestionsConfig) {
    this.logger = Logger.getInstance().child({ component: 'ResponseSuggestions' });
    this.initializeTemplates();
  }

  /**
   * Generate response suggestions for a review based on categorization
   */
  public async generateSuggestions(context: SuggestionContext): Promise<ResponseSuggestion[]> {
    const { review } = context;
    
    this.logger.debug(`Generating response suggestions for review ${review.reviewId}`);

    const suggestions: ResponseSuggestion[] = [];
    const processedTemplateIds = new Set<string>();

    // Score and rank all templates
    for (const template of this.templates.values()) {
      if (processedTemplateIds.has(template.id)) continue;

      const match = this.scoreTemplateMatch(template, context);
      if (match.confidence >= this.config.minConfidence) {
        const rendered = this.renderTemplate(template, context, match.variables);
        
        suggestions.push({
          template,
          renderedText: rendered,
          confidence: match.confidence,
          reasoning: match.reasoning,
          variables: match.variables
        });

        processedTemplateIds.add(template.id);
      }
    }

    // Sort by confidence and priority, then limit results
    const sortedSuggestions = suggestions
      .sort((a, b) => {
        // Primary sort by confidence
        if (Math.abs(a.confidence - b.confidence) > 0.1) {
          return b.confidence - a.confidence;
        }
        // Secondary sort by template priority
        return b.template.priority - a.template.priority;
      })
      .slice(0, this.config.maxSuggestions);

    this.logger.debug(`Generated ${sortedSuggestions.length} suggestions for review ${review.reviewId}`);

    return sortedSuggestions;
  }

  /**
   * Add or update a custom response template
   */
  public addTemplate(template: ResponseTemplate): void {
    this.templates.set(template.id, template);
    this.logger.info(`Added response template: ${template.name} (${template.id})`);
  }

  /**
   * Get all available templates
   */
  public getAllTemplates(): ResponseTemplate[] {
    return Array.from(this.templates.values());
  }

  /**
   * Get template by ID
   */
  public getTemplate(templateId: string): ResponseTemplate | undefined {
    return this.templates.get(templateId);
  }

  private initializeTemplates(): void {
    // Load default templates
    for (const template of this.defaultTemplates) {
      this.templates.set(template.id, template);
    }

    // Load custom templates from config
    if (this.config.customTemplates) {
      for (const template of this.config.customTemplates) {
        this.templates.set(template.id, template);
      }
    }

    this.logger.info(`Initialized ${this.templates.size} response templates`);
  }

  private scoreTemplateMatch(
    template: ResponseTemplate,
    context: SuggestionContext
  ): { confidence: number; reasoning: string[]; variables: Record<string, string> } {
    const { review, categorization } = context;
    let confidence = 0;
    const reasoning: string[] = [];
    const variables = this.prepareVariables(context);

    // Category matching (most important factor)
    if (template.categoryIds.length === 0) {
      // Generic template - lower base score
      confidence += 0.3;
      reasoning.push('Generic template (matches any category)');
    } else {
      const primaryMatch = template.categoryIds.includes(categorization.primaryCategory?.category.id || '');
      const secondaryMatch = template.categoryIds.some(id => 
        categorization.secondaryCategories.some(cat => cat.category.id === id)
      );

      if (primaryMatch) {
        confidence += 0.6;
        reasoning.push(`Primary category match: ${categorization.primaryCategory.category.name}`);
      } else if (secondaryMatch) {
        confidence += 0.4;
        const matchedCategory = categorization.secondaryCategories.find(cat => 
          template.categoryIds.includes(cat.category.id)
        );
        reasoning.push(`Secondary category match: ${matchedCategory?.category.name}`);
      } else {
        return { confidence: 0, reasoning: ['No category match'], variables };
      }
    }

    // Sentiment matching
    if (template.sentiment) {
      if (template.sentiment === categorization.sentiment) {
        confidence += 0.2;
        reasoning.push(`Sentiment match: ${categorization.sentiment}`);
      } else {
        confidence -= 0.2;
        reasoning.push(`Sentiment mismatch: expected ${template.sentiment}, got ${categorization.sentiment}`);
      }
    }

    // Rating range matching
    if (template.ratingRange) {
      const { min, max } = template.ratingRange;
      if (review.starRating >= min && review.starRating <= max) {
        confidence += 0.15;
        reasoning.push(`Rating match: ${review.starRating} stars in range ${min}-${max}`);
      } else {
        confidence -= 0.1;
        reasoning.push(`Rating outside range: ${review.starRating} stars, expected ${min}-${max}`);
      }
    }

    // Urgency level matching
    if (template.urgencyLevels && template.urgencyLevels.length > 0) {
      if (template.urgencyLevels.includes(categorization.urgency)) {
        confidence += 0.1;
        reasoning.push(`Urgency match: ${categorization.urgency}`);
      } else {
        confidence -= 0.05;
      }
    }

    // Boost confidence based on template priority (normalized)
    const priorityBoost = Math.min(template.priority / 100, 0.1);
    confidence += priorityBoost;

    // Ensure confidence is within bounds
    confidence = Math.max(0, Math.min(1, confidence));

    return { confidence, reasoning, variables };
  }

  private prepareVariables(context: SuggestionContext): Record<string, string> {
    const { review, appName, appVersion, supportEmail, companyName, additionalContext } = context;
    
    const variables: Record<string, string> = {
      reviewer_name: this.getReviewerName(review.authorName),
      app_name: appName || 'the app',
      app_version: appVersion || review.appVersionName || 'latest version',
      support_email: supportEmail || this.config.companyInfo?.supportEmail || 'support@company.com',
      company_name: companyName || this.config.companyInfo?.name || 'our team',
      rating: review.starRating.toString(),
      device: review.device || 'your device',
      android_version: review.androidOsVersion || 'your Android version'
    };

    // Add any additional context variables
    if (additionalContext) {
      Object.assign(variables, additionalContext);
    }

    return variables;
  }

  private getReviewerName(authorName: string): string {
    // Google Play sometimes provides anonymized names or "A Google User"
    if (!authorName || authorName === 'A Google User' || authorName.toLowerCase().includes('anonymous')) {
      return 'there'; // "Hi there" instead of "Hi A Google User"
    }
    
    // Use first name only for friendlier tone
    const firstName = authorName.split(' ')[0];
    return firstName || 'there';
  }

  private renderTemplate(
    template: ResponseTemplate,
    context: SuggestionContext,
    variables: Record<string, string>
  ): string {
    let rendered = template.template;

    // Replace all template variables
    for (const [key, value] of Object.entries(variables)) {
      const placeholder = `{{${key}}}`;
      rendered = rendered.replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), value);
    }

    // Remove any unreplaced variables (fallback)
    rendered = rendered.replace(/\{\{[^}]+\}\}/g, '[missing variable]');

    // Apply personalization if enabled
    if (this.config.enablePersonalization) {
      rendered = this.personalizeResponse(rendered, context);
    }

    return rendered.trim();
  }

  private personalizeResponse(response: string, context: SuggestionContext): string {
    const { review, categorization } = context;

    // Add emoji for positive responses
    if (categorization.sentiment === 'positive' && review.starRating >= 4) {
      if (!response.includes('⭐') && !response.includes('😊') && !response.includes('🙂')) {
        // Add a subtle emoji
        response = response.replace(/Thank you/, 'Thank you 😊');
      }
    }

    // Adjust formality based on review content
    const hasInformalLanguage = /\b(awesome|cool|love it|amazing)\b/i.test(review.text || '');
    if (hasInformalLanguage && response.includes('We sincerely apologize')) {
      response = response.replace('We sincerely apologize', 'We\'re really sorry');
    }

    return response;
  }
}