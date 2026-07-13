import { parseRRule, buildRRule, expandRRulePreview } from '../recurrence.js';

describe('buildRRule', () => {
	test('returns null when disabled', () => {
		expect(
			buildRRule({
				enabled: false,
				frequency: 'weekly',
				endType: 'count',
				count: 10,
				until: '',
			})
		).toBeNull();
	});

	test('builds a weekly rule with a count', () => {
		expect(
			buildRRule({
				enabled: true,
				frequency: 'weekly',
				endType: 'count',
				count: 5,
				until: '',
			})
		).toBe('FREQ=WEEKLY;COUNT=5');
	});

	test('adds INTERVAL=2 for biweekly', () => {
		expect(
			buildRRule({
				enabled: true,
				frequency: 'biweekly',
				endType: 'count',
				count: 5,
				until: '',
			})
		).toBe('FREQ=WEEKLY;INTERVAL=2;COUNT=5');
	});

	test('builds a rule ending on a specific date', () => {
		expect(
			buildRRule({
				enabled: true,
				frequency: 'monthly',
				endType: 'until',
				count: 10,
				until: '2026-12-31',
			})
		).toBe('FREQ=MONTHLY;UNTIL=20261231');
	});

	test('builds a daily rule', () => {
		expect(
			buildRRule({
				enabled: true,
				frequency: 'daily',
				endType: 'count',
				count: 3,
				until: '',
			})
		).toBe('FREQ=DAILY;COUNT=3');
	});
});

describe('parseRRule', () => {
	test('round-trips a weekly count rule', () => {
		const rrule = 'FREQ=WEEKLY;COUNT=5';
		expect(parseRRule(rrule)).toEqual({
			frequency: 'weekly',
			endType: 'count',
			count: 5,
			until: '',
		});
	});

	test('round-trips a biweekly rule', () => {
		expect(parseRRule('FREQ=WEEKLY;INTERVAL=2;COUNT=8')).toEqual({
			frequency: 'biweekly',
			endType: 'count',
			count: 8,
			until: '',
		});
	});

	test('round-trips a rule with UNTIL', () => {
		expect(parseRRule('FREQ=MONTHLY;UNTIL=20261231')).toEqual({
			frequency: 'monthly',
			endType: 'until',
			count: 10,
			until: '2026-12-31',
		});
	});

	test('defaults to count/10 when neither COUNT nor UNTIL is present', () => {
		expect(parseRRule('FREQ=DAILY')).toEqual({
			frequency: 'daily',
			endType: 'count',
			count: 10,
			until: '',
		});
	});

	test('round trip: buildRRule(parseRRule(rrule)) === rrule', () => {
		const rrule = 'FREQ=WEEKLY;INTERVAL=2;UNTIL=20270115';
		const parsed = parseRRule(rrule);
		expect(buildRRule({ enabled: true, ...parsed })).toBe(rrule);
	});
});

describe('expandRRulePreview', () => {
	test('expands a daily count rule', () => {
		const result = expandRRulePreview(
			'FREQ=DAILY;COUNT=3',
			'2026-09-01 10:00:00',
			4
		);
		expect(result).toEqual({
			dates: ['2026-09-01', '2026-09-02', '2026-09-03'],
			totalCount: 3,
			remainingCount: 0,
			lastDate: '2026-09-03',
		});
	});

	test('expands a weekly count rule and truncates to the limit', () => {
		const result = expandRRulePreview(
			'FREQ=WEEKLY;COUNT=6',
			'2026-09-01 10:00:00',
			4
		);
		expect(result.dates).toEqual([
			'2026-09-01',
			'2026-09-08',
			'2026-09-15',
			'2026-09-22',
		]);
		expect(result.totalCount).toBe(6);
		expect(result.remainingCount).toBe(2);
		expect(result.lastDate).toBe('2026-10-06');
	});

	test('expands a biweekly (INTERVAL=2) rule', () => {
		const result = expandRRulePreview(
			'FREQ=WEEKLY;INTERVAL=2;COUNT=3',
			'2026-09-01 10:00:00',
			4
		);
		expect(result.dates).toEqual([
			'2026-09-01',
			'2026-09-15',
			'2026-09-29',
		]);
	});

	test('expands a monthly rule', () => {
		const result = expandRRulePreview(
			'FREQ=MONTHLY;COUNT=3',
			'2026-01-31 10:00:00',
			4
		);
		expect(result.dates).toEqual([
			'2026-01-31',
			'2026-03-03',
			'2026-04-03',
		]);
	});

	test('expands a rule ending on UNTIL', () => {
		const result = expandRRulePreview(
			'FREQ=WEEKLY;UNTIL=20260922',
			'2026-09-01 10:00:00',
			4
		);
		expect(result.dates).toEqual([
			'2026-09-01',
			'2026-09-08',
			'2026-09-15',
			'2026-09-22',
		]);
		expect(result.totalCount).toBe(4);
		expect(result.remainingCount).toBe(0);
		expect(result.lastDate).toBe('2026-09-22');
	});

	test('returns an empty preview for a falsy rrule', () => {
		expect(expandRRulePreview(null, '2026-09-01 10:00:00')).toEqual({
			dates: [],
			totalCount: 0,
			remainingCount: 0,
			lastDate: null,
		});
	});
});
