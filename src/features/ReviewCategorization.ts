import { GooglePlayReview } from '../models/Message';
import { Logger } from '../utils/Logger';

export interface ReviewCategory {
  id: string;
  name: string;
  description: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  color?: string; // Hex color for UI display
}

export interface CategoryMatch {
  category: ReviewCategory;
  confidence: number; // 0.0 to 1.0
  reasons: string[]; // Why this category was matched
}

export interface CategorizationResult {
  primaryCategory: CategoryMatch;
  secondaryCategories: CategoryMatch[];
  sentiment: 'positive' | 'neutral' | 'negative';
  urgency: 'low' | 'medium' | 'high' | 'critical';
  keywords: string[];
  deviceInfo?: {
    hasDeviceIssue: boolean;
    detectedDevice?: string;
    osVersion?: string;
  };
}

export interface CategorizationConfig {
  enableSentimentAnalysis: boolean;
  enableDeviceDetection: boolean;
  confidenceThreshold: number;
  maxSecondaryCategories: number;
  customKeywords?: Record<string, string[]>;
  customCategories?: ReviewCategory[];
}

/**
 * Advanced review categorization system with sentiment analysis,
 * keyword detection, and smart priority assignment
 */
export class ReviewCategorization {
  private readonly logger: Logger;
  private categories: Map<string, ReviewCategory> = new Map();
  private keywordMap: Map<string, string[]> = new Map();
  
  // Predefined categories based on common Google Play review patterns
  private readonly defaultCategories: ReviewCategory[] = [
    {
      id: 'crash',
      name: 'App Crashes',
      description: 'App stability and crash issues',
      priority: 'critical',
      color: '#ff4444'
    },
    {
      id: 'bug',
      name: 'Bug Reports',
      description: 'General bugs and technical issues',
      priority: 'high',
      color: '#ff8800'
    },
    {
      id: 'performance',
      name: 'Performance Issues',
      description: 'Slow, laggy, or unresponsive app behavior',
      priority: 'high',
      color: '#ffaa00'
    },
    {
      id: 'feature_request',
      name: 'Feature Requests',
      description: 'User requesting new features or improvements',
      priority: 'medium',
      color: '#0088ff'
    },
    {
      id: 'ui_ux',
      name: 'UI/UX Issues',
      description: 'User interface and user experience problems',
      priority: 'medium',
      color: '#8800ff'
    },
    {
      id: 'login_auth',
      name: 'Login/Authentication',
      description: 'Issues with signing in, accounts, passwords',
      priority: 'high',
      color: '#ff0088'
    },
    {
      id: 'billing',
      name: 'Billing/Payments',
      description: 'In-app purchases, subscriptions, payment issues',
      priority: 'critical',
      color: '#ff0000'
    },
    {
      id: 'data_sync',
      name: 'Data/Sync Issues',
      description: 'Problems with data syncing, cloud saves, backups',
      priority: 'high',
      color: '#ff6600'
    },
    {
      id: 'compatibility',
      name: 'Device Compatibility',
      description: 'Issues specific to devices, OS versions, hardware',
      priority: 'medium',
      color: '#6600ff'
    },
    {
      id: 'privacy_security',
      name: 'Privacy/Security',
      description: 'Privacy concerns, security issues, permissions',
      priority: 'high',
      color: '#ff3366'
    },
    {
      id: 'positive_feedback',
      name: 'Positive Feedback',
      description: 'User satisfaction, praise, positive experiences',
      priority: 'low',
      color: '#00bb00'
    },
    {
      id: 'update_issues',
      name: 'Update Problems',
      description: 'Issues after app updates, version-specific problems',
      priority: 'high',
      color: '#ffcc00'
    },
    {
      id: 'support_request',
      name: 'Support Request',
      description: 'User explicitly asking for help or support',
      priority: 'medium',
      color: '#00aaff'
    },
    {
      id: 'spam_irrelevant',
      name: 'Spam/Irrelevant',
      description: 'Spam, off-topic, or irrelevant reviews',
      priority: 'low',
      color: '#888888'
    }
  ];

