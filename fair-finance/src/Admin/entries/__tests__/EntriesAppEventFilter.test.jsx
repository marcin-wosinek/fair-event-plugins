/**
 * Component test for the Link (event) filter on the entries screen (#2134).
 * Local event dates and URL-only links share one dropdown, exact URL
 * duplicates merge into the local option, and the list, totals and CSV
 * export all send the same single selection.
 *
 * Fair Events integration is read at module load, so the module is required
 * after enabling it.
 */
import '@testing-library/jest-dom';
import {
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';

jest.mock( '@wordpress/api-fetch' );
jest.mock( '../exportEntriesCsv.js', () => ( {
	...jest.requireActual( '../exportEntriesCsv.js' ),
	downloadCsv: jest.fn(),
} ) );

const BASE_PATH = '/wp-admin/admin.php?page=fair-finance-entries';
const LOCAL_URL = 'https://example.test/events/spring-concert/';
const URL_ONLY = 'https://elsewhere.test/workshop-night/';

const ENTRY = {
	id: 7,
	entry_date: '2026-09-01',
	entry_type: 'cost',
	amount: 40,
	description: 'Venue deposit',
	budget_id: null,
	event_url: LOCAL_URL,
	event_date_id: 12,
	parent_entry_id: null,
	transaction_ids: [],
	imported_at: null,
};

let EntriesApp;

beforeAll( () => {
	window.fairPaymentSettings = { eventsEnabled: '1' };
	EntriesApp = require( '../EntriesApp.js' ).default;
} );

afterAll( () => {
	delete window.fairPaymentSettings;
} );

afterEach( () => {
	jest.clearAllMocks();
	window.history.replaceState( null, '', BASE_PATH );
} );

/**
 * Route apiFetch by path.
 *
 * @param {Object}  options
 * @param {boolean} options.eventsAvailable Whether the Fair Events batch succeeds.
 */
const mockApi = ( { eventsAvailable = true } = {} ) => {
	apiFetch.mockImplementation( ( { path } ) => {
		const route = path.split( '?' )[ 0 ];
		switch ( route ) {
			case '/fair-finance/v1/financial-entries':
				return Promise.resolve( {
					entries: [ ENTRY ],
					total: 1,
					pages: 1,
				} );
			case '/fair-finance/v1/financial-entries/totals':
				return Promise.resolve( {
					total_cost: 0,
					total_income: 0,
					balance: 0,
				} );
			case '/fair-finance/v1/financial-entries/totals-by-tag':
				return Promise.resolve( {} );
			case '/fair-finance/v1/financial-entries/unbudgeted-count':
				return Promise.resolve( { count: 0 } );
			case '/fair-finance/v1/financial-entries/event-urls':
				return Promise.resolve( [ LOCAL_URL, URL_ONLY ] );
			case '/fair-finance/v1/financial-entries/event-date-ids':
				return Promise.resolve( [ 12 ] );
			case '/fair-events/v1/event-dates/batch':
				return eventsAvailable
					? Promise.resolve( [
							{
								id: 12,
								title: 'Spring Concert',
								display_url: LOCAL_URL,
							},
						] )
					: Promise.reject( new Error( 'No route' ) );
			default:
				return Promise.resolve( [] );
		}
	} );
};

const requestsTo = ( route ) =>
	apiFetch.mock.calls
		.map( ( [ { path } ] ) => path )
		.filter( ( path ) => path.split( '?' )[ 0 ] === route )
		.map( ( path ) => new URLSearchParams( path.split( '?' )[ 1 ] || '' ) );

const lastRequestTo = ( route ) => requestsTo( route ).at( -1 );
const LIST = '/fair-finance/v1/financial-entries';
const TOTALS = '/fair-finance/v1/financial-entries/totals';

const linkSelect = () => screen.findByRole( 'combobox', { name: 'Link' } );

const optionLabels = ( select ) =>
	within( select )
		.getAllByRole( 'option' )
		.map( ( option ) => option.textContent );

describe( 'EntriesApp — Link filter (#2134)', () => {
	it( 'lists local and URL-only links together, merging exact duplicates', async () => {
		mockApi();
		render( <EntriesApp /> );

		const select = await linkSelect();
		await waitFor( () =>
			expect( optionLabels( select ) ).toEqual( [
				'All Links',
				'Spring Concert',
				'workshop night',
			] )
		);
	} );

	it( 'sends one link selection to list and totals, switching and clearing cleanly', async () => {
		mockApi();
		render( <EntriesApp /> );
		const select = await linkSelect();
		await waitFor( () =>
			expect( optionLabels( select ) ).toHaveLength( 3 )
		);

		// Local event: filter by its ID only.
		fireEvent.change( select, { target: { value: 'id:12' } } );
		await waitFor( () =>
			expect( lastRequestTo( LIST ).get( 'event_date_id' ) ).toBe( '12' )
		);
		for ( const params of [
			lastRequestTo( LIST ),
			lastRequestTo( TOTALS ),
		] ) {
			expect( params.get( 'event_date_id' ) ).toBe( '12' );
			expect( params.has( 'event_url' ) ).toBe( false );
		}
		expect( lastRequestTo( LIST ).get( 'page' ) ).toBe( '1' );

		// Switch to a URL-only link: the event date ID is dropped.
		fireEvent.change( select, { target: { value: `url:${ URL_ONLY }` } } );
		await waitFor( () =>
			expect( lastRequestTo( LIST ).get( 'event_url' ) ).toBe( URL_ONLY )
		);
		for ( const params of [
			lastRequestTo( LIST ),
			lastRequestTo( TOTALS ),
		] ) {
			expect( params.get( 'event_url' ) ).toBe( URL_ONLY );
			expect( params.has( 'event_date_id' ) ).toBe( false );
		}

		// Clear: neither link field is sent.
		fireEvent.change( select, { target: { value: '' } } );
		await waitFor( () =>
			expect( lastRequestTo( LIST ).has( 'event_url' ) ).toBe( false )
		);
		for ( const params of [
			lastRequestTo( LIST ),
			lastRequestTo( TOTALS ),
		] ) {
			expect( params.has( 'event_url' ) ).toBe( false );
			expect( params.has( 'event_date_id' ) ).toBe( false );
		}
		expect( select ).toHaveValue( '' );
	} );

	it( 'exports with the same link selection as the list', async () => {
		mockApi();
		render( <EntriesApp /> );
		const select = await linkSelect();
		await waitFor( () =>
			expect( optionLabels( select ) ).toHaveLength( 3 )
		);

		fireEvent.change( select, { target: { value: 'id:12' } } );
		await waitFor( () =>
			expect( lastRequestTo( LIST ).get( 'event_date_id' ) ).toBe( '12' )
		);

		apiFetch.mockClear();
		fireEvent.click( screen.getByRole( 'button', { name: 'Export CSV' } ) );
		await waitFor( () =>
			expect(
				requestsTo( LIST ).some(
					( params ) => params.get( 'per_page' ) === '100'
				)
			).toBe( true )
		);
		const exportParams = requestsTo( LIST ).find(
			( params ) => params.get( 'per_page' ) === '100'
		);
		expect( exportParams.get( 'event_date_id' ) ).toBe( '12' );
		expect( exportParams.has( 'event_url' ) ).toBe( false );
	} );

	it( 'keeps an event_date_id deep link selected', async () => {
		window.history.replaceState(
			null,
			'',
			`${ BASE_PATH }&event_date_id=12`
		);
		mockApi();
		render( <EntriesApp /> );

		const select = await linkSelect();
		await waitFor( () => expect( select ).toHaveValue( 'id:12' ) );
		await waitFor( () =>
			expect( lastRequestTo( LIST ).get( 'event_date_id' ) ).toBe( '12' )
		);
		expect( lastRequestTo( TOTALS ).get( 'event_date_id' ) ).toBe( '12' );
	} );

	it( 'falls back to bare IDs alongside URL-only links without Fair Events data', async () => {
		mockApi( { eventsAvailable: false } );
		render( <EntriesApp /> );

		const select = await linkSelect();
		await waitFor( () =>
			expect( optionLabels( select ) ).toEqual( [
				'All Links',
				'#12',
				'spring concert',
				'workshop night',
			] )
		);
	} );
} );
