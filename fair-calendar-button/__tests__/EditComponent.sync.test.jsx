/**
 * "Keep in sync with event data" in the Calendar Button editor (#1961).
 *
 * Each test builds its own data registry, so Fair Events' event-data store
 * can be present, empty, or absent (Fair Events inactive).
 */

import '@testing-library/jest-dom';
import { act, render, screen, waitFor } from '@testing-library/react';
import {
	createReduxStore,
	createRegistry,
	RegistryProvider,
} from '@wordpress/data';
import { useState } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';
import EditComponent from '../src/blocks/calendar-button/components/EditComponent.js';

jest.mock( '@wordpress/api-fetch', () => jest.fn() );

jest.mock( '@wordpress/block-editor', () => ( {
	useBlockProps: () => ( {} ),
	useInnerBlocksProps: ( props ) => props,
	InspectorControls: ( { children } ) => <>{ children }</>,
} ) );

const POST_ID = 10;

// Notice text also goes to the a11y live region; query the visible one.
const NOTICE = { selector: '.components-notice__content' };

const DEFAULT_ATTRIBUTES = {
	start: '',
	end: '',
	allDay: false,
	description: '',
	location: '',
	recurring: false,
	recurrence: { frequency: 'WEEKLY', count: null, until: '' },
	rRule: '',
	syncWithEvent: false,
};

const TIMED_EVENT = {
	id: 5,
	occurrence_type: 'single',
	start_date: '2030-06-14',
	end_date: '2030-06-14',
	start_time: '19:00:00',
	end_time: '21:00:00',
	all_day: false,
	venue_id: null,
	address: 'Plaza Mayor 1',
};

/**
 * Data registry with a fake editor and, optionally, Fair Events' store.
 *
 * @param {Object}  options
 * @param {boolean} options.withEventStore Register `fair-events/event-data`.
 * @param {Object}  options.eventData      Initial store data.
 * @param {string}  options.postType       Edited post type.
 * @return {Object} Registry.
 */
function makeRegistry( {
	withEventStore = true,
	eventData = null,
	postType = 'fair_event',
} = {} ) {
	const registry = createRegistry();

	registry.register(
		createReduxStore( 'core/editor', {
			reducer: ( state = { postId: POST_ID, postType } ) => state,
			selectors: {
				getCurrentPostId: ( state ) => state.postId,
				getCurrentPostType: ( state ) => state.postType,
			},
		} )
	);

	if ( withEventStore ) {
		registry.register(
			createReduxStore( 'fair-events/event-data', {
				reducer: ( state = { eventData }, action ) =>
					action.type === 'SET_EVENT_DATA'
						? { eventData: action.eventData }
						: state,
				actions: {
					setEventData: ( data ) => ( {
						type: 'SET_EVENT_DATA',
						eventData: data,
					} ),
				},
				selectors: {
					getEventData: ( state ) => state.eventData,
				},
			} )
		);
	}

	return registry;
}

/**
 * Render the editor with attribute state kept like the block editor does.
 *
 * @param {Object} options
 * @param {Object} options.registry   Data registry.
 * @param {Object} options.attributes Initial attributes.
 * @param {string} options.postType   Post type in the block context.
 * @return {{attributes: Function}} Reads the current attributes.
 */
function renderEditor( {
	registry,
	attributes = {},
	postType = 'fair_event',
} ) {
	let current;

	function Harness() {
		const [ attrs, setAttrs ] = useState( {
			...DEFAULT_ATTRIBUTES,
			...attributes,
		} );
		current = attrs;
		return (
			<EditComponent
				attributes={ attrs }
				setAttributes={ ( patch ) =>
					setAttrs( ( prev ) => ( { ...prev, ...patch } ) )
				}
				context={ { postId: POST_ID, postType } }
			/>
		);
	}

	render(
		<RegistryProvider value={ registry }>
			<Harness />
		</RegistryProvider>
	);

	return { attributes: () => current };
}