  // Keyword patterns for each category
  private readonly defaultKeywords: Record<string, string[]> = {
    crash: [
      'crash', 'crashes', 'crashed', 'crashing', 'force close', 'force closes',
      'shuts down', 'closes unexpectedly', 'app stops', 'keeps crashing',
      'won\'t stay open', 'immediately closes', 'crashes on startup'
    ],
    bug: [
      'bug', 'bugs', 'buggy', 'glitch', 'glitches', 'error', 'errors',
      'broken', 'not working', 'doesn\'t work', 'malfunction', 'issue', 'issues',
      'problem', 'problems', 'wrong', 'incorrect', 'messed up'
    ],
    performance: [
      'slow', 'laggy', 'lag', 'sluggish', 'unresponsive', 'freezes', 'frozen',
      'hangs', 'stuck', 'loading forever', 'takes forever', 'performance',
      'speed', 'fast', 'responsive', 'smooth', 'choppy'
    ],
    feature_request: [
      'please add', 'would like', 'wish', 'hope', 'feature request',
      'suggestion', 'could you add', 'missing feature', 'needs', 'should have',
      'would be nice', 'request', 'enhance', 'improvement', 'upgrade'
    ],
    ui_ux: [
      'interface', 'design', 'layout', 'buttons', 'menu', 'navigation',
      'confusing', 'hard to use', 'difficult', 'user friendly', 'intuitive',
      'colors', 'theme', 'look', 'appearance', 'ugly', 'beautiful'
    ],
    login_auth: [
      'login', 'log in', 'sign in', 'password', 'account', 'authentication',
      'can\'t login', 'won\'t login', 'forgot password', 'reset password',
      'username', 'email', 'register', 'signup', 'sign up'
    ],
    billing: [
      'payment', 'billing', 'charged', 'money', 'refund', 'purchase',
      'subscription', 'premium', 'paid', 'free', 'cost', 'price',
      'in-app purchase', 'buy', 'bought', 'transaction', 'credit card'
    ],
    data_sync: [
      'sync', 'backup', 'cloud', 'data', 'lost data', 'missing data',
      'save', 'saved', 'progress', 'transfer', 'export', 'import',
      'synchronize', 'synchronization', 'cloud save'
    ],
    compatibility: [
      'device', 'phone', 'tablet', 'android', 'version', 'os',
      'doesn\'t support', 'not compatible', 'won\'t install', 'can\'t install',
      'hardware', 'model', 'brand', 'samsung', 'pixel', 'lg', 'htc'
    ],
    privacy_security: [
      'privacy', 'security', 'permissions', 'permission', 'access',
      'data collection', 'tracking', 'ads', 'advertisement', 'personal info',
      'secure', 'safety', 'trust', 'suspicious'
    ],
    positive_feedback: [
      'great', 'awesome', 'amazing', 'excellent', 'perfect', 'love',
      'fantastic', 'wonderful', 'brilliant', 'outstanding', 'superb',
      'best', 'good', 'nice', 'useful', 'helpful', 'recommend'
    ],
    update_issues: [
      'update', 'updated', 'new version', 'latest version', 'after update',
      'since update', 'broke after', 'stopped working after', 'version',
      'upgrade', 'upgraded', 'changelog'
    ],
    support_request: [
      'help', 'support', 'assistance', 'how to', 'how do i', 'can someone',
      'need help', 'please help', 'customer service', 'contact',
      'question', 'ask', 'tutorial', 'guide'
    ],
    spam_irrelevant: [
      'first', 'second', 'third', 'hi', 'hello', 'test', 'testing',
      'random', 'spam', 'advertisement', 'promote', 'check out',
      'visit my', 'download my', 'like my'
    ]
  };

  // Sentiment keywords
  private readonly sentimentKeywords = {
    positive: [
      'love', 'great', 'awesome', 'amazing', 'excellent', 'perfect',
      'fantastic', 'wonderful', 'brilliant', 'outstanding', 'superb',
      'best', 'good', 'nice', 'useful', 'helpful', 'recommend',
      'satisfied', 'happy', 'pleased', 'impressed', 'enjoy'
    ],
    negative: [
      'hate', 'terrible', 'awful', 'horrible', 'worst', 'bad',
      'disappointing', 'frustrated', 'annoying', 'useless', 'waste',
      'regret', 'angry', 'mad', 'disgusted', 'pathetic', 'garbage',
      'trash', 'uninstall', 'delete', 'removed'
    ]
  };

  constructor(private readonly config: CategorizationConfig) {
    this.logger = Logger.getInstance().child({ component: 'ReviewCategorization' });
    this.initializeCategories();
    this.initializeKeywords();
  }

