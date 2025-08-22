import { RRuleManager, rruleManager } from '../utils/rruleManager.js';

describe('RRuleManager', () => {
	let manager;

	beforeEach(() => {
		manager = new RRuleManager();
	});

	describe('constructor', () => {
		it('should initialize with supported fields', () => {
			expect(manager.supportedFields).toEqual([
				'FREQ',
				'INTERVAL',
				'COUNT',
				'UNTIL',
			]);
		});
	});

	describe('toRRule', () => {
		describe('basic frequency handling', () => {
			it('should return empty string for missing frequency', () => {
				expect(manager.toRRule({})).toBe('');
				expect(manager.toRRule(null)).toBe('');
				expect(manager.toRRule(undefined)).toBe('');
			});

			it('should handle DAILY frequency', () => {
				const uiState = { frequency: 'DAILY' };
				expect(manager.toRRule(uiState)).toBe('FREQ=DAILY');
			});

			it('should handle WEEKLY frequency', () => {
				const uiState = { frequency: 'WEEKLY' };
				expect(manager.toRRule(uiState)).toBe('FREQ=WEEKLY');
			});

			it('should handle MONTHLY frequency', () => {
				const uiState = { frequency: 'MONTHLY' };
				expect(manager.toRRule(uiState)).toBe('FREQ=MONTHLY');
			});

			it('should handle YEARLY frequency', () => {
				const uiState = { frequency: 'YEARLY' };
				expect(manager.toRRule(uiState)).toBe('FREQ=YEARLY');
			});
		});

		describe('BIWEEKLY special handling', () => {
			it('should convert BIWEEKLY to WEEKLY with INTERVAL=2', () => {
				const uiState = { frequency: 'BIWEEKLY' };
				expect(manager.toRRule(uiState)).toBe('FREQ=WEEKLY;INTERVAL=2');
			});

			it('should handle BIWEEKLY with count', () => {
				const uiState = { frequency: 'BIWEEKLY', count: 5 };
				expect(manager.toRRule(uiState)).toBe(
					'FREQ=WEEKLY;INTERVAL=2;COUNT=5'
				);
			});

			it('should handle BIWEEKLY with until date', () => {
				const uiState = { frequency: 'BIWEEKLY', until: '2024-12-31' };
				expect(manager.toRRule(uiState)).toBe(
					'FREQ=WEEKLY;INTERVAL=2;UNTIL=20241231'
				);
			});
		});

		describe('interval handling', () => {
			it('should add INTERVAL when greater than 1', () => {
				const uiState = { frequency: 'DAILY', interval: 3 };
				expect(manager.toRRule(uiState)).toBe('FREQ=DAILY;INTERVAL=3');
			});

			it('should not add INTERVAL when equal to 1', () => {
				const uiState = { frequency: 'DAILY', interval: 1 };
				expect(manager.toRRule(uiState)).toBe('FREQ=DAILY');
			});

			it('should not add INTERVAL when less than 1', () => {
				const uiState = { frequency: 'DAILY', interval: 0 };
				expect(manager.toRRule(uiState)).toBe('FREQ=DAILY');
			});

			it('should not add INTERVAL when undefined', () => {
				const uiState = { frequency: 'DAILY' };
				expect(manager.toRRule(uiState)).toBe('FREQ=DAILY');
			});
		});

		describe('count handling', () => {
			it('should add COUNT when positive', () => {
				const uiState = { frequency: 'WEEKLY', count: 10 };
				expect(manager.toRRule(uiState)).toBe('FREQ=WEEKLY;COUNT=10');
			});

			it('should not add COUNT when zero', () => {
				const uiState = { frequency: 'WEEKLY', count: 0 };
				expect(manager.toRRule(uiState)).toBe('FREQ=WEEKLY');
			});

			it('should not add COUNT when negative', () => {
				const uiState = { frequency: 'WEEKLY', count: -1 };
				expect(manager.toRRule(uiState)).toBe('FREQ=WEEKLY');
			});

			it('should not add COUNT when null', () => {
				const uiState = { frequency: 'WEEKLY', count: null };
				expect(manager.toRRule(uiState)).toBe('FREQ=WEEKLY');
			});

			it('should not add COUNT when undefined', () => {
				const uiState = { frequency: 'WEEKLY' };
				expect(manager.toRRule(uiState)).toBe('FREQ=WEEKLY');
			});
		});

		describe('until date handling', () => {
			it('should add UNTIL when valid date provided', () => {
				const uiState = { frequency: 'WEEKLY', until: '2024-12-31' };
				expect(manager.toRRule(uiState)).toBe(
					'FREQ=WEEKLY;UNTIL=20241231'
				);
			});

			it('should not add UNTIL when empty string', () => {
				const uiState = { frequency: 'WEEKLY', until: '' };
				expect(manager.toRRule(uiState)).toBe('FREQ=WEEKLY');
			});

			it('should not add UNTIL when null', () => {
				const uiState = { frequency: 'WEEKLY', until: null };
				expect(manager.toRRule(uiState)).toBe('FREQ=WEEKLY');
			});

			it('should not add UNTIL when undefined', () => {
				const uiState = { frequency: 'WEEKLY' };
				expect(manager.toRRule(uiState)).toBe('FREQ=WEEKLY');
			});

			it('should not add UNTIL when date format is invalid', () => {
				const uiState = { frequency: 'WEEKLY', until: 'invalid-date' };
				expect(manager.toRRule(uiState)).toBe('FREQ=WEEKLY');
			});
		});

		describe('count and until mutual exclusivity', () => {
			it('should prefer COUNT over UNTIL when both provided', () => {
				const uiState = {
					frequency: 'WEEKLY',
					count: 5,
					until: '2024-12-31',
				};
				expect(manager.toRRule(uiState)).toBe('FREQ=WEEKLY;COUNT=5');
			});

			it('should use UNTIL when count is zero and until is provided', () => {
				const uiState = {
					frequency: 'WEEKLY',
					count: 0,
					until: '2024-12-31',
				};
				expect(manager.toRRule(uiState)).toBe(
					'FREQ=WEEKLY;UNTIL=20241231'
				);
			});

			it('should use UNTIL when count is null and until is provided', () => {
				const uiState = {
					frequency: 'WEEKLY',
					count: null,
					until: '2024-12-31',
				};
				expect(manager.toRRule(uiState)).toBe(
					'FREQ=WEEKLY;UNTIL=20241231'
				);
			});
		});

		describe('complex combinations', () => {
			it('should handle frequency with interval and count', () => {
				const uiState = {
					frequency: 'DAILY',
					interval: 2,
					count: 10,
				};
				expect(manager.toRRule(uiState)).toBe(
					'FREQ=DAILY;INTERVAL=2;COUNT=10'
				);
			});

			it('should handle frequency with interval and until', () => {
				const uiState = {
					frequency: 'MONTHLY',
					interval: 3,
					until: '2024-12-31',
				};
				expect(manager.toRRule(uiState)).toBe(
					'FREQ=MONTHLY;INTERVAL=3;UNTIL=20241231'
				);
			});

			it('should handle all parameters with count taking priority', () => {
				const uiState = {
					frequency: 'WEEKLY',
					interval: 2,
					count: 5,
					until: '2024-12-31',
				};
				expect(manager.toRRule(uiState)).toBe(
					'FREQ=WEEKLY;INTERVAL=2;COUNT=5'
				);
			});
		});
	});

	describe('formatUntilDate', () => {
		it('should format valid YYYY-MM-DD date', () => {
			expect(manager.formatUntilDate('2024-12-31')).toBe('20241231');
			expect(manager.formatUntilDate('2024-01-01')).toBe('20240101');
			expect(manager.formatUntilDate('2024-06-15')).toBe('20240615');
		});

		it('should return empty string for invalid inputs', () => {
			expect(manager.formatUntilDate('')).toBe('');
			expect(manager.formatUntilDate(null)).toBe('');
			expect(manager.formatUntilDate(undefined)).toBe('');
			expect(manager.formatUntilDate(123)).toBe('');
			expect(manager.formatUntilDate({})).toBe('');
			expect(manager.formatUntilDate([])).toBe('');
		});

		it('should return empty string for invalid date formats', () => {
			expect(manager.formatUntilDate('invalid-date')).toBe('');
			expect(manager.formatUntilDate('2024/12/31')).toBe('');
			expect(manager.formatUntilDate('24-12-31')).toBe(''); // Invalid year format
		});

		it('should format strings that become 8 digits after removing hyphens', () => {
			// Note: Current implementation only validates 8-digit pattern, not actual date validity
			expect(manager.formatUntilDate('31-12-2024')).toBe('31122024');
			expect(manager.formatUntilDate('2024-13-01')).toBe('20241301'); // Invalid month but 8 digits
			expect(manager.formatUntilDate('2024-12-32')).toBe('20241232'); // Invalid day but 8 digits
		});

		it('should return empty string for incomplete dates', () => {
			expect(manager.formatUntilDate('2024')).toBe('');
			expect(manager.formatUntilDate('2024-12')).toBe('');
			expect(manager.formatUntilDate('2024-1-1')).toBe(''); // Single digit month/day
		});
	});

	describe('exported instance', () => {
		it('should export a default instance', () => {
			expect(rruleManager).toBeInstanceOf(RRuleManager);
		});

		it('should work the same as a new instance', () => {
			const uiState = { frequency: 'WEEKLY', count: 5 };
			const newInstance = new RRuleManager();

			expect(rruleManager.toRRule(uiState)).toBe(
				newInstance.toRRule(uiState)
			);
			expect(rruleManager.formatUntilDate('2024-12-31')).toBe(
				newInstance.formatUntilDate('2024-12-31')
			);
		});
	});
});
