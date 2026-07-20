/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';

// ServerSideRender hits the REST API for a live render; stub it to a marker
// so we can render the block in isolation.
jest.mock(
	'@wordpress/server-side-render',
	() => () => <div data-testid="ssr" />,
	{ virtual: true }
);

const mockUseSelect = jest.fn();
jest.mock('@wordpress/data', () => {
	const stub = () => stub;
	return new Proxy(
		{ useSelect: (...args) => mockUseSelect(...args) },
		{
			get(target, prop) {
				if (prop in target) return target[prop];
				return stub;
			},
		}
	);
});

// useBlockProps/useInnerBlocksProps need the editor's block context, which
// jsdom doesn't provide; stub them to plain markers so we can assert on the
// questions region without a full editor.
const mockUseInnerBlocksProps = jest.fn(() => ({
	'data-testid': 'inner-blocks',
}));
jest.mock('@wordpress/block-editor', () => ({
	useBlockProps: () => ({}),
	useInnerBlocksProps: (...args) => mockUseInnerBlocksProps(...args),
	InspectorControls: ({ children }) => children,
	InnerBlocks: Object.assign(() => null, {
		Content: () => null,
		ButtonBlockAppender: () => null,
	}),
}));

jest.mock('@wordpress/components', () => ({
	PanelBody: ({ children }) => children,
	TextControl: () => null,
	ExternalLink: ({ href, children }) => <a href={href}>{children}</a>,
}));

// Capture the block settings passed to registerBlockType so the edit
// function can be rendered directly, without a live block registry.
let capturedSettings;
jest.mock('@wordpress/blocks', () => ({
	registerBlockType: (name, settings) => {
		capturedSettings = settings;
	},
}));

describe('Event Signup EditComponent', () => {
	let Edit;

	beforeAll(() => {
		require('../editor.js');
		Edit = capturedSettings.edit;
	});

	const renderEdit = (isFairFormActive) => {
		mockUseSelect.mockReturnValue(isFairFormActive);
		return render(
			<Edit
				attributes={{ submitButtonText: 'Get Tickets' }}
				setAttributes={() => {}}
			/>
		);
	};

	afterEach(() => {
		delete window.fairEventsSignupBlock;
	});

	it('always shows the form content region, fair-form active or not', () => {
		const { unmount } = renderEdit(true);

		expect(screen.getByTestId('ssr')).toBeInTheDocument();
		expect(screen.getByTestId('inner-blocks')).toBeInTheDocument();
		expect(screen.getByText('Form content')).toBeInTheDocument();
		unmount();

		renderEdit(false);

		expect(screen.getByTestId('ssr')).toBeInTheDocument();
		expect(screen.getByTestId('inner-blocks')).toBeInTheDocument();
		expect(screen.getByText('Form content')).toBeInTheDocument();
	});

	it('only offers the fair-form question blocks once fair-form is active', () => {
		const { unmount } = renderEdit(false);
		const [, inactiveOptions] = mockUseInnerBlocksProps.mock.calls.at(-1);
		expect(inactiveOptions.allowedBlocks).toEqual([
			'core/heading',
			'core/paragraph',
			'core/list',
		]);
		unmount();

		renderEdit(true);
		const [, activeOptions] = mockUseInnerBlocksProps.mock.calls.at(-1);
		expect(activeOptions.allowedBlocks).toEqual(
			expect.arrayContaining([
				'core/heading',
				'fair-audience/fair-form-short-text',
				'fair-audience/fair-form-conditional',
			])
		);
	});

	describe('ticket-editor link', () => {
		it('shows the edit-tickets link when ticketing is enabled, the user can manage events, and an event date resolved', () => {
			window.fairEventsSignupBlock = {
				postEventDateId: 42,
				manageEventUrl:
					'http://example.test/wp-admin/admin.php?page=fair-events-manage-event',
				ticketingEnabled: true,
				canManageEvents: true,
			};
			renderEdit(false);

			const link = screen.getByText('Edit tickets');
			expect(link).toHaveAttribute(
				'href',
				'http://example.test/wp-admin/admin.php?page=fair-events-manage-event&event_date_id=42&tab=tickets'
			);
		});

		it('shows a hint instead of the link when no event date resolved', () => {
			window.fairEventsSignupBlock = {
				postEventDateId: 0,
				manageEventUrl:
					'http://example.test/wp-admin/admin.php?page=fair-events-manage-event',
				ticketingEnabled: true,
				canManageEvents: true,
			};
			renderEdit(false);

			expect(
				screen.getByText(
					'Connect this block to an event date to edit its tickets.'
				)
			).toBeInTheDocument();
			expect(screen.queryByText('Edit tickets')).not.toBeInTheDocument();
		});

		it('renders nothing when ticketing is disabled', () => {
			window.fairEventsSignupBlock = {
				postEventDateId: 42,
				manageEventUrl:
					'http://example.test/wp-admin/admin.php?page=fair-events-manage-event',
				ticketingEnabled: false,
				canManageEvents: true,
			};
			renderEdit(false);

			expect(screen.queryByText('Edit tickets')).not.toBeInTheDocument();
			expect(
				screen.queryByText(
					'Connect this block to an event date to edit its tickets.'
				)
			).not.toBeInTheDocument();
		});

		it('renders nothing when the user cannot manage events', () => {
			window.fairEventsSignupBlock = {
				postEventDateId: 42,
				manageEventUrl:
					'http://example.test/wp-admin/admin.php?page=fair-events-manage-event',
				ticketingEnabled: true,
				canManageEvents: false,
			};
			renderEdit(false);

			expect(screen.queryByText('Edit tickets')).not.toBeInTheDocument();
			expect(
				screen.queryByText(
					'Connect this block to an event date to edit its tickets.'
				)
			).not.toBeInTheDocument();
		});
	});
});