  /**
   * Categorize a Google Play review with comprehensive analysis
   */
  public async categorizeReview(review: GooglePlayReview): Promise<CategorizationResult> {
    const text = review.text?.toLowerCase() || '';
    const rating = review.starRating;
    
    this.logger.debug(`Categorizing review ${review.reviewId} (${rating} stars): "${text.substring(0, 100)}..."`);

    // Find matching categories
    const categoryMatches = this.findCategoryMatches(text, rating);
    
    // Determine sentiment
    const sentiment = this.analyzeSentiment(text, rating);
    
    // Extract keywords
    const keywords = this.extractKeywords(text);
    
    // Analyze device information
    const deviceInfo = this.analyzeDeviceInfo(review);
    
    // Calculate urgency
    const urgency = this.calculateUrgency(categoryMatches, sentiment, rating, deviceInfo);

    // Sort matches by confidence and filter
    const sortedMatches = categoryMatches
      .sort((a, b) => b.confidence - a.confidence)
      .filter(match => match.confidence >= this.config.confidenceThreshold);

    const primaryCategory = sortedMatches[0];
    const secondaryCategories = sortedMatches
      .slice(1, this.config.maxSecondaryCategories + 1);

    const result: CategorizationResult = {
      primaryCategory: primaryCategory || { 
        category: this.defaultCategories[0] || {
          id: 'general',
          name: 'General',
          description: 'General category for unmatched reviews',
          priority: 'low'
        }, 
        confidence: 0,
        reasons: ['default category'] 
      },
      secondaryCategories,
      sentiment,
      urgency,
      keywords,
      deviceInfo: deviceInfo || { hasDeviceIssue: false }
    };

    this.logger.debug(`Categorization result for ${review.reviewId}:`, {
      primary: primaryCategory?.category.name,
      confidence: primaryCategory?.confidence,
      sentiment,
      urgency,
      keywordCount: keywords.length
    });

    return result;
  }

  /**
   * Get category by ID
   */
  public getCategory(categoryId: string): ReviewCategory | undefined {
    return this.categories.get(categoryId);
  }

  /**
   * Get all available categories
   */
  public getAllCategories(): ReviewCategory[] {
    return Array.from(this.categories.values());
  }

  /**
   * Add or update a custom category
   */
  public addCategory(category: ReviewCategory, keywords: string[] = []): void {
    this.categories.set(category.id, category);
    if (keywords.length > 0) {
      this.keywordMap.set(category.id, keywords);
    }
    this.logger.info(`Added category: ${category.name} (${category.id})`);
  }

  private initializeCategories(): void {
    // Load default categories
    for (const category of this.defaultCategories) {
      this.categories.set(category.id, category);
    }

    // Load custom categories from config
    if (this.config.customCategories) {
      for (const category of this.config.customCategories) {
        this.categories.set(category.id, category);
      }
    }

    this.logger.info(`Initialized ${this.categories.size} review categories`);
  }

  private initializeKeywords(): void {
    // Load default keywords
    for (const [categoryId, keywords] of Object.entries(this.defaultKeywords)) {
      this.keywordMap.set(categoryId, keywords);
    }

    // Load custom keywords from config
    if (this.config.customKeywords) {
      for (const [categoryId, keywords] of Object.entries(this.config.customKeywords)) {
        const existing = this.keywordMap.get(categoryId) || [];
        this.keywordMap.set(categoryId, [...existing, ...keywords]);
      }
    }

    const totalKeywords = Array.from(this.keywordMap.values())
      .reduce((sum, keywords) => sum + keywords.length, 0);
    
    this.logger.info(`Initialized ${totalKeywords} categorization keywords across ${this.keywordMap.size} categories`);
  }

  private findCategoryMatches(text: string, rating: number): CategoryMatch[] {
    const matches: CategoryMatch[] = [];

    for (const [categoryId, keywords] of this.keywordMap.entries()) {
      const category = this.categories.get(categoryId);
      if (!category) continue;

      const matchedKeywords: string[] = [];
      let totalMatches = 0;

      // Count keyword matches
      for (const keyword of keywords) {
        const regex = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
        const matches = text.match(regex);
        if (matches) {
          matchedKeywords.push(keyword);
          totalMatches += matches.length;
        }
      }

      if (matchedKeywords.length > 0) {
        // Calculate confidence based on matches and context
        let confidence = Math.min(matchedKeywords.length / keywords.length, 1.0);
        
        // Boost confidence for multiple occurrences
        if (totalMatches > matchedKeywords.length) {
          confidence += Math.min((totalMatches - matchedKeywords.length) * 0.1, 0.3);
        }

        // Adjust confidence based on rating for certain categories
        confidence = this.adjustConfidenceByRating(confidence, categoryId, rating);

        // Ensure confidence doesn't exceed 1.0
        confidence = Math.min(confidence, 1.0);

        if (confidence >= this.config.confidenceThreshold) {
          matches.push({
            category,
            confidence,
            reasons: [
              `Matched ${matchedKeywords.length} keywords: ${matchedKeywords.slice(0, 3).join(', ')}${matchedKeywords.length > 3 ? '...' : ''}`,
              `Total occurrences: ${totalMatches}`
            ]
          });
        }
      }
    }

    return matches;
  }

