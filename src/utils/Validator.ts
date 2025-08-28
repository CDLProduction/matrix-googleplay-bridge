/**
 * Utility class for configuration validation
 */
export class Validator {
  /**
   * Validate that a value is not null or undefined
   */
  validateRequired(value: any, fieldName: string): void {
    if (value === null || value === undefined || value === '') {
      throw new Error(`Missing required field: ${fieldName}`);
    }
  }

  /**
   * Validate that a value is a valid URL
   */
  validateUrl(value: string, fieldName: string): void {
    try {
      new URL(value);
    } catch {
      throw new Error(`Invalid URL for field: ${fieldName}`);
    }
  }

  /**
   * Validate that a value is a valid port number
   */
  validatePort(value: number, fieldName: string): void {
    if (!Number.isInteger(value) || value < 1 || value > 65535) {
      throw new Error(
        `Invalid port number for field: ${fieldName}. Must be between 1 and 65535.`
      );
    }
  }

  /**
   * Validate that a value is an array
   */
  validateArray(value: any, fieldName: string): void {
    if (!Array.isArray(value)) {
      throw new Error(`Field ${fieldName} must be an array`);
    }
  }

  /**
   * Validate that a value is a string
   */
  validateString(value: any, fieldName: string): void {
    if (typeof value !== 'string') {
      throw new Error(`Field ${fieldName} must be a string`);
    }
  }

  /**
   * Validate that a value is a number
   */
  validateNumber(value: any, fieldName: string): void {
    if (typeof value !== 'number' || isNaN(value)) {
      throw new Error(`Field ${fieldName} must be a valid number`);
    }
  }

  /**
   * Validate that a value is a boolean
   */
  validateBoolean(value: any, fieldName: string): void {
    if (typeof value !== 'boolean') {
      throw new Error(`Field ${fieldName} must be a boolean`);
    }
  }

  /**
   * Validate that a string matches a regex pattern
   */
  validatePattern(value: string, pattern: RegExp, fieldName: string): void {
    if (!pattern.test(value)) {
      throw new Error(`Field ${fieldName} does not match required pattern`);
    }
  }

  /**
   * Validate that a value is one of the allowed values
   */
  validateEnum<T>(value: T, allowedValues: T[], fieldName: string): void {
    if (!allowedValues.includes(value)) {
      throw new Error(
        `Field ${fieldName} must be one of: ${allowedValues.join(', ')}`
      );
    }
  }
}
