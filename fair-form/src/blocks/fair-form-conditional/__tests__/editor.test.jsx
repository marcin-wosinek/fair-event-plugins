/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';

const mockUseSelect = jest.fn();
jest.mock( '@wordpress/data', () => ( {
	useSelect: ( ...args ) => mockUseSelect( ...args ),
} ) );

jest.mock( '@wordpress/api-fetch', () => jest.fn() );
// eslint-disable-next-line import/first
import apiFetch from '@wordpress/api-fetch';

jest.mock( '@wordpress/block-editor', () => ( {
	useBlockProps: ( props ) => props || {},
	useInnerBlocksProps: ( props ) => props || {},
	InspectorControls: ( { children } ) => children,
	InnerBlocks: Object.assign( () => null, {
		Content: () => null,
		ButtonBlockAppender: () => null,
	} ),
} ) );

jest.mock( '@wordpress/components', () => ( {
	PanelBody: ( { children } ) => children,
	SelectControl: ( { label, value, options, onChange } ) => (
		<label>
			{ label }
			<select
				value={ value }
				onChange={ ( e ) => onChange( e.target.value ) }
			>
				{ options.map( ( opt ) => (
					<option key={ opt.value } value={ opt.value }>
						{ opt.label }
					</option>
				) ) }
			</select>
		</label>
	),
	TextControl: ( { label, value, onChange } ) => (
		<label>
			{ label }
			<input
				value={ value }
				onChange={ ( e ) => onChange( e.target.value ) }
			/>
		</label>
	),
	CheckboxControl: ( { label, checked, onChange } ) => (
		<label>
			<input
				type="checkbox"
				checked={ checked }
				onChange={ ( e ) => onChange( e.target.checked ) }
			/>
			{ label }
		</label>
	),
	Notice: ( { children } ) => <div role="alert">{ children }</div>,
} ) );

let capturedSettings;
jest.mock( '@wordpress/blocks', () => ( {
	registerBlockType: ( name, settings ) => {
		capturedSettings = settings;
	},
} ) );

/**
 * Wire up mockUseSelect so the real formParentId-resolution logic in
 * editor.js runs against a small fake block tree: a Conditional Section
 * (clientId) nested one level inside a form-like block.
 *
 * @param {Object|null} formBlock Fake parent block ({ name, attributes }), or
 *                                null for a standalone Conditional Section.
 */
function mockFormParent( formBlock ) {
	mockUseSelect.mockImplementation( ( callback ) =>
		callback( ( store ) => {
			if ( store !== 'core/block-editor' ) {
				return {};
			}
			return {
				getBlockParents: () => ( formBlock ? [ 'form-1' ] : [] ),
				getBlock: ( id ) => ( id === 'form-1' ? formBlock : undefined ),
				getBlocks: () => [],
			};
		} )
	);
}

