/**
 * User data models for Matrix Google Play Bridge
 */

/**
 * Represents a Matrix user in the bridge system
 */
export interface MatrixUser {
  /** Matrix user ID (e.g., @googleplay_12345:domain.com) */
  userId: string;
  /** Display name shown in Matrix */
  displayName: string;
  /** Avatar URL for the user (optional) */
  avatarUrl?: string;
  /** Whether this is a virtual user created by the bridge */
  isVirtual: boolean;
  /** Timestamp when the user was created */
  createdAt: Date;
  /** Timestamp when the user was last active */
  lastActiveAt: Date;
}

/**
 * Represents a Google Play reviewer
 */
export interface GooglePlayUser {
  /** Unique review identifier from Google Play */
  reviewId: string;
  /** Author name from the review */
  authorName: string;
  /** Corresponding Matrix user ID */
  matrixUserId: string;
  /** Timestamp when the user was first seen */
  firstSeenAt: Date;
  /** Timestamp when the user was last active */
  lastActiveAt: Date;
}

/**
 * User mapping between Google Play and Matrix
 */
export interface UserMapping {
  /** Internal mapping ID */
  id: string;
  /** Google Play review ID */
  googlePlayReviewId: string;
  /** Matrix user ID */
  matrixUserId: string;
  /** Google Play author name */
  authorName: string;
  /** Package name this user is associated with */
  packageName: string;
  /** Timestamp when the mapping was created */
  createdAt: Date;
  /** Timestamp when the mapping was last updated */
  updatedAt: Date;
}

/**
 * User management class for handling Matrix and Google Play users
 */
export class UserManager {
  private matrixUsers: Map<string, MatrixUser> = new Map();
  private googlePlayUsers: Map<string, GooglePlayUser> = new Map();
  private userMappings: Map<string, UserMapping> = new Map();

  /**
   * Create or get a virtual Matrix user for a Google Play reviewer
   */
  async getOrCreateMatrixUser(
    reviewId: string,
    authorName: string,
    domain: string
  ): Promise<MatrixUser> {
    // Generate Matrix user ID for Google Play reviewer
    const userId = `@googleplay_${reviewId}:${domain}`;

    // Check if user already exists
    let matrixUser = this.matrixUsers.get(userId);
    if (matrixUser) {
      // Update last active timestamp
      matrixUser.lastActiveAt = new Date();
      return matrixUser;
    }

    // Create new virtual user
    matrixUser = {
      userId,
      displayName: authorName || `Google Play User ${reviewId}`,
      isVirtual: true,
      createdAt: new Date(),
      lastActiveAt: new Date(),
    };

    this.matrixUsers.set(userId, matrixUser);
    return matrixUser;
  }

  /**
   * Get or create a Google Play user mapping
   */
  async getOrCreateGooglePlayUser(
    reviewId: string,
    authorName: string,
    matrixUserId: string
  ): Promise<GooglePlayUser> {
    let googlePlayUser = this.googlePlayUsers.get(reviewId);
    if (googlePlayUser) {
      // Update last active timestamp
      googlePlayUser.lastActiveAt = new Date();
      return googlePlayUser;
    }

    // Create new Google Play user
    googlePlayUser = {
      reviewId,
      authorName,
      matrixUserId,
      firstSeenAt: new Date(),
      lastActiveAt: new Date(),
    };

    this.googlePlayUsers.set(reviewId, googlePlayUser);
    return googlePlayUser;
  }

  /**
   * Create a user mapping between Google Play and Matrix
   */
  async createUserMapping(
    reviewId: string,
    matrixUserId: string,
    authorName: string,
    packageName: string
  ): Promise<UserMapping> {
    const mappingId = `${reviewId}_${matrixUserId}`;
    
    const mapping: UserMapping = {
      id: mappingId,
      googlePlayReviewId: reviewId,
      matrixUserId,
      authorName,
      packageName,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.userMappings.set(mappingId, mapping);
    return mapping;
  }

  /**
   * Get user mapping by review ID
   */
  async getUserMappingByReviewId(reviewId: string): Promise<UserMapping | undefined> {
    for (const [, mapping] of this.userMappings) {
      if (mapping.googlePlayReviewId === reviewId) {
        return mapping;
      }
    }
    return undefined;
  }

  /**
   * Get user mapping by Matrix user ID
   */
  async getUserMappingByMatrixUserId(matrixUserId: string): Promise<UserMapping | undefined> {
    for (const [, mapping] of this.userMappings) {
      if (mapping.matrixUserId === matrixUserId) {
        return mapping;
      }
    }
    return undefined;
  }

  /**
   * Get Matrix user by user ID
   */
  getMatrixUser(userId: string): MatrixUser | undefined {
    return this.matrixUsers.get(userId);
  }

  /**
   * Get Google Play user by review ID
   */
  getGooglePlayUser(reviewId: string): GooglePlayUser | undefined {
    return this.googlePlayUsers.get(reviewId);
  }

  /**
   * Get all Matrix users
   */
  getAllMatrixUsers(): MatrixUser[] {
    return Array.from(this.matrixUsers.values());
  }

  /**
   * Get all Google Play users
   */
  getAllGooglePlayUsers(): GooglePlayUser[] {
    return Array.from(this.googlePlayUsers.values());
  }

  /**
   * Check if a Matrix user ID is managed by this bridge
   */
  isManagedUser(userId: string): boolean {
    return userId.includes('googleplay_');
  }

  /**
   * Clean up inactive users (for memory management)
   */
  cleanupInactiveUsers(maxAgeMs: number = 7 * 24 * 60 * 60 * 1000): void {
    const cutoffTime = new Date(Date.now() - maxAgeMs);

    // Clean up Matrix users
    for (const [userId, user] of this.matrixUsers) {
      if (user.isVirtual && user.lastActiveAt < cutoffTime) {
        this.matrixUsers.delete(userId);
      }
    }

    // Clean up Google Play users
    for (const [reviewId, user] of this.googlePlayUsers) {
      if (user.lastActiveAt < cutoffTime) {
        this.googlePlayUsers.delete(reviewId);
      }
    }
  }
}