  private adjustConfidenceByRating(confidence: number, categoryId: string, rating: number): number {
    // Boost negative categories for low ratings
    const negativeCategoryBoost = ['crash', 'bug', 'performance', 'billing', 'login_auth'];
    if (negativeCategoryBoost.includes(categoryId) && rating <= 2) {
      confidence *= 1.2;
    }

    // Boost positive feedback for high ratings
    if (categoryId === 'positive_feedback' && rating >= 4) {
      confidence *= 1.3;
    }

    // Reduce positive feedback for low ratings
    if (categoryId === 'positive_feedback' && rating <= 2) {
      confidence *= 0.5;
    }

    return confidence;
  }

  private analyzeSentiment(text: string, rating: number): 'positive' | 'neutral' | 'negative' {
    if (!this.config.enableSentimentAnalysis) {
      // Simple rating-based sentiment
      if (rating >= 4) return 'positive';
      if (rating <= 2) return 'negative';
      return 'neutral';
    }

    let positiveScore = 0;
    let negativeScore = 0;

    // Count positive keywords
    for (const keyword of this.sentimentKeywords.positive) {
      const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
      const matches = text.match(regex);
      if (matches) {
        positiveScore += matches.length;
      }
    }

    // Count negative keywords
    for (const keyword of this.sentimentKeywords.negative) {
      const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
      const matches = text.match(regex);
      if (matches) {
        negativeScore += matches.length;
      }
    }

    // Combine keyword analysis with rating
    const ratingWeight = 0.6;
    const keywordWeight = 0.4;

    let ratingScore = 0;
    if (rating >= 4) ratingScore = 1;
    else if (rating <= 2) ratingScore = -1;

    const keywordScore = positiveScore - negativeScore;
    const totalScore = (ratingScore * ratingWeight) + (keywordScore * keywordWeight);

    if (totalScore > 0.3) return 'positive';
    if (totalScore < -0.3) return 'negative';
    return 'neutral';
  }

  private extractKeywords(text: string): string[] {
    const keywords: Set<string> = new Set();

    // Extract keywords from all categories
    for (const categoryKeywords of this.keywordMap.values()) {
      for (const keyword of categoryKeywords) {
        const regex = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
        if (text.match(regex)) {
          keywords.add(keyword);
        }
      }
    }

    return Array.from(keywords).slice(0, 10); // Limit to top 10 keywords
  }

  private analyzeDeviceInfo(review: GooglePlayReview): CategorizationResult['deviceInfo'] {
    if (!this.config.enableDeviceDetection) {
      return undefined;
    }

    const text = review.text?.toLowerCase() || '';
    const hasDeviceKeywords = [
      'device', 'phone', 'tablet', 'samsung', 'pixel', 'lg', 'htc', 
      'oneplus', 'xiaomi', 'huawei', 'motorola'
    ].some(keyword => text.includes(keyword));

    const result: { hasDeviceIssue: boolean; detectedDevice?: string; osVersion?: string } = {
      hasDeviceIssue: hasDeviceKeywords
    };

    if (review.device) {
      result.detectedDevice = review.device;
    }

    if (review.androidOsVersion) {
      result.osVersion = review.androidOsVersion;
    }

    return result;
  }

  private calculateUrgency(
    categoryMatches: CategoryMatch[],
    sentiment: string,
    rating: number,
    deviceInfo?: CategorizationResult['deviceInfo']
  ): 'low' | 'medium' | 'high' | 'critical' {
    let urgencyScore = 0;

    // Base urgency from primary category
    if (categoryMatches.length > 0) {
      const primaryCategory = categoryMatches[0];
      if (primaryCategory) {
        switch (primaryCategory.category.priority) {
          case 'critical': urgencyScore += 4; break;
          case 'high': urgencyScore += 3; break;
          case 'medium': urgencyScore += 2; break;
          case 'low': urgencyScore += 1; break;
        }
      }
    }

    // Adjust for rating
    if (rating === 1) urgencyScore += 2;
    else if (rating === 2) urgencyScore += 1;
    else if (rating >= 4) urgencyScore -= 1;

    // Adjust for sentiment
    if (sentiment === 'negative') urgencyScore += 1;
    else if (sentiment === 'positive') urgencyScore -= 1;

    // Boost for device issues
    if (deviceInfo?.hasDeviceIssue) urgencyScore += 1;

    // Convert score to urgency level
    if (urgencyScore >= 6) return 'critical';
    if (urgencyScore >= 4) return 'high';
    if (urgencyScore >= 2) return 'medium';
    return 'low';
  }
}