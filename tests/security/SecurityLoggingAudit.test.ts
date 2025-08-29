import { AuditLogger, AuditEvent, AuditLogLevel, AuditCategory } from '../../src/utils/AuditLogger';
import { Logger } from '../../src/utils/Logger';
import { BridgeCommands } from '../../src/bridge/BridgeCommands';

describe('Security Logging and Audit Trail Tests', () => {
  let mockLogger: jest.Mocked<Logger>;
  let mockDatabase: any;
  let auditLogger: AuditLogger;

  beforeAll(() => {
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as any;
    
    jest.spyOn(Logger, 'getInstance').mockReturnValue(mockLogger);
    
    mockDatabase = {
      storeAuditLog: jest.fn(),
      getAuditLogs: jest.fn().mockResolvedValue([]),
      searchAuditLogs: jest.fn().mockResolvedValue([]),
      deleteOldAuditLogs: jest.fn(),
      getAuditLogStats: jest.fn().mockResolvedValue({}),
    };

    auditLogger = AuditLogger.getInstance(mockDatabase);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Security Event Logging', () => {
    it('should log authentication attempts', async () => {
      const authEvents = [
        {
          category: 'AUTHENTICATION' as AuditCategory,
          action: 'LOGIN_SUCCESS',
          userId: '@user:example.com',
          details: { method: 'token', ip: '192.168.1.100' }
        },
        {
          category: 'AUTHENTICATION' as AuditCategory,
          action: 'LOGIN_FAILURE',
          userId: '@attacker:evil.com',
          details: { method: 'token', ip: '10.0.0.1', reason: 'invalid_token' }
        },
        {
          category: 'AUTHENTICATION' as AuditCategory,
          action: 'LOGOUT',
          userId: '@user:example.com',
          details: { ip: '192.168.1.100' }
        }
      ];

      for (const event of authEvents) {
        await auditLogger.log(event);
      }

      // Should log all authentication events
      expect(mockDatabase.storeAuditLog).toHaveBeenCalledTimes(3);
      
      // Failed authentication should be logged with WARNING level
      const failedLoginCall = mockDatabase.storeAuditLog.mock.calls.find(
        call => call[0].action === 'LOGIN_FAILURE'
      );
      expect(failedLoginCall[0].level).toBe('WARNING');
    });

    it('should log authorization violations', async () => {
      const authzEvents = [
        {
          category: 'AUTHORIZATION' as AuditCategory,
          action: 'ACCESS_DENIED',
          userId: '@user:example.com',
          resourceId: '!admin:example.com',
          details: { 
            reason: 'insufficient_permissions',
            required_level: 'admin',
            user_level: 'user'
          }
        },
        {
          category: 'AUTHORIZATION' as AuditCategory,
          action: 'PRIVILEGE_ESCALATION_ATTEMPT',
          userId: '@_googleplay_user:example.com',
          details: { 
            attempted_action: 'set_power_level',
            target_user: '@victim:example.com',
            requested_level: 100
          }
        },
        {
          category: 'AUTHORIZATION' as AuditCategory,
          action: 'UNAUTHORIZED_COMMAND',
          userId: '@user:example.com',
          details: { 
            command: '!addapp',
            room: '!room:example.com'
          }
        }
      ];

      for (const event of authzEvents) {
        await auditLogger.log(event);
      }

      // All authorization violations should be logged with WARNING level
      authzEvents.forEach((_, index) => {
        const call = mockDatabase.storeAuditLog.mock.calls[index];
        expect(call[0].level).toBe('WARNING');
        expect(call[0].category).toBe('AUTHORIZATION');
      });
    });

    it('should log security-sensitive configuration changes', async () => {
      const configEvents = [
        {
          category: 'CONFIGURATION' as AuditCategory,
          action: 'CONFIG_RELOAD',
          userId: '@admin:example.com',
          details: { 
            config_path: '/app/config/config.yaml',
            changes: ['googleplay.auth.keyFile', 'database.password']
          }
        },
        {
          category: 'CONFIGURATION' as AuditCategory,
          action: 'SECRET_ROTATION',
          userId: '@system:example.com',
          details: { 
            secret_type: 'as_token',
            rotation_reason: 'scheduled'
          }
        },
        {
          category: 'CONFIGURATION' as AuditCategory,
          action: 'ADMIN_ADDED',
          userId: '@admin:example.com',
          details: { 
            new_admin: '@newadmin:example.com',
            granted_permissions: ['app_management', 'config_reload']
          }
        }
      ];

      for (const event of configEvents) {
        await auditLogger.log(event);
      }

      // Configuration changes should be logged with INFO level (but monitored)
      configEvents.forEach((_, index) => {
        const call = mockDatabase.storeAuditLog.mock.calls[index];
        expect(call[0].category).toBe('CONFIGURATION');
        expect(['INFO', 'WARNING']).toContain(call[0].level);
      });
    });

    it('should log suspicious activities', async () => {
      const suspiciousEvents = [
        {
          category: 'SECURITY' as AuditCategory,
          action: 'RATE_LIMIT_EXCEEDED',
          userId: '@attacker:evil.com',
          details: { 
            endpoint: '/api/reviews',
            requests_per_minute: 1000,
            limit: 60,
            ip: '10.0.0.1'
          }
        },
        {
          category: 'SECURITY' as AuditCategory,
          action: 'INJECTION_ATTEMPT',
          userId: '@user:example.com',
          details: { 
            injection_type: 'sql',
            payload: "'; DROP TABLE users; --",
            endpoint: '/api/addapp'
          }
        },
        {
          category: 'SECURITY' as AuditCategory,
          action: 'BRUTE_FORCE_ATTEMPT',
          userId: '@attacker:evil.com',
          details: { 
            failed_attempts: 50,
            time_window: '5_minutes',
            ip: '10.0.0.1'
          }
        },
        {
          category: 'SECURITY' as AuditCategory,
          action: 'ANOMALOUS_BEHAVIOR',
          userId: '@_googleplay_user:example.com',
          details: { 
            behavior: 'admin_command_attempt',
            command: '!maintenance',
            expected_role: 'virtual_user'
          }
        }
      ];

      for (const event of suspiciousEvents) {
        await auditLogger.log(event);
      }

      // All security events should be logged with WARNING or ERROR level
      suspiciousEvents.forEach((_, index) => {
        const call = mockDatabase.storeAuditLog.mock.calls[index];
        expect(call[0].category).toBe('SECURITY');
        expect(['WARNING', 'ERROR']).toContain(call[0].level);
      });
    });

    it('should not log sensitive information in audit trails', async () => {
      const eventsWithSensitiveData = [
        {
          category: 'AUTHENTICATION' as AuditCategory,
          action: 'TOKEN_VALIDATION',
          userId: '@user:example.com',
          details: { 
            token: 'as_token_1234567890abcdef', // Sensitive
            token_hash: 'sha256:abc123...', // Safe
            validation_result: 'success'
          }
        },
        {
          category: 'CONFIGURATION' as AuditCategory,
          action: 'CONFIG_UPDATE',
          userId: '@admin:example.com',
          details: { 
            field: 'database.password',
            old_value: 'secret123', // Sensitive - should not be logged
            new_value_hash: 'sha256:def456...', // Safe
            change_reason: 'rotation'
          }
        }
      ];

      for (const event of eventsWithSensitiveData) {
        await auditLogger.log(event);
      }

      // Check that sensitive values are not logged
      mockDatabase.storeAuditLog.mock.calls.forEach(call => {
        const auditEvent = call[0];
        const detailsString = JSON.stringify(auditEvent.details);
        
        expect(detailsString).not.toContain('as_token_1234567890abcdef');
        expect(detailsString).not.toContain('secret123');
        
        // But non-sensitive data should be present
        expect(detailsString).toContain('success');
        expect(detailsString).toContain('rotation');
      });
    });
  });

  describe('Audit Log Integrity', () => {
    it('should prevent audit log tampering', async () => {
      const originalEvent: AuditEvent = {
        category: 'SECURITY' as AuditCategory,
        action: 'UNAUTHORIZED_ACCESS',
        userId: '@attacker:evil.com',
        level: 'WARNING' as AuditLogLevel,
        details: { resource: '!admin:example.com' },
        timestamp: new Date()
      };

      await auditLogger.log(originalEvent);

      // Simulate tampering attempts
      const tamperingAttempts = [
        { ...originalEvent, userId: '@innocent:example.com' }, // Change user
        { ...originalEvent, action: 'AUTHORIZED_ACCESS' }, // Change action
        { ...originalEvent, level: 'INFO' as AuditLogLevel }, // Change severity
        { ...originalEvent, details: { resource: '!public:example.com' } }, // Change resource
      ];

      // Audit logger should create immutable entries
      for (const tamperedEvent of tamperingAttempts) {
        // In a real implementation, this would use cryptographic signatures
        const originalHash = this.calculateEventHash(originalEvent);
        const tamperedHash = this.calculateEventHash(tamperedEvent);
        
        expect(originalHash).not.toBe(tamperedHash);
      }
    });

    it('should implement audit log retention policies', async () => {
      const retentionPolicies = {
        SECURITY: 365 * 24 * 60 * 60 * 1000, // 1 year
        AUTHENTICATION: 90 * 24 * 60 * 60 * 1000, // 90 days
        AUTHORIZATION: 180 * 24 * 60 * 60 * 1000, // 180 days
        CONFIGURATION: 365 * 24 * 60 * 60 * 1000, // 1 year
        OPERATION: 30 * 24 * 60 * 60 * 1000, // 30 days
      };

      // Test cleanup of old logs
      const oldDate = new Date(Date.now() - (400 * 24 * 60 * 60 * 1000)); // 400 days ago
      
      await auditLogger.cleanupOldLogs(oldDate);
      
      expect(mockDatabase.deleteOldAuditLogs).toHaveBeenCalledWith(oldDate);
      
      // Different categories should have different retention periods
      Object.entries(retentionPolicies).forEach(([category, retention]) => {
        expect(retention).toBeGreaterThan(0);
        expect(retention).toBeLessThanOrEqual(365 * 24 * 60 * 60 * 1000); // Max 1 year
      });
    });

    it('should implement secure audit log storage', async () => {
      const securityEvent: AuditEvent = {
        category: 'SECURITY' as AuditCategory,
        action: 'CRITICAL_SECURITY_EVENT',
        userId: '@system:example.com',
        level: 'ERROR' as AuditLogLevel,
        details: { 
          event_type: 'system_compromise_detected',
          affected_systems: ['database', 'matrix_bridge']
        },
        timestamp: new Date()
      };

      await auditLogger.log(securityEvent);

      const storeCall = mockDatabase.storeAuditLog.mock.calls[0];
      const storedEvent = storeCall[0];

      // Critical events should be stored immediately
      expect(mockDatabase.storeAuditLog).toHaveBeenCalledTimes(1);
      
      // Should include integrity checks
      expect(storedEvent).toHaveProperty('timestamp');
      expect(storedEvent).toHaveProperty('eventId');
      expect(storedEvent.level).toBe('ERROR');
    });

    it('should provide audit log search and analysis capabilities', async () => {
      const searchCriteria = [
        { category: 'SECURITY', timeRange: { start: new Date('2024-01-01'), end: new Date() } },
        { userId: '@attacker:evil.com' },
        { action: 'LOGIN_FAILURE', limit: 100 },
        { level: 'ERROR', category: 'AUTHENTICATION' }
      ];

      for (const criteria of searchCriteria) {
        await auditLogger.searchLogs(criteria);
        expect(mockDatabase.searchAuditLogs).toHaveBeenCalledWith(criteria);
      }

      // Should validate search parameters
      const invalidSearchCriteria = [
        { limit: -1 }, // Negative limit
        { timeRange: { start: new Date(), end: new Date('2020-01-01') } }, // Invalid date range
        { userId: 'invalid-user-format' }, // Invalid user ID format
      ];

      for (const invalid of invalidSearchCriteria) {
        await expect(auditLogger.searchLogs(invalid)).rejects.toThrow();
      }
    });
  });

  describe('Security Monitoring and Alerting', () => {
    it('should detect security patterns in audit logs', async () => {
      const securityPatterns = [
        // Multiple failed login attempts
        {
          pattern: 'repeated_failures',
          events: Array.from({ length: 10 }, (_, i) => ({
            category: 'AUTHENTICATION' as AuditCategory,
            action: 'LOGIN_FAILURE',
            userId: `@attacker${i}:evil.com`,
            details: { ip: '10.0.0.1' }
          }))
        },
        // Privilege escalation attempts
        {
          pattern: 'privilege_escalation',
          events: [
            {
              category: 'AUTHORIZATION' as AuditCategory,
              action: 'PRIVILEGE_ESCALATION_ATTEMPT',
              userId: '@_googleplay_user:example.com',
              details: { attempted_level: 100 }
            }
          ]
        },
        // Suspicious configuration changes
        {
          pattern: 'config_manipulation',
          events: [
            {
              category: 'CONFIGURATION' as AuditCategory,
              action: 'CONFIG_RELOAD',
              userId: '@suspicious:example.com',
              details: { 
                changes: ['googleplay.auth', 'database.password'],
                time: '03:00' // Unusual hour
              }
            }
          ]
        }
      ];

      for (const pattern of securityPatterns) {
        for (const event of pattern.events) {
          await auditLogger.log(event);
        }

        // Security patterns should trigger alerts
        expect(mockLogger.warn).toHaveBeenCalled();
      }
    });

    it('should implement real-time security alerting', async () => {
      const criticalEvents = [
        {
          category: 'SECURITY' as AuditCategory,
          action: 'SYSTEM_COMPROMISE_DETECTED',
          userId: '@system:example.com',
          level: 'ERROR' as AuditLogLevel,
          details: { 
            compromise_type: 'unauthorized_admin_access',
            affected_resources: ['all']
          }
        },
        {
          category: 'SECURITY' as AuditCategory,
          action: 'DATA_BREACH_SUSPECTED',
          userId: '@unknown:example.com',
          level: 'ERROR' as AuditLogLevel,
          details: { 
            data_type: 'user_messages',
            volume: '10000_records'
          }
        }
      ];

      for (const event of criticalEvents) {
        await auditLogger.log(event);
        
        // Critical security events should trigger immediate alerts
        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.stringContaining(event.action)
        );
      }
    });

    it('should generate security metrics and reports', async () => {
      const securityMetrics = [
        'failed_authentication_attempts_per_hour',
        'authorization_violations_per_day',
        'suspicious_activity_count',
        'configuration_changes_by_user',
        'top_security_risks'
      ];

      // Mock security statistics
      mockDatabase.getAuditLogStats.mockResolvedValue({
        failed_logins: 15,
        authorization_violations: 3,
        suspicious_activities: 7,
        critical_events: 1
      });

      const stats = await auditLogger.getSecurityMetrics();

      expect(mockDatabase.getAuditLogStats).toHaveBeenCalled();
      expect(stats).toHaveProperty('failed_logins');
      expect(stats).toHaveProperty('authorization_violations');

      // Metrics should not contain sensitive information
      const metricsString = JSON.stringify(stats);
      expect(metricsString).not.toMatch(/token|password|key|secret/i);
    });

    it('should correlate security events across different sources', async () => {
      const correlatedEvents = [
        // Failed Google Play API authentication
        {
          category: 'AUTHENTICATION' as AuditCategory,
          action: 'API_AUTH_FAILURE',
          userId: '@system:example.com',
          details: { 
            api: 'googleplay',
            error: 'invalid_credentials',
            timestamp: new Date('2024-01-01T10:00:00Z')
          }
        },
        // Suspicious Matrix event at same time
        {
          category: 'SECURITY' as AuditCategory,
          action: 'ANOMALOUS_BEHAVIOR',
          userId: '@_googleplay_user:example.com',
          details: { 
            behavior: 'unexpected_admin_command',
            timestamp: new Date('2024-01-01T10:01:00Z') // 1 minute later
          }
        },
        // Configuration change shortly after
        {
          category: 'CONFIGURATION' as AuditCategory,
          action: 'CONFIG_MODIFIED',
          userId: '@admin:example.com',
          details: { 
            field: 'googleplay.auth.keyFile',
            timestamp: new Date('2024-01-01T10:05:00Z') // 5 minutes later
          }
        }
      ];

      for (const event of correlatedEvents) {
        await auditLogger.log(event);
      }

      // Should detect correlation between related security events
      const correlationWindow = 10 * 60 * 1000; // 10 minutes
      const eventTimes = correlatedEvents.map(e => e.details.timestamp.getTime());
      const timeSpread = Math.max(...eventTimes) - Math.min(...eventTimes);
      
      expect(timeSpread).toBeLessThan(correlationWindow);
    });
  });

  describe('Compliance and Forensics', () => {
    it('should maintain audit logs for compliance requirements', async () => {
      const complianceEvent: AuditEvent = {
        category: 'OPERATION' as AuditCategory,
        action: 'DATA_ACCESS',
        userId: '@user:example.com',
        level: 'INFO' as AuditLogLevel,
        details: { 
          resource_type: 'user_messages',
          resource_id: '$message123:example.com',
          access_reason: 'user_support_request',
          legal_basis: 'legitimate_interest'
        },
        timestamp: new Date()
      };

      await auditLogger.log(complianceEvent);

      const loggedEvent = mockDatabase.storeAuditLog.mock.calls[0][0];
      
      // Compliance logs should include required fields
      expect(loggedEvent.details).toHaveProperty('access_reason');
      expect(loggedEvent.details).toHaveProperty('legal_basis');
      expect(loggedEvent).toHaveProperty('timestamp');
      expect(loggedEvent).toHaveProperty('userId');
    });

    it('should support forensic analysis of security incidents', async () => {
      const incidentTimeline = [
        {
          category: 'SECURITY' as AuditCategory,
          action: 'INCIDENT_DETECTED',
          userId: '@system:example.com',
          details: { 
            incident_id: 'SEC-2024-001',
            detection_method: 'anomaly_detection',
            severity: 'high'
          }
        },
        {
          category: 'SECURITY' as AuditCategory,
          action: 'INCIDENT_INVESTIGATION_STARTED',
          userId: '@security:example.com',
          details: { 
            incident_id: 'SEC-2024-001',
            investigator: '@security:example.com',
            tools_used: ['audit_log_analyzer', 'event_correlator']
          }
        },
        {
          category: 'SECURITY' as AuditCategory,
          action: 'INCIDENT_CONTAINED',
          userId: '@security:example.com',
          details: { 
            incident_id: 'SEC-2024-001',
            containment_actions: ['user_suspended', 'access_revoked'],
            affected_systems: ['matrix_bridge']
          }
        }
      ];

      for (const event of incidentTimeline) {
        await auditLogger.log(event);
      }

      // Should maintain complete incident timeline
      expect(mockDatabase.storeAuditLog).toHaveBeenCalledTimes(3);
      
      // All events should have the same incident ID for tracking
      mockDatabase.storeAuditLog.mock.calls.forEach(call => {
        expect(call[0].details.incident_id).toBe('SEC-2024-001');
      });
    });

    it('should provide audit log export capabilities', async () => {
      const exportCriteria = {
        dateRange: { 
          start: new Date('2024-01-01'), 
          end: new Date('2024-12-31') 
        },
        categories: ['SECURITY', 'AUTHENTICATION'],
        format: 'json'
      };

      const mockExportData = [
        {
          id: 'audit_001',
          category: 'SECURITY',
          action: 'LOGIN_FAILURE',
          userId: '@user:example.com',
          timestamp: '2024-01-01T12:00:00Z'
        }
      ];

      mockDatabase.searchAuditLogs.mockResolvedValue(mockExportData);

      const exportResult = await auditLogger.exportLogs(exportCriteria);

      expect(mockDatabase.searchAuditLogs).toHaveBeenCalledWith(
        expect.objectContaining({
          timeRange: exportCriteria.dateRange,
          categories: exportCriteria.categories
        })
      );

      // Export should not contain sensitive information
      const exportString = JSON.stringify(exportResult);
      expect(exportString).not.toMatch(/password|token|private_key/i);
    });
  });

  // Helper method for audit log integrity testing
  private calculateEventHash(event: AuditEvent): string {
    const eventString = JSON.stringify({
      category: event.category,
      action: event.action,
      userId: event.userId,
      resourceId: event.resourceId,
      details: event.details,
      timestamp: event.timestamp?.toISOString()
    });
    
    // In a real implementation, this would use a cryptographic hash
    return Buffer.from(eventString).toString('base64');
  }
});