const syncToggle = () =>
	screen.getByRole( 'checkbox', { name: 'Keep in sync with event data' } );
const startField = () => screen.getByLabelText( /^Start Date/ );
const locationField = () => screen.getByLabelText( 'Location' );

/**
 * A promise resolved by the test.
 *
 * @return {{promise: Promise, resolve: Function}} Deferred.
 */
function deferred() {
	let resolve;
	const promise = new Promise( ( done ) => {
		resolve = done;
	} );
	return { promise, resolve };
}

describe( 'Calendar Button event synchronization', () => {
	beforeEach( () => {
		apiFetch.mockReset();
	} );

	it( 'populates a new button on an event post from the event data', async () => {
		apiFetch.mockImplementation( ( { path } ) => {
			expect( path ).toBe( '/fair-events/v1/venues/7' );
			return Promise.resolve( {
				id: 7,
				name: 'Town Hall',
				address: 'Main St 2',
			} );
		} );
		const registry = makeRegistry( {
			eventData: { ...TIMED_EVENT, venue_id: 7 },
		} );

		const editor = renderEditor( { registry } );

		await waitFor( () =>
			expect( editor.attributes() ).toMatchObject( {
				syncWithEvent: true,
				start: '2030-06-14T19:00',
				end: '2030-06-14T21:00',
				allDay: false,
				location: 'Town Hall, Main St 2',
			} )
		);
		expect( syncToggle() ).toBeChecked();
		expect( startField() ).toBeDisabled();
		expect( locationField() ).toBeDisabled();
		expect( screen.queryByRole( 'status' ) ).not.toBeInTheDocument();
	} );

	it( 'follows edits to the event, including all-day changes', async () => {
		const registry = makeRegistry( { eventData: TIMED_EVENT } );
		const editor = renderEditor( { registry } );

		await waitFor( () =>
			expect( editor.attributes().start ).toBe( '2030-06-14T19:00' )
		);

		act( () => {
			registry.dispatch( 'fair-events/event-data' ).setEventData( {
				...TIMED_EVENT,
				end_date: '2030-06-16',
				start_time: null,
				end_time: null,
				all_day: true,
				address: '',
			} );
		} );

		await waitFor( () =>
			expect( editor.attributes() ).toMatchObject( {
				start: '2030-06-14',
				end: '2030-06-16',
				allDay: true,
				location: '',
			} )
		);
	} );

	it( 'keeps the last values and explains when a time is cleared', async () => {
		const registry = makeRegistry( { eventData: TIMED_EVENT } );
		const editor = renderEditor( { registry } );

		await waitFor( () =>
			expect( editor.attributes().end ).toBe( '2030-06-14T21:00' )
		);

		act( () => {
			registry
				.dispatch( 'fair-events/event-data' )
				.setEventData( { ...TIMED_EVENT, end_time: null } );
		} );

		expect(
			await screen.findByText( /both a start and an end time/, NOTICE )
		).toBeInTheDocument();
		// No end time is invented: the saved values stay as they were.
		expect( editor.attributes() ).toMatchObject( {
			start: '2030-06-14T19:00',
			end: '2030-06-14T21:00',
		} );
		expect( syncToggle() ).toBeEnabled();
	} );

	it( 'refreshes a saved button from the REST API until the store loads', async () => {
		apiFetch.mockResolvedValue( [
			{ ...TIMED_EVENT, start_time: '18:00:00' },
		] );
		const registry = makeRegistry();
		const editor = renderEditor( {
			registry,
			attributes: {
				syncWithEvent: true,
				start: '2030-01-01T10:00',
				end: '2030-01-01T11:00',
				location: 'Old place',
			},
		} );

		await waitFor( () =>
			expect( editor.attributes() ).toMatchObject( {
				start: '2030-06-14T18:00',
				end: '2030-06-14T21:00',
				location: 'Plaza Mayor 1',
			} )
		);
		expect( apiFetch ).toHaveBeenCalledWith( {
			path: `/fair-events/v1/event-dates?event_id=${ POST_ID }`,
		} );
	} );

	it( 'reports an event without dates', async () => {
		apiFetch.mockResolvedValue( [] );
		renderEditor( {
			registry: makeRegistry(),
			attributes: { syncWithEvent: true },
		} );

		expect(
			await screen.findByText( /This event has no dates yet/, NOTICE )
		).toBeInTheDocument();
	} );

	it( 'shows loading, then a recoverable error', async () => {
		const request = deferred();
		apiFetch.mockReturnValue(
			request.promise.then( () => {
				throw new Error( 'Server unavailable.' );
			} )
		);
		const editor = renderEditor( {
			registry: makeRegistry(),
			attributes: {
				syncWithEvent: true,
				start: '2030-01-01T10:00',
				end: '2030-01-01T11:00',
			},
		} );

		expect( screen.getByText( 'Loading event details…' ) ).toBeVisible();

		await act( async () => {
			request.resolve();
			await request.promise.catch( () => {} );
		} );

		expect(
			await screen.findByText( /Server unavailable\./, NOTICE )
		).toBeInTheDocument();
		expect( startField() ).toBeDisabled();

		// Turning sync off is the way out: fields unlock with their values.
		act( () => syncToggle().click() );

		expect( startField() ).toBeEnabled();
		expect( editor.attributes() ).toMatchObject( {
			syncWithEvent: false,
			start: '2030-01-01T10:00',
		} );
		expect(
			screen.queryByText( /Server unavailable\./, NOTICE )
		).not.toBeInTheDocument();
	} );

	it( 'explains that Fair Events is inactive without requesting data', () => {
		renderEditor( {
			registry: makeRegistry( { withEventStore: false } ),
			attributes: { syncWithEvent: true },
		} );

		expect(
			screen.getByText( /Fair Events is not active/, NOTICE )
		).toBeInTheDocument();
		expect( apiFetch ).not.toHaveBeenCalled();
		expect( syncToggle() ).toBeEnabled();
	} );

	it( 'ignores a response that arrives after sync is turned off', async () => {
		const request = deferred();
		apiFetch.mockReturnValue( request.promise );
		const editor = renderEditor( {
			registry: makeRegistry(),
			attributes: {
				syncWithEvent: true,
				start: '2030-01-01T10:00',
				end: '2030-01-01T11:00',
			},
		} );

		act( () => syncToggle().click() );

		await act( async () => {
			request.resolve( [ TIMED_EVENT ] );
			await request.promise;
		} );

		expect( editor.attributes() ).toMatchObject( {
			syncWithEvent: false,
			start: '2030-01-01T10:00',
			end: '2030-01-01T11:00',
		} );
	} );

	it( 'leaves a manually configured button on an event post manual', () => {
		const registry = makeRegistry( { eventData: TIMED_EVENT } );
		const editor = renderEditor( {
			registry,
			attributes: {
				start: '2030-01-01T10:00',
				end: '2030-01-01T11:00',
			},
		} );

		expect( syncToggle() ).not.toBeChecked();
		expect( startField() ).toBeEnabled();
		expect( editor.attributes() ).toMatchObject( {
			syncWithEvent: false,
			start: '2030-01-01T10:00',
		} );
		expect( apiFetch ).not.toHaveBeenCalled();
	} );

	it( 'works as a standalone button outside event posts', () => {
		const editor = renderEditor( {
			registry: makeRegistry( {
				withEventStore: false,
				postType: 'page',
			} ),
			postType: 'page',
		} );

		expect(
			screen.queryByRole( 'checkbox', {
				name: 'Keep in sync with event data',
			} )
		).not.toBeInTheDocument();
		expect( startField() ).toBeEnabled();
		expect( editor.attributes().syncWithEvent ).toBe( false );
		expect(
			screen.queryByText( /Fair Events is not active/, NOTICE )
		).not.toBeInTheDocument();
	} );
} );
