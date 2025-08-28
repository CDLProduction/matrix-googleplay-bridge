import { Validator } from '../../src/utils/Validator';

describe('Validator', () => {
  let validator: Validator;

  beforeEach(() => {
    validator = new Validator();
  });

  describe('validateRequired', () => {
    it('should not throw for valid values', () => {
      expect(() => validator.validateRequired('test', 'field')).not.toThrow();
      expect(() => validator.validateRequired(0, 'field')).not.toThrow();
      expect(() => validator.validateRequired(false, 'field')).not.toThrow();
    });

    it('should throw for null, undefined, or empty string', () => {
      expect(() => validator.validateRequired(null, 'field')).toThrow('Missing required field: field');
      expect(() => validator.validateRequired(undefined, 'field')).toThrow('Missing required field: field');
      expect(() => validator.validateRequired('', 'field')).toThrow('Missing required field: field');
    });
  });

  describe('validateUrl', () => {
    it('should not throw for valid URLs', () => {
      expect(() => validator.validateUrl('https://example.com', 'url')).not.toThrow();
      expect(() => validator.validateUrl('http://localhost:8080', 'url')).not.toThrow();
    });

    it('should throw for invalid URLs', () => {
      expect(() => validator.validateUrl('not-a-url', 'url')).toThrow('Invalid URL for field: url');
      expect(() => validator.validateUrl('', 'url')).toThrow('Invalid URL for field: url');
    });
  });

  describe('validatePort', () => {
    it('should not throw for valid ports', () => {
      expect(() => validator.validatePort(80, 'port')).not.toThrow();
      expect(() => validator.validatePort(8080, 'port')).not.toThrow();
      expect(() => validator.validatePort(65535, 'port')).not.toThrow();
    });

    it('should throw for invalid ports', () => {
      expect(() => validator.validatePort(0, 'port')).toThrow('Invalid port number for field: port');
      expect(() => validator.validatePort(-1, 'port')).toThrow('Invalid port number for field: port');
      expect(() => validator.validatePort(65536, 'port')).toThrow('Invalid port number for field: port');
      expect(() => validator.validatePort(1.5, 'port')).toThrow('Invalid port number for field: port');
    });
  });

  describe('validateArray', () => {
    it('should not throw for arrays', () => {
      expect(() => validator.validateArray([], 'array')).not.toThrow();
      expect(() => validator.validateArray(['item'], 'array')).not.toThrow();
    });

    it('should throw for non-arrays', () => {
      expect(() => validator.validateArray('not-array', 'array')).toThrow('Field array must be an array');
      expect(() => validator.validateArray({}, 'array')).toThrow('Field array must be an array');
    });
  });

  describe('validateString', () => {
    it('should not throw for strings', () => {
      expect(() => validator.validateString('test', 'string')).not.toThrow();
      expect(() => validator.validateString('', 'string')).not.toThrow();
    });

    it('should throw for non-strings', () => {
      expect(() => validator.validateString(123, 'string')).toThrow('Field string must be a string');
      expect(() => validator.validateString(null, 'string')).toThrow('Field string must be a string');
    });
  });

  describe('validateNumber', () => {
    it('should not throw for valid numbers', () => {
      expect(() => validator.validateNumber(123, 'number')).not.toThrow();
      expect(() => validator.validateNumber(0, 'number')).not.toThrow();
      expect(() => validator.validateNumber(-1, 'number')).not.toThrow();
      expect(() => validator.validateNumber(1.5, 'number')).not.toThrow();
    });

    it('should throw for invalid numbers', () => {
      expect(() => validator.validateNumber('123', 'number')).toThrow('Field number must be a valid number');
      expect(() => validator.validateNumber(NaN, 'number')).toThrow('Field number must be a valid number');
      expect(() => validator.validateNumber(null, 'number')).toThrow('Field number must be a valid number');
    });
  });

  describe('validateBoolean', () => {
    it('should not throw for booleans', () => {
      expect(() => validator.validateBoolean(true, 'boolean')).not.toThrow();
      expect(() => validator.validateBoolean(false, 'boolean')).not.toThrow();
    });

    it('should throw for non-booleans', () => {
      expect(() => validator.validateBoolean('true', 'boolean')).toThrow('Field boolean must be a boolean');
      expect(() => validator.validateBoolean(1, 'boolean')).toThrow('Field boolean must be a boolean');
    });
  });

  describe('validatePattern', () => {
    it('should not throw for matching patterns', () => {
      expect(() => validator.validatePattern('test@example.com', /\S+@\S+\.\S+/, 'email')).not.toThrow();
    });

    it('should throw for non-matching patterns', () => {
      expect(() => validator.validatePattern('invalid-email', /\S+@\S+\.\S+/, 'email')).toThrow('Field email does not match required pattern');
    });
  });

  describe('validateEnum', () => {
    it('should not throw for allowed values', () => {
      expect(() => validator.validateEnum('red', ['red', 'green', 'blue'], 'color')).not.toThrow();
    });

    it('should throw for disallowed values', () => {
      expect(() => validator.validateEnum('purple', ['red', 'green', 'blue'], 'color')).toThrow('Field color must be one of: red, green, blue');
    });
  });
});