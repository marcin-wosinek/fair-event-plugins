import {
	RRuleManager,
	rruleManager,
} from '../src/blocks/calendar-button/utils/rruleManager.js';
import { parseISO } from 'date-fns';

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
					frequency: 'WEEKLY',
					interval: 3,
					until: '2024-12-31',
				};
				expect(manager.toRRule(uiState)).toBe(
					'FREQ=WEEKLY;INTERVAL=3;UNTIL=20241231'
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

	describe('generateEvents', () => {
		describe('basic functionality', () => {
			it('should return empty array for invalid inputs', () => {
				expect(manager.generateEvents(null, '2024-01-01')).toEqual([]);
				expect(manager.generateEvents({}, '2024-01-01')).toEqual([]);
				expect(
					manager.generateEvents({ frequency: 'WEEKLY' }, '')
				).toEqual([]);
				expect(
					manager.generateEvents({ frequency: 'WEEKLY' }, null)
				).toEqual([]);
				expect(
					manager.generateEvents(
						{ frequency: 'WEEKLY' },
						'invalid-date'
					)
				).toEqual([]);
			});

			it('should include start date as first event', () => {
				const uiState = { frequency: 'WEEKLY' };
				const startDate = '2024-01-01';
				const events = manager.generateEvents(uiState, startDate);

				expect(events.length).toBeGreaterThan(0);
				expect(events[0]).toEqual(parseISO('2024-01-01'));
			});

			it('should handle datetime-local format start dates', () => {
				const uiState = { frequency: 'WEEKLY' };
				const events = manager.generateEvents(
					uiState,
					'2024-01-01T10:00:00'
				);

				expect(events.length).toBeGreaterThan(0);
				expect(events[0]).toEqual(parseISO('2024-01-01T10:00:00'));
			});
		});

		describe('frequency handling', () => {
			it('should generate daily events', () => {
				const uiState = { frequency: 'DAILY' };
				const events = manager.generateEvents(uiState, '2024-01-01', 5);

				expect(events).toHaveLength(5);
				expect(events[0]).toEqual(parseISO('2024-01-01'));
				expect(events[1]).toEqual(parseISO('2024-01-02'));
				expect(events[2]).toEqual(parseISO('2024-01-03'));
				expect(events[3]).toEqual(parseISO('2024-01-04'));
				expect(events[4]).toEqual(parseISO('2024-01-05'));
			});

			it('should generate weekly events', () => {
				const uiState = { frequency: 'WEEKLY' };
				const events = manager.generateEvents(uiState, '2024-01-01', 3);

				expect(events).toHaveLength(3);
				expect(events[0]).toEqual(parseISO('2024-01-01'));
				expect(events[1]).toEqual(parseISO('2024-01-08'));
				expect(events[2]).toEqual(parseISO('2024-01-15'));
			});

			it('should generate weekly events spanning multiple months', () => {
				const uiState = { frequency: 'WEEKLY' };
				const events = manager.generateEvents(uiState, '2024-01-22', 6);

				expect(events).toHaveLength(6);
				expect(events[0]).toEqual(parseISO('2024-01-22')); // Monday in January
				expect(events[1]).toEqual(parseISO('2024-01-29')); // Last Monday in January
				expect(events[2]).toEqual(parseISO('2024-02-05')); // First Monday in February
				expect(events[3]).toEqual(parseISO('2024-02-12')); // Second Monday in February
				expect(events[4]).toEqual(parseISO('2024-02-19')); // Third Monday in February
				expect(events[5]).toEqual(parseISO('2024-02-26')); // Fourth Monday in February
			});

			it('should generate weekly events across leap year February', () => {
				const uiState = { frequency: 'WEEKLY' };
				const events = manager.generateEvents(uiState, '2024-02-26', 4);

				expect(events).toHaveLength(4);
				expect(events[0]).toEqual(parseISO('2024-02-26')); // Last Monday in February (leap year)
				expect(events[1]).toEqual(parseISO('2024-03-04')); // First Monday in March
				expect(events[2]).toEqual(parseISO('2024-03-11')); // Second Monday in March
				expect(events[3]).toEqual(parseISO('2024-03-18')); // Third Monday in March
			});

			it('should generate weekly events with custom interval spanning months', () => {
				const uiState = { frequency: 'WEEKLY', interval: 3 };
				const events = manager.generateEvents(uiState, '2024-01-15', 5);

				expect(events).toHaveLength(5);
				expect(events[0]).toEqual(parseISO('2024-01-15')); // Monday in January
				expect(events[1]).toEqual(parseISO('2024-02-05')); // 3 weeks later, February
				expect(events[2]).toEqual(parseISO('2024-02-26')); // 3 weeks later, still February
				expect(events[3]).toEqual(parseISO('2024-03-18')); // 3 weeks later, March
				expect(events[4]).toEqual(parseISO('2024-04-08')); // 3 weeks later, April
			});

			it('should handle BIWEEKLY as weekly with interval 2', () => {
				const uiState = { frequency: 'BIWEEKLY' };
				const events = manager.generateEvents(uiState, '2024-01-01', 4);

				expect(events).toHaveLength(4);
				expect(events[0]).toEqual(parseISO('2024-01-01'));
				expect(events[1]).toEqual(parseISO('2024-01-15'));
				expect(events[2]).toEqual(parseISO('2024-01-29'));
				expect(events[3]).toEqual(parseISO('2024-02-12'));
			});

			it('should generate BIWEEKLY events spanning multiple months', () => {
				const uiState = { frequency: 'BIWEEKLY' };
				const events = manager.generateEvents(uiState, '2024-01-08', 6);

				expect(events).toHaveLength(6);
				expect(events[0]).toEqual(parseISO('2024-01-08')); // Monday in January
				expect(events[1]).toEqual(parseISO('2024-01-22')); // 2 weeks later, still January
				expect(events[2]).toEqual(parseISO('2024-02-05')); // 2 weeks later, February
				expect(events[3]).toEqual(parseISO('2024-02-19')); // 2 weeks later, still February
				expect(events[4]).toEqual(parseISO('2024-03-04')); // 2 weeks later, March
				expect(events[5]).toEqual(parseISO('2024-03-18')); // 2 weeks later, still March
			});

			it('should generate BIWEEKLY events across leap year February', () => {
				const uiState = { frequency: 'BIWEEKLY' };
				const events = manager.generateEvents(uiState, '2024-02-12', 5);

				expect(events).toHaveLength(5);
				expect(events[0]).toEqual(parseISO('2024-02-12')); // Monday in February (leap year)
				expect(events[1]).toEqual(parseISO('2024-02-26')); // 2 weeks later, last Monday in February
				expect(events[2]).toEqual(parseISO('2024-03-11')); // 2 weeks later, March
				expect(events[3]).toEqual(parseISO('2024-03-25')); // 2 weeks later, still March
				expect(events[4]).toEqual(parseISO('2024-04-08')); // 2 weeks later, April
			});

			it('should generate BIWEEKLY events spanning year boundary', () => {
				const uiState = { frequency: 'BIWEEKLY' };
				const events = manager.generateEvents(uiState, '2024-12-16', 4);

				expect(events).toHaveLength(4);
				expect(events[0]).toEqual(parseISO('2024-12-16')); // Monday in December 2024
				expect(events[1]).toEqual(parseISO('2024-12-30')); // 2 weeks later, last Monday in 2024
				expect(events[2]).toEqual(parseISO('2025-01-13')); // 2 weeks later, January 2025
				expect(events[3]).toEqual(parseISO('2025-01-27')); // 2 weeks later, still January 2025
			});

			it('should return single event for unknown frequency', () => {
				const uiState = { frequency: 'UNKNOWN' };
				const events = manager.generateEvents(uiState, '2024-01-01', 5);

				expect(events).toHaveLength(1);
				expect(events[0]).toEqual(parseISO('2024-01-01'));
			});
		});

		describe('interval handling', () => {
			it('should handle custom intervals for daily', () => {
				const uiState = { frequency: 'DAILY', interval: 3 };
				const events = manager.generateEvents(uiState, '2024-01-01', 4);

				expect(events).toHaveLength(4);
				expect(events[0]).toEqual(parseISO('2024-01-01'));
				expect(events[1]).toEqual(parseISO('2024-01-04'));
				expect(events[2]).toEqual(parseISO('2024-01-07'));
				expect(events[3]).toEqual(parseISO('2024-01-10'));
			});

			it('should handle custom intervals for weekly', () => {
				const uiState = { frequency: 'WEEKLY', interval: 2 };
				const events = manager.generateEvents(uiState, '2024-01-01', 3);

				expect(events).toHaveLength(3);
				expect(events[0]).toEqual(parseISO('2024-01-01'));
				expect(events[1]).toEqual(parseISO('2024-01-15'));
				expect(events[2]).toEqual(parseISO('2024-01-29'));
			});

			it('should handle weekly interval 2 spanning multiple months', () => {
				const uiState = { frequency: 'WEEKLY', interval: 2 };
				const events = manager.generateEvents(uiState, '2024-01-22', 5);

				expect(events).toHaveLength(5);
				expect(events[0]).toEqual(parseISO('2024-01-22')); // Monday in January
				expect(events[1]).toEqual(parseISO('2024-02-05')); // 2 weeks later, February
				expect(events[2]).toEqual(parseISO('2024-02-19')); // 2 weeks later, still February
				expect(events[3]).toEqual(parseISO('2024-03-04')); // 2 weeks later, March
				expect(events[4]).toEqual(parseISO('2024-03-18')); // 2 weeks later, still March
			});

			it('should default to interval 1 when not specified', () => {
				const uiState = { frequency: 'WEEKLY' };
				const events = manager.generateEvents(uiState, '2024-01-01', 3);

				expect(events).toHaveLength(3);
				expect(events[0]).toEqual(parseISO('2024-01-01'));
				expect(events[1]).toEqual(parseISO('2024-01-08'));
				expect(events[2]).toEqual(parseISO('2024-01-15'));
			});
		});

		describe('count handling', () => {
			it('should respect count limit', () => {
				const uiState = { frequency: 'DAILY', count: 3 };
				const events = manager.generateEvents(
					uiState,
					'2024-01-01',
					10
				);

				expect(events).toHaveLength(3);
			});

			it('should use maxInstances when count is greater', () => {
				const uiState = { frequency: 'DAILY', count: 20 };
				const events = manager.generateEvents(uiState, '2024-01-01', 5);

				expect(events).toHaveLength(5);
			});

			it('should use maxInstances when count is not specified', () => {
				const uiState = { frequency: 'DAILY' };
				const events = manager.generateEvents(uiState, '2024-01-01', 7);

				expect(events).toHaveLength(7);
			});

			it('should use default maxInstances of 10', () => {
				const uiState = { frequency: 'DAILY' };
				const events = manager.generateEvents(uiState, '2024-01-01');

				expect(events).toHaveLength(10);
			});
		});

		describe('until date handling', () => {
			it('should stop at until date', () => {
				const uiState = { frequency: 'WEEKLY', until: '2024-01-20' };
				const events = manager.generateEvents(
					uiState,
					'2024-01-01',
					10
				);

				// Should generate events until 2024-01-20
				// 2024-01-01, 2024-01-08, 2024-01-15 (2024-01-22 would exceed until date)
				expect(events).toHaveLength(3);
				expect(events[0]).toEqual(parseISO('2024-01-01'));
				expect(events[1]).toEqual(parseISO('2024-01-08'));
				expect(events[2]).toEqual(parseISO('2024-01-15'));
			});

			it('should ignore invalid until dates', () => {
				const uiState = { frequency: 'DAILY', until: 'invalid-date' };
				const events = manager.generateEvents(uiState, '2024-01-01', 5);

				expect(events).toHaveLength(5); // Should proceed as if no until date
			});

			it('should handle until date with datetime start', () => {
				const uiState = { frequency: 'DAILY', until: '2024-01-03' };
				const events = manager.generateEvents(
					uiState,
					'2024-01-01T10:00:00',
					10
				);

				// Until date 2024-01-03 is interpreted as 2024-01-03T00:00:00
				// So 2024-01-03T10:00:00 would be after the until date
				// Should include 2024-01-01T10:00:00, 2024-01-02T10:00:00 (but not 2024-01-03T10:00:00)
				expect(events).toHaveLength(2);
			});

			it('should work with count and until together (until takes precedence)', () => {
				const uiState = {
					frequency: 'DAILY',
					count: 10,
					until: '2024-01-03',
				};
				const events = manager.generateEvents(
					uiState,
					'2024-01-01',
					15
				);

				expect(events).toHaveLength(3); // Limited by until date, not count
			});
		});

		describe('edge cases', () => {
			it('should handle single event when count is 1', () => {
				const uiState = { frequency: 'WEEKLY', count: 1 };
				const events = manager.generateEvents(uiState, '2024-01-01');

				expect(events).toHaveLength(1);
				expect(events[0]).toEqual(parseISO('2024-01-01'));
			});
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

			// Test generateEvents as well
			const events1 = rruleManager.generateEvents(uiState, '2024-01-01');
			const events2 = newInstance.generateEvents(uiState, '2024-01-01');
			expect(events1).toEqual(events2);
		});
	});
});
