/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import EditComponent from '../EditComponent.js';

jest.mock('@wordpress/api-fetch');

// useBlockProps needs the editor's block context, which jsdom doesn't provide;
// stub it to a plain spread so we can render the component in isolation.
jest.mock('@wordpress/block-editor', () => ({
	useBlockProps: () => ({}),
}));

// ServerSideRender hits the REST API for a live render; stub it to a marker so
// we can assert "the preview rendered" without a server.
jest.mock(
	'@wordpress/server-side-render',
	() => () => <div data-testid="ssr" />,
	{
		virtual: true,
	}
);

const PLACEHOLDER = 'Event Info block is disabled';

// A single, non-recurring event whose primary post is id 16 (a page).
const primaryLinked = {
	id: 11,
	event_id: 16,
	linked_posts: [{ id: 16, is_primary: true }],
};

// An event linked to post 42 only through the junction table (event_id is a
// different fair_event post), so it is NOT the primary event_id.
const junctionLinked = {
	id: 12,
	event_id: 99,
	linked_posts: [
		{ id: 99, is_primary: true },
		{ id: 42, is_primary: false },
	],
};

const renderBlock = (postId, postType) =>
	render(<EditComponent attributes={{}} context={{ postId, postType }} />);

describe('EventInfo EditComponent', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it('shows the preview for a page linked as the primary event_id', async () => {
		apiFetch.mockResolvedValue([primaryLinked, junctionLinked]);

		renderBlock(16, 'page');

		await waitFor(() =>
			expect(screen.getByTestId('ssr')).toBeInTheDocument()
		);
		expect(screen.queryByText(PLACEHOLDER, { exact: false })).toBeNull();
		expect(apiFetch).toHaveBeenCalledWith({
			path: '/fair-events/v1/event-dates?include_linked=true',
		});
	});

	it('shows the preview for a page linked only via the junction table', async () => {
		apiFetch.mockResolvedValue([primaryLinked, junctionLinked]);

		renderBlock(42, 'page');

		await waitFor(() =>
			expect(screen.getByTestId('ssr')).toBeInTheDocument()
		);
	});

	it('shows the placeholder when the post is not linked to any event', async () => {
		apiFetch.mockResolvedValue([primaryLinked, junctionLinked]);

		renderBlock(7, 'page');

		await waitFor(() =>
			expect(
				screen.getByText(PLACEHOLDER, { exact: false })
			).toBeInTheDocument()
		);
		expect(screen.queryByTestId('ssr')).toBeNull();
	});

	it('still renders the preview for a linked fair_event post (no regression)', async () => {
		apiFetch.mockResolvedValue([primaryLinked]);

		renderBlock(16, 'fair_event');

		await waitFor(() =>
			expect(screen.getByTestId('ssr')).toBeInTheDocument()
		);
	});

	it('shows the placeholder when the lookup fails', async () => {
		apiFetch.mockRejectedValue(new Error('network'));

		renderBlock(16, 'page');

		await waitFor(() =>
			expect(
				screen.getByText(PLACEHOLDER, { exact: false })
			).toBeInTheDocument()
		);
	});
});
