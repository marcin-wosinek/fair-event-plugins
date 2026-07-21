/**
 * @jest-environment jsdom
 *
 * Tests for EventLinkModal (#1198).
 *
 * Covers:
 *   - External flow: choosing "external", entering a URL and confirming
 *     PUTs link_type/external_url and calls onSaved.
 *   - None flow: choosing "nowhere" and confirming PUTs link_type: 'none'.
 *   - Linked-posts list: view/edit links render, and Unlink DELETEs and
 *     calls onSaved.
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import EventLinkModal from '../EventLinkModal.js';

jest.mock('@wordpress/api-fetch');

beforeEach(() => {
	jest.spyOn(console, 'warn').mockImplementation(() => {});
	jest.spyOn(console, 'error').mockImplementation(() => {});

	window.matchMedia =
		window.matchMedia ||
		function () {
			return {
				matches: false,
				addListener: () => {},
				removeListener: () => {},
			};
		};
});

afterEach(() => {
	jest.restoreAllMocks();
	jest.clearAllMocks();
});

const eventDateId = 1;
const enabledPostTypes = [{ slug: 'fair_event', label: 'Event' }];

const baseEventDate = {
	link_type: 'none',
	external_url: null,
	linked_posts: [],
};

it('setting an external URL and confirming PUTs link_type/external_url and calls onSaved', async () => {
	const updated = {
		...baseEventDate,
		link_type: 'external',
		external_url: 'https://example.com',
	};
	apiFetch.mockResolvedValueOnce(updated);
	const onSaved = jest.fn();

	render(
		<EventLinkModal
			eventDateId={eventDateId}
			eventDate={baseEventDate}
			enabledPostTypes={enabledPostTypes}
			onClose={jest.fn()}
			onSaved={onSaved}
		/>
	);

	fireEvent.click(screen.getByLabelText('An external website'));
	fireEvent.change(screen.getByLabelText('External URL'), {
		target: { value: 'https://example.com' },
	});
	fireEvent.click(screen.getByRole('button', { name: /Set external link/i }));

	await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
	expect(apiFetch).toHaveBeenCalledWith({
		path: `/fair-events/v1/event-dates/${eventDateId}`,
		method: 'PUT',
		data: {
			link_type: 'external',
			external_url: 'https://example.com',
		},
	});
	expect(onSaved).toHaveBeenCalledWith(updated);
});

it('choosing "nowhere" and confirming PUTs link_type: none', async () => {
	const updated = { ...baseEventDate, link_type: 'none' };
	apiFetch.mockResolvedValueOnce(updated);
	const onSaved = jest.fn();

	render(
		<EventLinkModal
			eventDateId={eventDateId}
			eventDate={baseEventDate}
			enabledPostTypes={enabledPostTypes}
			onClose={jest.fn()}
			onSaved={onSaved}
		/>
	);

	fireEvent.click(screen.getByLabelText('Nowhere — show details only'));
	fireEvent.click(screen.getByRole('button', { name: /Confirm/i }));

	await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
	expect(apiFetch).toHaveBeenCalledWith({
		path: `/fair-events/v1/event-dates/${eventDateId}`,
		method: 'PUT',
		data: {
			link_type: 'none',
			external_url: null,
		},
	});
	expect(onSaved).toHaveBeenCalledWith(updated);
});

it('linked-posts list shows view/edit links and unlink DELETEs and calls onSaved', async () => {
	const eventDate = {
		...baseEventDate,
		link_type: 'post',
		linked_posts: [
			{
				id: 5,
				title: 'My Public Page',
				status: 'publish',
				is_primary: true,
				view_url: 'https://example.com/event',
				edit_url: 'https://example.com/wp-admin/post.php?post=5',
			},
		],
	};
	const updated = { ...baseEventDate, link_type: 'none', linked_posts: [] };
	apiFetch.mockResolvedValueOnce(updated);
	const onSaved = jest.fn();

	render(
		<EventLinkModal
			eventDateId={eventDateId}
			eventDate={eventDate}
			enabledPostTypes={enabledPostTypes}
			onClose={jest.fn()}
			onSaved={onSaved}
		/>
	);

	const viewLink = screen.getByRole('link', { name: /View Entry/i });
	expect(viewLink).toHaveAttribute('href', 'https://example.com/event');
	const editLink = screen.getByRole('link', { name: /Edit Post/i });
	expect(editLink).toHaveAttribute(
		'href',
		'https://example.com/wp-admin/post.php?post=5'
	);

	fireEvent.click(screen.getByRole('button', { name: /Unlink/i }));

	await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
	expect(apiFetch).toHaveBeenCalledWith({
		path: `/fair-events/v1/event-dates/${eventDateId}/link-post`,
		method: 'DELETE',
		data: { post_id: 5 },
	});
	expect(onSaved).toHaveBeenCalledWith(updated);
});
