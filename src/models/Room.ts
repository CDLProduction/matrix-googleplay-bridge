/**
 * Room data models for Matrix Google Play Bridge
 */

/**
 * Represents a Matrix room in the bridge system
 */
export interface MatrixRoom {
  /** Matrix room ID (e.g., !room:domain.com) */
  roomId: string;
  /** Human-readable room name */
  name?: string;
  /** Room topic/description */
  topic?: string;
  /** Room avatar URL */
  avatarUrl?: string;
  /** Whether the bridge bot is joined to this room */
  isBridgeJoined: boolean;
  /** Timestamp when the room was created */
  createdAt: Date;
  /** Timestamp when the room was last active */
  lastActiveAt: Date;
}

/**
 * Represents a Google Play app's review room mapping
 */
export interface GooglePlayAppRoom {
  /** Google Play package name (e.g., com.example.app) */
  packageName: string;
  /** Human-readable app name */
  appName: string;
  /** Associated Matrix room ID */
  matrixRoomId: string;
  /** Whether this is the primary room for this app */
  isPrimary: boolean;
  /** Timestamp when the mapping was created */
  createdAt: Date;
  /** Timestamp when the mapping was last updated */
  updatedAt: Date;
}

/**
 * Room mapping between Google Play apps and Matrix rooms
 */
export interface RoomMapping {
  /** Internal mapping ID */
  id: string;
  /** Google Play package name */
  packageName: string;
  /** Matrix room ID */
  matrixRoomId: string;
  /** App name for display purposes */
  appName: string;
  /** Room type (e.g., 'reviews', 'admin') */
  roomType: 'reviews' | 'admin' | 'general';
  /** Configuration for this room mapping */
  config: RoomMappingConfig;
  /** Timestamp when the mapping was created */
  createdAt: Date;
  /** Timestamp when the mapping was last updated */
  updatedAt: Date;
}

/**
 * Configuration options for room mappings
 */
export interface RoomMappingConfig {
  /** Whether to forward reviews to this room */
  forwardReviews: boolean;
  /** Whether to allow replies from this room */
  allowReplies: boolean;
  /** Minimum rating to forward (1-5, or 0 for all) */
  minRatingToForward: number;
  /** Whether to forward only new reviews or include updates */
  forwardUpdatesOnly: boolean;
  /** Custom message templates */
  messageTemplates?: MessageTemplates;
}

/**
 * Message templates for room formatting
 */
export interface MessageTemplates {
  /** Template for new review messages */
  newReview?: string;
  /** Template for review update messages */
  updatedReview?: string;
  /** Template for reply confirmation messages */
  replyConfirmation?: string;
  /** Template for error messages */
  errorMessage?: string;
}

/**
 * Room management class for handling Matrix rooms and Google Play app mappings
 */
export class RoomManager {
  private matrixRooms: Map<string, MatrixRoom> = new Map();
  private appRooms: Map<string, GooglePlayAppRoom> = new Map();
  private roomMappings: Map<string, RoomMapping> = new Map();

  /**
   * Register a Matrix room with the bridge
   */
  async registerMatrixRoom(
    roomId: string,
    name?: string,
    topic?: string
  ): Promise<MatrixRoom> {
    let room = this.matrixRooms.get(roomId);
    if (room) {
      // Update existing room info
      if (name) room.name = name;
      if (topic) room.topic = topic;
      room.lastActiveAt = new Date();
      return room;
    }

    // Create new room record
    room = {
      roomId,
      ...(name && { name }),
      ...(topic && { topic }),
      isBridgeJoined: false,
      createdAt: new Date(),
      lastActiveAt: new Date(),
    };

    this.matrixRooms.set(roomId, room);
    return room;
  }

  /**
   * Mark a room as joined by the bridge bot
   */
  async markRoomJoined(roomId: string): Promise<void> {
    const room = this.matrixRooms.get(roomId);
    if (room) {
      room.isBridgeJoined = true;
      room.lastActiveAt = new Date();
    } else {
      // Create room entry if it doesn't exist
      await this.registerMatrixRoom(roomId);
      const newRoom = this.matrixRooms.get(roomId);
      if (newRoom) {
        newRoom.isBridgeJoined = true;
      }
    }
  }

