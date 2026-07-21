/**
 * @jest-environment jsdom
 *
 * Tests for EventContextHeader (#1049, #1198).
 *
 * Covers:
 *   - Occurrence variants: single (no series badge), master (recurring-series
 *     count badge), generated (occurrence badge + "view series" link +
 *     tickets-on-series note).
 *   - Link-status variants: post, external, none.
 *   - Breadcrumb calendar link carries &month=YYYY-MM from start_datetime.
 *   - Link-state actions: placeholder (single "set up" button), internal
 *     (view + edit + change link), external (open link + change link) — each
 *     firing onManageLink.
 */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import EventContextHeader from '../EventContextHeader.js';

const manageEventUrl = '/wp-admin/admin.php?page=fair-events-manage-event';
const calendarUrl = '/wp-admin/admin.php?page=fair-events-calendar';

const baseEventDate = {
	id: 1,
	title: 'Test Event',
	start_datetime: '2026-07-15 18:00:00',
	end_datetime: '2026-07-15 20:00:00',
	venue_id: null,
	address: null,
	link_type: 'none',
	external_url: null,
	display_url: null,
	occurrence_type: 'single',
	categories: [],
};

it('renders nothing when eventDate is missing', () => {
	const { container } = render(
		<EventContextHeader eventDate={null} manageEventUrl={manageEventUrl} />
	);
	expect(container).toBeEmptyDOMElement();
});

it('single occurrence: no series badge, no generated note', () => {
	render(
		<EventContextHeader
			eventDate={baseEventDate}
			manageEventUrl={manageEventUrl}
			calendarUrl={calendarUrl}
		/>
	);
	expect(screen.queryByText(/Recurring series/i)).not.toBeInTheDocument();
	expect(screen.queryByText(/Occurrence of/i)).not.toBeInTheDocument();
	expect(
		screen.queryByText(/Tickets are managed on the series/i)
	).not.toBeInTheDocument();
});

it('master occurrence: shows recurring-series count badge', () => {
	const eventDate = {
		...baseEventDate,
		occurrence_type: 'master',
		generated_occurrences: [{ id: 2 }, { id: 3 }],
	};
	render(
		<EventContextHeader
			eventDate={eventDate}
			manageEventUrl={manageEventUrl}
			calendarUrl={calendarUrl}
		/>
	);
	expect(screen.getByText(/Recurring series — 3 dates/i)).toBeInTheDocument();
});

it('generated occurrence: shows occurrence badge, view-series link, and tickets note', () => {
	const eventDate = {
		...baseEventDate,
		occurrence_type: 'generated',
		master: {
			id: 9,
			title: 'Master Event',
			start_datetime: '2026-07-01 18:00:00',
		},
	};
	render(
		<EventContextHeader
			eventDate={eventDate}
			manageEventUrl={manageEventUrl}
			calendarUrl={calendarUrl}
		/>
	);
	expect(
		screen.getByText(/Occurrence of Master Event on/i)
	).toBeInTheDocument();
	const viewSeriesLinks = screen.getAllByRole('link', {
		name: /view series|open the master event/i,
	});
	expect(viewSeriesLinks.length).toBeGreaterThan(0);
	viewSeriesLinks.forEach((link) => {
		expect(link).toHaveAttribute(
			'href',
			`${manageEventUrl}&event_date_id=9`
		);
	});
	expect(
		screen.getByText(/Tickets are managed on the series/i)
	).toBeInTheDocument();
});

it('link status: post shows the linked post title', () => {
	const eventDate = {
		...baseEventDate,
		link_type: 'post',
		linked_posts: [{ id: 5, title: 'My Public Page', is_primary: true }],
	};
	render(
		<EventContextHeader
			eventDate={eventDate}
			manageEventUrl={manageEventUrl}
			calendarUrl={calendarUrl}
		/>
	);
	expect(
		screen.getByText(/Public page: My Public Page/i)
	).toBeInTheDocument();
});

it('link status: external shows the external URL', () => {
	const eventDate = {
		...baseEventDate,
		link_type: 'external',
		external_url: 'https://example.com/event',
	};
	render(
		<EventContextHeader
			eventDate={eventDate}
			manageEventUrl={manageEventUrl}
			calendarUrl={calendarUrl}
		/>
	);
	expect(
		screen.getByText(/External page: https:\/\/example\.com\/event/i)
	).toBeInTheDocument();
});

it('link status: none shows the fallback chip', () => {
	render(
		<EventContextHeader
			eventDate={baseEventDate}
			manageEventUrl={manageEventUrl}
			calendarUrl={calendarUrl}
		/>
	);
	expect(screen.getByText(/No public page yet/i)).toBeInTheDocument();
});

