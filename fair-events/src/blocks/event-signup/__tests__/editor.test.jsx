/**
 * @jest-environment jsdom
 *
 * ServerSideRender is mocked below (it hits a live REST render, which jsdom
 * can't do), so these tests can't exercise the #1245 fix directly — that bug
 * (nested questions rendering outside the editor preview when fair-audience
 * was active) was entirely in render.php's now-removed delegation, invisible
 * to a mocked SSR response either way. What IS covered here, unconditionally
 * (the block always ServerSideRenders itself — see the isFairFormActive
 * true/false cases below, and the "always renders the unified block" test):
 * the preview and nested-question portal work the same in both
 * configurations, because there is only one configuration from the editor's
 * side — fair-audience enriches the same render, it never owns a competing
 * one.
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';

// ServerSideRender hits the REST API for a live render; stub it to a marker
// that also emits the questions slot render.php puts in preview markup, so
// the portal logic has somewhere to land. Captures its props so tests can
// assert on the attributes sent to the REST renderer.
const mockServerSideRender = jest.fn( () => (
	<div data-testid="ssr">
		<div className="fair-events-event-signup-questions-slot" />
	</div>
) );
jest.mock(
	'@wordpress/server-side-render',
	() => ( props ) => mockServerSideRender( props ),
	{ virtual: true }
);

const mockUseSelect = jest.fn();
jest.mock( '@wordpress/data', () => {
	const stub = () => stub;
	return new Proxy(
		{ useSelect: ( ...args ) => mockUseSelect( ...args ) },
		{
			get( target, prop ) {
				if ( prop in target ) return target[ prop ];
				return stub;
			},
		}
	);
} );

// useBlockProps/useInnerBlocksProps need the editor's block context, which
// jsdom doesn't provide; stub them to plain markers so we can assert on the
// questions region without a full editor.
const mockUseInnerBlocksProps = jest.fn( () => ( {
	'data-testid': 'inner-blocks',
} ) );
jest.mock( '@wordpress/block-editor', () => ( {
	useBlockProps: () => ( {} ),
	useInnerBlocksProps: ( ...args ) => mockUseInnerBlocksProps( ...args ),
	InspectorControls: ( { children } ) => children,
	InnerBlocks: Object.assign( () => null, {
		Content: () => null,
		ButtonBlockAppender: () => null,
	} ),
} ) );

jest.mock( '@wordpress/components', () => ( {
	PanelBody: ( { children } ) => children,
	TextControl: () => null,
	ToggleControl: ( { label, checked, onChange } ) => (
		<label>
			<input
				type="checkbox"
				checked={ checked }
				onChange={ ( e ) => onChange( e.target.checked ) }
			/>
			{ label }
		</label>
	),
	ExternalLink: ( { href, children } ) => <a href={ href }>{ children }</a>,
} ) );

// Capture the block settings passed to registerBlockType so the edit
// function can be rendered directly, without a live block registry.
let capturedSettings;
jest.mock( '@wordpress/blocks', () => ( {
	registerBlockType: ( name, settings ) => {
		capturedSettings = settings;
	},
} ) );

describe( 'Event Signup EditComponent', () => {
	let Edit;

	beforeAll( () => {
		require( '../editor.js' );
		Edit = capturedSettings.edit;
	} );

	const renderEdit = (
		isFairFormActive,
		attributes = {},
		setAttributes = () => {}
	) => {
		mockUseSelect.mockReturnValue( isFairFormActive );
		return render(
			<Edit
				attributes={ {
					submitButtonText: 'Get Tickets',
					showTicketPrice: true,
					showOptionPrices: true,
					...attributes,
				} }
				setAttributes={ setAttributes }
			/>
		);
	};

	afterEach( () => {
		delete window.fairEventsSignupBlock;
	} );

	it( 'always shows the form content region, fair-form active or not', () => {
		const { unmount } = renderEdit( true );

		expect( screen.getByTestId( 'ssr' ) ).toBeInTheDocument();
		expect( screen.getByTestId( 'inner-blocks' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Form content' ) ).toBeInTheDocument();
		unmount();

		renderEdit( false );

		expect( screen.getByTestId( 'ssr' ) ).toBeInTheDocument();
		expect( screen.getByTestId( 'inner-blocks' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Form content' ) ).toBeInTheDocument();
	} );

	it( 'portals the form content area into the SSR-rendered questions slot', () => {
		renderEdit( false );

		const slot = document.querySelector(
			'.fair-events-event-signup-questions-slot'
		);
		expect( slot ).toContainElement( screen.getByTestId( 'inner-blocks' ) );
		expect( slot ).toContainElement( screen.getByText( 'Form content' ) );
	} );

	it( 'flags the SSR preview as an editor preview so render.php emits a slot', () => {
		renderEdit( false );

		const [ { attributes } ] = mockServerSideRender.mock.calls.at( -1 );
		expect( attributes.isEditorPreview ).toBe( true );
	} );

	it( 'always ServerSideRenders the unified block itself, never a delegated one (#1245)', () => {
		renderEdit( true );
		const [ firstProps ] = mockServerSideRender.mock.calls.at( -1 );
		expect( firstProps.block ).toBe( 'fair-events/event-signup' );

		renderEdit( false );
		const [ secondProps ] = mockServerSideRender.mock.calls.at( -1 );
		expect( secondProps.block ).toBe( 'fair-events/event-signup' );
	} );

	it( 'only offers the fair-form question blocks once fair-form is active', () => {
		const { unmount } = renderEdit( false );
		const [ , inactiveOptions ] =
			mockUseInnerBlocksProps.mock.calls.at( -1 );
		expect( inactiveOptions.allowedBlocks ).toEqual( [
			'core/heading',
			'core/paragraph',
			'core/list',
		] );
		unmount();

		renderEdit( true );
		const [ , activeOptions ] = mockUseInnerBlocksProps.mock.calls.at( -1 );
		expect( activeOptions.allowedBlocks ).toEqual(
			expect.arrayContaining( [
				'core/heading',
				'fair-audience/fair-form-short-text',
				'fair-audience/fair-form-conditional',
			] )
		);
	} );

	describe( 'price toggles', () => {
		it( 'shows both toggles checked by default', () => {
			renderEdit( false );

			expect(
				screen.getByLabelText( 'Show ticket price' )
			).toBeChecked();
			expect(
				screen.getByLabelText( 'Show option prices' )
			).toBeChecked();
		} );

		it( 'toggles the showTicketPrice attribute', () => {
			const setAttributes = jest.fn();
			renderEdit( false, {}, setAttributes );

			fireEvent.click( screen.getByLabelText( 'Show ticket price' ) );

			expect( setAttributes ).toHaveBeenCalledWith( {
				showTicketPrice: false,
			} );
		} );

		it( 'toggles the showOptionPrices attribute', () => {
			const setAttributes = jest.fn();
			renderEdit( false, {}, setAttributes );

			fireEvent.click( screen.getByLabelText( 'Show option prices' ) );

			expect( setAttributes ).toHaveBeenCalledWith( {
				showOptionPrices: false,
			} );
		} );
	} );

	describe( 'ticket-editor link', () => {
		it( 'shows the edit-tickets link when ticketing is enabled, the user can manage events, and an event date resolved', () => {
			window.fairEventsSignupBlock = {
				postEventDateId: 42,
				manageEventUrl:
					'http://example.test/wp-admin/admin.php?page=fair-events-manage-event',
				ticketingEnabled: true,
				canManageEvents: true,
			};
			renderEdit( false );

			const link = screen.getByText( 'Edit tickets' );
			expect( link ).toHaveAttribute(
				'href',
				'http://example.test/wp-admin/admin.php?page=fair-events-manage-event&event_date_id=42&tab=tickets'
			);
		} );

		it( 'shows a hint instead of the link when no event date resolved', () => {
			window.fairEventsSignupBlock = {
				postEventDateId: 0,
				manageEventUrl:
					'http://example.test/wp-admin/admin.php?page=fair-events-manage-event',
				ticketingEnabled: true,
				canManageEvents: true,
			};
			renderEdit( false );

			expect(
				screen.getByText(
					'Connect this block to an event date to edit its tickets.'
				)
			).toBeInTheDocument();
			expect(
				screen.queryByText( 'Edit tickets' )
			).not.toBeInTheDocument();
		} );

		it( 'renders nothing when ticketing is disabled', () => {
			window.fairEventsSignupBlock = {
				postEventDateId: 42,
				manageEventUrl:
					'http://example.test/wp-admin/admin.php?page=fair-events-manage-event',
				ticketingEnabled: false,
				canManageEvents: true,
			};
			renderEdit( false );

			expect(
				screen.queryByText( 'Edit tickets' )
			).not.toBeInTheDocument();
			expect(
				screen.queryByText(
					'Connect this block to an event date to edit its tickets.'
				)
			).not.toBeInTheDocument();
		} );

		it( 'renders nothing when the user cannot manage events', () => {
			window.fairEventsSignupBlock = {
				postEventDateId: 42,
				manageEventUrl:
					'http://example.test/wp-admin/admin.php?page=fair-events-manage-event',
				ticketingEnabled: true,
				canManageEvents: false,
			};
			renderEdit( false );

			expect(
				screen.queryByText( 'Edit tickets' )
			).not.toBeInTheDocument();
			expect(
				screen.queryByText(
					'Connect this block to an event date to edit its tickets.'
				)
			).not.toBeInTheDocument();
		} );
	} );
} );
