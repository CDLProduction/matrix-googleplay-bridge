import { Logger } from '../../src/utils/Logger';

describe('Logger', () => {
  it('should create a singleton instance', () => {
    const logger1 = Logger.getInstance();
    const logger2 = Logger.getInstance();
    
    expect(logger1).toBe(logger2);
  });

  it('should have info and error methods', () => {
    const logger = Logger.getInstance();
    
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.error).toBe('function');
  });
});