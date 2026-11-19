/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';

jest.mock( '@wordpress/api-fetch', () => jest.fn() );
// eslint-disable-next-line import/first
import apiFetch from '@wordpress/api-fetch';

const mockEditor = { postType: 'page', postId: 1 };
jest.mock( '@wordpress/data', () => ( {
	useSelect: ( callback ) =>
		callback( () => ( {
			getCurrentPostType: () => mockEditor.postType,
			getCurrentPostId: () => mockEditor.postId,
			getBlocks: () => [],
		} ) ),
	useDispatch: () => ( {} ),
} ) );

jest.mock( '@wordpress/block-editor', () => ( {
	useBlockProps: ( props ) => props,
	useInnerBlocksProps: ( props ) => props,
	InspectorControls: ( { children } ) => children,
	InnerBlocks: Object.assign( () => null, {
		Content: () => null,
		ButtonBlockAppender: () => null,
	} ),
} ) );

jest.mock( '@wordpress/components', () => ( {
	PanelBody: ( { children } ) => children,
	TextControl: () => null,
	TextareaControl: () => null,
	ToggleControl: () => null,
	Spinner: () => <span>loading</span>,
	SelectControl: ( { label, value, options, onChange } ) => (
		<label>
			{ label }
			<select
				value={ value }
				onChange={ ( event ) => onChange( event.target.value ) }
			>
				{ options.map( ( opt ) => (
					<option key={ opt.value } value={ opt.value }>
						{ opt.label }
					</option>
				) ) }
			</select>
		</label>
	),
} ) );

let capturedSettings;
jest.mock( '@wordpress/blocks', () => ( {
	registerBlockType: ( name, settings ) => {
		if ( name.startsWith( 'fair-form/' ) ) {
			capturedSettings = settings;
		}
	},
	createBlock: () => ( {} ),
} ) );

// Labels as /fair-audience/v1/custom-mail/events builds them: the stored,
// HTML-encoded post title plus the formatted date/time.
const EVENT_DATES = [
	{
		id: 31,
		event_id: 7,
		display_label: 'Test&nbsp;event (November 20, 2026 6:00 pm)',
	},
	{
		id: 30,
		event_id: 8,
		display_label:
			'Minifesti &#8220;La&nbsp;Mutable&#8221; (November 19, 2026)',
	},
	{
		id: 29,
		event_id: 9,
		display_label:
			'Rock &amp; Roll &quot;Night&quot; &#x27;26 (May 1, 2026)',
	},
	{
		id: 28,
		event_id: 10,
		display_label: '&lt;b&gt;Bold&lt;/b&gt; &amp;lt;tag (May 2, 2026)',
	},
	{
		id: 27,
		event_id: 11,
		display_label: 'Plain event (May 3, 2026 10:00 am)',
	},
];

describe( 'Fair Form block event selector', () => {
	let Edit;

	beforeAll( () => {
		require( '../editor.js' );
		Edit = capturedSettings.edit;
	} );

	beforeEach( () => {
		apiFetch.mockReset();
		apiFetch.mockResolvedValue( EVENT_DATES );
		mockEditor.postType = 'page';
		mockEditor.postId = 1;
	} );

	const renderEdit = ( attributes = {}, setAttributes = jest.fn() ) =>
		render(
			<Edit
				attributes={ { formId: 'f1', eventDateId: 0, ...attributes } }
				setAttributes={ setAttributes }
				clientId="c1"
			/>
		);

	const optionLabels = async () => {
		const select = await screen.findByRole( 'combobox', {
			name: 'Event',
		} );
		return Array.from( select.options ).map( ( opt ) => opt.textContent );
	};

	it( 'decodes entities once, keeping date suffixes and order', async () => {
		renderEdit();

		expect( apiFetch ).toHaveBeenCalledWith( {
			path: '/fair-audience/v1/custom-mail/events',
		} );
		expect( await optionLabels() ).toEqual( [
			'— None —',
			'Test event (November 20, 2026 6:00 pm)',
			'Minifesti “La Mutable” (November 19, 2026)',
			'Rock & Roll "Night" \'26 (May 1, 2026)',
			'<b>Bold</b> &lt;tag (May 2, 2026)',
			'Plain event (May 3, 2026 10:00 am)',
		] );
	} );

	it( 'renders HTML-like titles as text, not elements', async () => {
		renderEdit();
		const select = await screen.findByRole( 'combobox', {
			name: 'Event',
		} );
		expect( select.querySelector( 'b' ) ).toBeNull();
	} );

	it( 'keeps numeric event-date IDs as option values and on selection', async () => {
		const setAttributes = jest.fn();
		renderEdit( {}, setAttributes );
		const select = await screen.findByRole( 'combobox', {
			name: 'Event',
		} );

		expect( Array.from( select.options ).map( ( o ) => o.value ) ).toEqual(
			[ '', '31', '30', '29', '28', '27' ]
		);

		fireEvent.change( select, { target: { value: '30' } } );
		expect( setAttributes ).toHaveBeenCalledWith( { eventDateId: 30 } );
	} );

	it( 'shows the saved event as selected on reopen', async () => {
		renderEdit( { eventDateId: 30 } );
		const select = await screen.findByRole( 'combobox', {
			name: 'Event',
		} );
		expect( select.value ).toBe( '30' );
		expect( select.selectedOptions[ 0 ].textContent ).toBe(
			'Minifesti “La Mutable” (November 19, 2026)'
		);
	} );

	it( 'still auto-selects the current event on an event page', async () => {
		mockEditor.postType = 'fair_event';
		mockEditor.postId = 8;
		const setAttributes = jest.fn();
		renderEdit( {}, setAttributes );
		await screen.findByRole( 'combobox', { name: 'Event' } );

		expect( setAttributes ).toHaveBeenCalledWith( { eventDateId: 30 } );
	} );
} );