describe( 'Fair Form Conditional Edit', () => {
	let Edit;

	beforeAll( () => {
		require( '../editor.js' );
		Edit = capturedSettings.edit;
	} );

	beforeEach( () => {
		apiFetch.mockReset();
	} );

	afterEach( () => {
		delete window.fairEventsSignupBlock;
	} );

	const baseAttributes = {
		conditionSource: 'question',
		conditionQuestionKey: '',
		conditionOperator: 'equals',
		conditionValue: '',
		conditionOptionShortName: '',
		conditionTicketTypeIds: [],
	};

	const renderEdit = ( attributes = {}, setAttributes = () => {} ) =>
		render(
			<Edit
				attributes={ { ...baseAttributes, ...attributes } }
				setAttributes={ setAttributes }
				clientId="conditional-1"
			/>
		);

	it( 'offers "Ticket type" as a condition source when nested in an Event Signup connected via the block attribute', async () => {
		mockFormParent( {
			name: 'fair-events/event-signup',
			attributes: { eventDateId: 42 },
		} );
		apiFetch.mockResolvedValue( { ticket_types: [] } );
		renderEdit();

		const select = screen.getByLabelText( 'Condition source' );
		expect(
			Array.from( select.querySelectorAll( 'option' ) ).map(
				( o ) => o.value
			)
		).toEqual( [ 'question', 'eventOption', 'ticketType' ] );

		await waitFor( () => expect( apiFetch ).toHaveBeenCalled() );
	} );

	it( 'offers "Ticket type" resolving the event date from the post context global (the common case, since the block attribute itself is normally 0)', async () => {
		window.fairEventsSignupBlock = { postEventDateId: 42 };
		mockFormParent( {
			name: 'fair-events/event-signup',
			attributes: { eventDateId: 0 },
		} );
		apiFetch.mockResolvedValue( { ticket_types: [] } );
		renderEdit();

		const select = screen.getByLabelText( 'Condition source' );
		expect(
			Array.from( select.querySelectorAll( 'option' ) ).map(
				( o ) => o.value
			)
		).toEqual( [ 'question', 'eventOption', 'ticketType' ] );

		await waitFor( () =>
			expect( apiFetch ).toHaveBeenCalledWith( {
				path: '/fair-events/v1/event-dates/42/tickets',
			} )
		);
	} );

	it( 'does not offer "Ticket type" when standalone (not inside a signup form)', () => {
		mockFormParent( null );
		renderEdit();

		expect(
			screen.queryByLabelText( 'Condition source' )
		).not.toBeInTheDocument();
	} );

	it( 'does not offer "Ticket type" when inside an unconnected Event Signup (no attribute, no resolved post event date)', () => {
		mockFormParent( {
			name: 'fair-events/event-signup',
			attributes: { eventDateId: 0 },
		} );
		renderEdit();

		const select = screen.getByLabelText( 'Condition source' );
		expect(
			Array.from( select.querySelectorAll( 'option' ) ).map(
				( o ) => o.value
			)
		).toEqual( [ 'question', 'eventOption' ] );
	} );

	it( 'does not offer "Ticket type" when inside the legacy Event Signup', () => {
		mockFormParent( {
			name: 'fair-audience/event-signup',
			attributes: {},
		} );
		renderEdit();

		const select = screen.getByLabelText( 'Condition source' );
		expect(
			Array.from( select.querySelectorAll( 'option' ) ).map(
				( o ) => o.value
			)
		).toEqual( [ 'question', 'eventOption' ] );
	} );

	it( 'renders fetched ticket types as checkboxes and toggles conditionTicketTypeIds', async () => {
		mockFormParent( {
			name: 'fair-events/event-signup',
			attributes: { eventDateId: 42 },
		} );
		apiFetch.mockResolvedValue( {
			ticket_types: [
				{ id: 1, name: 'Adult' },
				{ id: 2, name: 'Child' },
			],
		} );
		const setAttributes = jest.fn();
		renderEdit( { conditionSource: 'ticketType' }, setAttributes );

		await waitFor( () =>
			expect( apiFetch ).toHaveBeenCalledWith( {
				path: '/fair-events/v1/event-dates/42/tickets',
			} )
		);

		const adultCheckbox = await screen.findByLabelText( 'Adult' );
		expect( adultCheckbox ).not.toBeChecked();

		adultCheckbox.click();
		expect( setAttributes ).toHaveBeenCalledWith( {
			conditionTicketTypeIds: [ 1 ],
		} );
	} );

	it( 'shows a warning when a referenced ticket type no longer exists', async () => {
		mockFormParent( {
			name: 'fair-events/event-signup',
			attributes: { eventDateId: 42 },
		} );
		apiFetch.mockResolvedValue( {
			ticket_types: [ { id: 1, name: 'Adult' } ],
		} );
		renderEdit( {
			conditionSource: 'ticketType',
			conditionTicketTypeIds: [ 1, 999 ],
		} );

		expect( await screen.findByRole( 'alert' ) ).toHaveTextContent(
			/no longer exist/
		);
	} );

	it( 'shows no warning while the referenced ticket types all still exist', async () => {
		mockFormParent( {
			name: 'fair-events/event-signup',
			attributes: { eventDateId: 42 },
		} );
		apiFetch.mockResolvedValue( {
			ticket_types: [ { id: 1, name: 'Adult' } ],
		} );
		renderEdit( {
			conditionSource: 'ticketType',
			conditionTicketTypeIds: [ 1 ],
		} );

		await screen.findByLabelText( 'Adult' );
		expect( screen.queryByRole( 'alert' ) ).not.toBeInTheDocument();
	} );
} );