  /**
   * Create or update an app room mapping
   */
  async createAppRoomMapping(
    packageName: string,
    appName: string,
    matrixRoomId: string,
    isPrimary: boolean = true
  ): Promise<GooglePlayAppRoom> {
    const mappingId = `${packageName}_${matrixRoomId}`;
    
    let appRoom = this.appRooms.get(mappingId);
    if (appRoom) {
      // Update existing mapping
      appRoom.appName = appName;
      appRoom.isPrimary = isPrimary;
      appRoom.updatedAt = new Date();
      return appRoom;
    }

    // Create new app room mapping
    appRoom = {
      packageName,
      appName,
      matrixRoomId,
      isPrimary,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.appRooms.set(mappingId, appRoom);
    return appRoom;
  }

  /**
   * Create a room mapping with configuration
   */
  async createRoomMapping(
    packageName: string,
    matrixRoomId: string,
    appName: string,
    roomType: 'reviews' | 'admin' | 'general' = 'reviews',
    config?: Partial<RoomMappingConfig>
  ): Promise<RoomMapping> {
    const mappingId = `${packageName}_${matrixRoomId}_${roomType}`;

    const defaultConfig: RoomMappingConfig = {
      forwardReviews: true,
      allowReplies: true,
      minRatingToForward: 0,
      forwardUpdatesOnly: false,
    };

    const finalConfig = { ...defaultConfig, ...config };

    const mapping: RoomMapping = {
      id: mappingId,
      packageName,
      matrixRoomId,
      appName,
      roomType,
      config: finalConfig,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.roomMappings.set(mappingId, mapping);
    return mapping;
  }

  /**
   * Get room mappings for a specific package
   */
  async getRoomMappingsForApp(packageName: string): Promise<RoomMapping[]> {
    const mappings: RoomMapping[] = [];
    for (const [, mapping] of this.roomMappings) {
      if (mapping.packageName === packageName) {
        mappings.push(mapping);
      }
    }
    return mappings;
  }

  /**
   * Get room mapping by Matrix room ID
   */
  async getRoomMappingByRoomId(matrixRoomId: string): Promise<RoomMapping | undefined> {
    for (const [, mapping] of this.roomMappings) {
      if (mapping.matrixRoomId === matrixRoomId) {
        return mapping;
      }
    }
    return undefined;
  }

  /**
   * Get the primary room for an app
   */
  async getPrimaryRoomForApp(packageName: string): Promise<GooglePlayAppRoom | undefined> {
    for (const [, appRoom] of this.appRooms) {
      if (appRoom.packageName === packageName && appRoom.isPrimary) {
        return appRoom;
      }
    }
    return undefined;
  }

  /**
   * Get all rooms mapped to a specific app
   */
  async getRoomsForApp(packageName: string): Promise<GooglePlayAppRoom[]> {
    const rooms: GooglePlayAppRoom[] = [];
    for (const [, appRoom] of this.appRooms) {
      if (appRoom.packageName === packageName) {
        rooms.push(appRoom);
      }
    }
    return rooms;
  }

  /**
   * Check if a room should receive reviews for an app
   */
  async shouldForwardReview(
    packageName: string,
    matrixRoomId: string,
    rating?: number
  ): Promise<boolean> {
    const mapping = await this.getRoomMappingByRoomId(matrixRoomId);
    if (!mapping || mapping.packageName !== packageName) {
      return false;
    }

    if (!mapping.config.forwardReviews) {
      return false;
    }

    if (rating !== undefined && mapping.config.minRatingToForward > 0) {
      return rating >= mapping.config.minRatingToForward;
    }

    return true;
  }

  /**
   * Check if a room allows replies to Google Play
   */
  async canSendReply(matrixRoomId: string): Promise<boolean> {
    const mapping = await this.getRoomMappingByRoomId(matrixRoomId);
    return mapping?.config.allowReplies ?? false;
  }

  /**
   * Get Matrix room by ID
   */
  getMatrixRoom(roomId: string): MatrixRoom | undefined {
    return this.matrixRooms.get(roomId);
  }

  /**
   * Get all Matrix rooms
   */
  getAllMatrixRooms(): MatrixRoom[] {
    return Array.from(this.matrixRooms.values());
  }

  /**
   * Get all app room mappings
   */
  getAllAppRooms(): GooglePlayAppRoom[] {
    return Array.from(this.appRooms.values());
  }

  /**
   * Get all room mappings
   */
  getAllRoomMappings(): RoomMapping[] {
    return Array.from(this.roomMappings.values());
  }

  /**
   * Update room mapping configuration
   */
  async updateRoomMappingConfig(
    matrixRoomId: string,
    config: Partial<RoomMappingConfig>
  ): Promise<boolean> {
    const mapping = await this.getRoomMappingByRoomId(matrixRoomId);
    if (!mapping) {
      return false;
    }

    mapping.config = { ...mapping.config, ...config };
    mapping.updatedAt = new Date();
    return true;
  }

  /**
   * Remove a room mapping
   */
  async removeRoomMapping(matrixRoomId: string): Promise<boolean> {
    const mapping = await this.getRoomMappingByRoomId(matrixRoomId);
    if (!mapping) {
      return false;
    }

    this.roomMappings.delete(mapping.id);
    
    // Also remove from app rooms
    const appRoomKey = `${mapping.packageName}_${matrixRoomId}`;
    this.appRooms.delete(appRoomKey);

    return true;
  }

  /**
   * Get room statistics
   */
  getRoomStats(): {
    totalRooms: number;
    bridgeJoinedRooms: number;
    totalAppMappings: number;
    totalRoomMappings: number;
  } {
    const totalRooms = this.matrixRooms.size;
    const bridgeJoinedRooms = Array.from(this.matrixRooms.values()).filter(
      room => room.isBridgeJoined
    ).length;

    return {
      totalRooms,
      bridgeJoinedRooms,
      totalAppMappings: this.appRooms.size,
      totalRoomMappings: this.roomMappings.size,
    };
  }
}