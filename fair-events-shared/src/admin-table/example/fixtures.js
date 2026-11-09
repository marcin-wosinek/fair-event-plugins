/**
 * Synthetic rows for the admin table example (#2205). Test/dev only: never
 * real names, emails or finance data, because screenshots are public.
 *
 * Amounts are preformatted strings, the way consumers keep their own money
 * formatting; the table only aligns them.
 *
 * @package FairEventsShared
 */

export const EXAMPLE_ROWS = [
	{
		id: 1,
		title: 'Spring Community Dance Workshop with Live Band and Extended Social Evening — Intermediate and Advanced Levels',
		meta: 'spring-community-dance-workshop-2027 · 3 feed inputs',
		date: '14 Mar 2027',
		amount: '€1,250.00',
		status: { tone: 'success', label: 'Paid' },
		primary: 'Edit',
		secondary: [ 'duplicate', 'export', 'delete' ],
	},
	{
		id: 2,
		title: 'Morning yoga',
		meta: 'Refund for 1 ticket',
		date: '2 Apr 2027',
		amount: '−€45.50',
		status: { tone: 'neutral', label: 'Refunded' },
		primary: 'View',
		secondary: [],
	},
	{
		id: 3,
		title: '',
		meta: 'Created by the import on 3 Apr 2027',
		date: '',
		amount: 'US$320.00',
		status: { tone: 'warning', label: 'Pending' },
		primary: 'Send test',
		primaryDisabledReason: 'Add a recipient before sending a test.',
		secondary: [ 'duplicate-disabled', 'delete' ],
	},
	{
		id: 4,
		title: 'Weekly Telegram digest',
		meta: 'Sends to 2 chats',
		date: '7 Apr 2027',
		amount: '',
		status: { tone: 'error', label: 'Failed' },
		warning: 'The last send failed: the bot was removed from one chat.',
		primary: 'Retry',
		secondary: [ 'delete' ],
	},
	{
		id: 5,
		title: 'Board games night',
		meta: 'board-games-night',
		date: '9 Apr 2027',
		amount: 'PLN 80.00',
		status: { tone: 'info', label: 'Scheduled' },
		primary: 'Edit',
		secondary: [ 'duplicate', 'delete' ],
	},
];

export const SCENARIOS = [
	{ value: 'rows', label: 'Rows' },
	{ value: 'loading', label: 'Loading' },
	{ value: 'empty', label: 'Empty (nothing created yet)' },
	{ value: 'no-results', label: 'No results for the filters' },
	{ value: 'pending', label: 'Pending action' },
	{ value: 'error', label: 'Load error (keeps the rows, offers retry)' },
];