it('breadcrumb calendar link carries &month=YYYY-MM from start_datetime', () => {
	render(
		<EventContextHeader
			eventDate={baseEventDate}
			manageEventUrl={manageEventUrl}
			calendarUrl={calendarUrl}
		/>
	);
	const calendarLink = screen.getByRole('link', { name: /Calendar/i });
	expect(calendarLink).toHaveAttribute(
		'href',
		`${calendarUrl}&month=2026-07`
	);
});

it('link actions: placeholder shows a single "set up" button that calls onManageLink', () => {
	const onManageLink = jest.fn();
	render(
		<EventContextHeader
			eventDate={baseEventDate}
			manageEventUrl={manageEventUrl}
			calendarUrl={calendarUrl}
			onManageLink={onManageLink}
		/>
	);
	const button = screen.getByRole('button', {
		name: /Set up event page/i,
	});
	expect(
		screen.queryByRole('link', { name: /View public page/i })
	).not.toBeInTheDocument();
	expect(
		screen.queryByRole('button', { name: /Change link/i })
	).not.toBeInTheDocument();
	button.click();
	expect(onManageLink).toHaveBeenCalledTimes(1);
});

it('link actions: internal link shows view + edit + change link', () => {
	const onManageLink = jest.fn();
	const eventDate = {
		...baseEventDate,
		link_type: 'post',
		display_url: 'https://example.com/event',
		linked_posts: [
			{
				id: 5,
				title: 'My Public Page',
				is_primary: true,
				edit_url: 'https://example.com/wp-admin/post.php?post=5',
			},
		],
	};
	render(
		<EventContextHeader
			eventDate={eventDate}
			manageEventUrl={manageEventUrl}
			calendarUrl={calendarUrl}
			onManageLink={onManageLink}
		/>
	);

	const viewButton = screen.getByRole('link', {
		name: /View public page/i,
	});
	expect(viewButton).toHaveAttribute('href', 'https://example.com/event');

	const editButton = screen.getByRole('link', { name: /Edit page/i });
	expect(editButton).toHaveAttribute(
		'href',
		'https://example.com/wp-admin/post.php?post=5'
	);

	const changeLinkButton = screen.getByRole('button', {
		name: /Change link/i,
	});
	changeLinkButton.click();
	expect(onManageLink).toHaveBeenCalledTimes(1);
});

it('link actions: external link shows open link + change link', () => {
	const onManageLink = jest.fn();
	const eventDate = {
		...baseEventDate,
		link_type: 'external',
		external_url: 'https://example.com/external',
	};
	render(
		<EventContextHeader
			eventDate={eventDate}
			manageEventUrl={manageEventUrl}
			calendarUrl={calendarUrl}
			onManageLink={onManageLink}
		/>
	);

	const openButton = screen.getByRole('link', { name: /Open link/i });
	expect(openButton).toHaveAttribute('href', 'https://example.com/external');

	const changeLinkButton = screen.getByRole('button', {
		name: /Change link/i,
	});
	changeLinkButton.click();
	expect(onManageLink).toHaveBeenCalledTimes(1);
});

it('link actions: no onManageLink prop renders no action buttons for the placeholder state', () => {
	render(
		<EventContextHeader
			eventDate={baseEventDate}
			manageEventUrl={manageEventUrl}
			calendarUrl={calendarUrl}
		/>
	);
	expect(
		screen.queryByRole('button', { name: /Set up event page/i })
	).not.toBeInTheDocument();
});

it('resolves the venue name from the venues prop', () => {
	const eventDate = { ...baseEventDate, venue_id: 7 };
	render(
		<EventContextHeader
			eventDate={eventDate}
			manageEventUrl={manageEventUrl}
			calendarUrl={calendarUrl}
			venues={[{ id: 7, name: 'Community Hall' }]}
		/>
	);
	expect(screen.getByText(/Community Hall/i)).toBeInTheDocument();
});

it('renders category chips', () => {
	const eventDate = {
		...baseEventDate,
		categories: [
			{ id: 1, name: 'Workshops', slug: 'workshops' },
			{ id: 2, name: 'Music', slug: 'music' },
		],
	};
	render(
		<EventContextHeader
			eventDate={eventDate}
			manageEventUrl={manageEventUrl}
			calendarUrl={calendarUrl}
		/>
	);
	expect(screen.getByText('Workshops')).toBeInTheDocument();
	expect(screen.getByText('Music')).toBeInTheDocument();
});
