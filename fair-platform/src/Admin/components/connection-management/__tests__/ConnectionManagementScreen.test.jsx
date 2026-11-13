/**
 * Shared connection-log screen (#2231): loading, results, filters, pagination,
 * cleanup confirmation and per-instance state.
 */
import '@testing-library/jest-dom';
import {
	act,
	render,
	screen,
	fireEvent,
	within,
	waitFor,
} from '@testing-library/react';
import ConnectionManagementScreen from '../ConnectionManagementScreen.js';

const deferred = () => {
	let resolve;
	let reject;
	const promise = new Promise( ( res, rej ) => {
		resolve = res;
		reject = rej;
	} );
	return { promise, resolve, reject };
};

const makeApi = ( overrides = {} ) => ( {
	list: jest.fn( () =>
		Promise.resolve( {
			items: [ { id: 1, site_name: 'Alpha', status: 'connected' } ],
			total_pages: 1,
		} )
	),
	stats: jest.fn( () => Promise.resolve( { total: 4, unique: 2 } ) ),
	cleanup: jest.fn( () => Promise.resolve( { message: 'Cleaned.' } ) ),
	...overrides,
} );

const renderScreen = ( api, name = 'Test' ) =>
	render(
		<ConnectionManagementScreen
			api={ api }
			labels={ {
				title: `${ name } Logs`,
				description: `${ name } description`,
				listError: `${ name } list failed`,
				empty: `No ${ name } rows.`,
				history: `${ name } History`,
				cleanupTitle: `Delete old ${ name } logs`,
				cleanupMessage: ( days ) => `${ name } older than ${ days }`,
			} }
			statuses={ [
				{ value: 'connected', label: 'Connected', color: '#0a0' },
				{ value: 'failed', label: 'Failed', color: '#a00' },
			] }
			statistics={ [
				{ key: 'total', label: 'Total' },
				{ key: 'unique', label: 'Unique', color: '#00a' },
			] }
			columns={ [
				{
					id: 'extra',
					label: 'Extra',
					render: ( row ) => <code>{ row.extra || '-' }</code>,
				},
			] }
			renderStatusDetails={ ( row ) =>
				row.flag ? <span>Flagged</span> : null
			}
		/>
	);

// Notices repeat their text in a screen-reader live region; match the notice.
const NOTICE = { selector: '.components-notice__content' };

const lastQuery = ( api ) =>
	new URLSearchParams( api.list.mock.calls.at( -1 )[ 0 ] );

afterEach( () => {
	jest.clearAllMocks();
} );

test( 'shows a spinner, then rows, statistics and provider columns', async () => {
	const list = deferred();
	const api = makeApi( { list: jest.fn( () => list.promise ) } );
	const { container } = renderScreen( api );

	expect( container.querySelector( '.components-spinner' ) ).toBeTruthy();

	await act( async () => {
		list.resolve( {
			items: [
				{
					id: 7,
					site_name: 'Alpha',
					site_url: 'https://alpha.test',
					site_id: 'site-7',
					status: 'failed',
					error_message: 'Token expired',
					extra: 'X-1',
					flag: true,
					connected_at: null,
				},
				{ id: 8, status: 'mystery' },
			],
			total_pages: 1,
		} );
	} );

	const table = screen.getByRole( 'table' );
	expect(
		within( table )
			.getAllByRole( 'columnheader' )
			.map( ( th ) => th.textContent )
	).toEqual( [
		'ID',
		'Site',
		'Status',
		'Extra',
		'Connected At',
		'Last Refresh',
	] );
	expect(
		screen.getByRole( 'link', { name: 'https://alpha.test' } )
	).toHaveAttribute( 'target', '_blank' );
	expect( screen.getByText( 'site-7' ) ).toBeInTheDocument();
	expect( screen.getByText( 'Token expired' ) ).toBeInTheDocument();
	expect( screen.getByText( 'X-1' ) ).toBeInTheDocument();
	expect( screen.getByText( 'Flagged' ) ).toBeInTheDocument();
	// Unknown statuses fall back to their raw value.
	expect( screen.getByText( 'mystery' ) ).toBeInTheDocument();
	expect( screen.getByText( 'Total' ).previousSibling ).toHaveTextContent(
		'4'
	);
	expect( screen.getByText( 'Unique' ).previousSibling ).toHaveStyle( {
		color: '#00a',
	} );
	expect( api.list ).toHaveBeenCalledTimes( 1 );
	expect( Object.fromEntries( lastQuery( api ) ) ).toEqual( {
		page: '1',
		per_page: '50',
		orderby: 'connected_at',
		order: 'DESC',
	} );
} );

test( 'shows the empty message when there are no rows', async () => {
	const api = makeApi( {
		list: jest.fn( () => Promise.resolve( { items: [] } ) ),
	} );
	renderScreen( api );

	expect( await screen.findByText( 'No Test rows.' ) ).toBeInTheDocument();
	expect( screen.queryByRole( 'table' ) ).not.toBeInTheDocument();
} );

test( 'shows a list failure with its message or the provider fallback', async () => {
	const api = makeApi( {
		list: jest
			.fn()
			.mockRejectedValueOnce( {} )
			.mockRejectedValueOnce( { message: 'Server down' } ),
	} );
	renderScreen( api );

	expect(
		await screen.findByText( 'Test list failed', NOTICE )
	).toBeInTheDocument();
	fireEvent.change( screen.getByLabelText( 'Order' ), {
		target: { value: 'ASC' },
	} );
	expect(
		await screen.findByText( 'Server down', NOTICE )
	).toBeInTheDocument();
} );

test( 'a statistics failure hides the cards but keeps the list', async () => {
	const api = makeApi( {
		stats: jest.fn( () => Promise.reject( new Error( 'nope' ) ) ),
	} );
	renderScreen( api );

	expect( await screen.findByText( 'Alpha' ) ).toBeInTheDocument();
	await waitFor( () => expect( console ).toHaveErrored() );
	expect( screen.queryByText( 'Total' ) ).not.toBeInTheDocument();
} );

test( 'filters, sorting and pages are sent as request parameters', async () => {
	const api = makeApi( {
		list: jest.fn( () =>
			Promise.resolve( { items: [ { id: 1 } ], total_pages: 2 } )
		),
	} );
	renderScreen( api );

	expect( await screen.findByText( 'Page 1 of 2' ) ).toBeInTheDocument();
	expect( screen.getByRole( 'button', { name: 'Previous' } ) ).toBeDisabled();

	expect(
		within( screen.getByLabelText( 'Status Filter' ) )
			.getAllByRole( 'option' )
			.map( ( option ) => option.value )
	).toEqual( [ '', 'connected', 'failed' ] );

	fireEvent.change( screen.getByLabelText( 'Status Filter' ), {
		target: { value: 'failed' },
	} );
	fireEvent.change( screen.getByLabelText( 'Sort By' ), {
		target: { value: 'site_name' },
	} );
	fireEvent.change( screen.getByLabelText( 'Order' ), {
		target: { value: 'ASC' },
	} );
	await screen.findByText( 'Page 1 of 2' );
	expect( Object.fromEntries( lastQuery( api ) ) ).toEqual( {
		page: '1',
		per_page: '50',
		orderby: 'site_name',
		order: 'ASC',
		status: 'failed',
	} );

	fireEvent.click( screen.getByRole( 'button', { name: 'Next' } ) );
	expect( await screen.findByText( 'Page 2 of 2' ) ).toBeInTheDocument();
	expect( lastQuery( api ).get( 'page' ) ).toBe( '2' );
	expect( screen.getByRole( 'button', { name: 'Next' } ) ).toBeDisabled();
	// Statistics reload with every list request, as before the refactor.
	expect( api.stats ).toHaveBeenCalledTimes( api.list.mock.calls.length );
} );

test( 'cancelling the cleanup sends nothing', async () => {
	const api = makeApi();
	renderScreen( api );
	await screen.findByText( 'Alpha' );

	fireEvent.click(
		screen.getByRole( 'button', { name: 'Cleanup Old Logs' } )
	);
	const dialog = screen.getByRole( 'dialog', {
		name: 'Delete old Test logs',
	} );
	expect( dialog ).toHaveTextContent( 'Test older than 90' );
	expect( dialog ).toHaveTextContent( 'existing connections keep working' );

	fireEvent.click(
		within( dialog ).getByRole( 'button', { name: 'Cancel' } )
	);
	expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
	expect( api.cleanup ).not.toHaveBeenCalled();
} );

test( 'cleanup captures the days, blocks a second submission, retries a failure and refreshes', async () => {
	const first = deferred();
	const api = makeApi( {
		cleanup: jest
			.fn()
			.mockImplementationOnce( () => first.promise )
			.mockImplementationOnce( () => Promise.resolve( {} ) ),
	} );
	renderScreen( api );
	await screen.findByText( 'Alpha' );

	fireEvent.change( screen.getByLabelText( 'Cleanup Days' ), {
		target: { value: '30' },
	} );
	fireEvent.click(
		screen.getByRole( 'button', { name: 'Cleanup Old Logs' } )
	);
	const dialog = screen.getByRole( 'dialog' );
	expect( dialog ).toHaveTextContent( 'Test older than 30' );

	// Changing the field after opening does not alter the captured target.
	fireEvent.change( screen.getByLabelText( 'Cleanup Days' ), {
		target: { value: '5' },
	} );
	expect( dialog ).toHaveTextContent( 'Test older than 30' );

	await act( async () => {
		fireEvent.click(
			within( dialog ).getByRole( 'button', { name: 'Delete old logs' } )
		);
	} );
	const busy = within( dialog ).getByRole( 'button', { name: 'Deleting…' } );
	await act( async () => {
		fireEvent.click( busy );
	} );
	expect( api.cleanup ).toHaveBeenCalledTimes( 1 );
	expect( api.cleanup ).toHaveBeenCalledWith( 30 );
	expect(
		within( dialog ).getByRole( 'button', { name: 'Cancel' } )
	).toBeDisabled();
	fireEvent.keyDown( dialog, { key: 'Escape', code: 'Escape', keyCode: 27 } );
	expect( screen.getByRole( 'dialog' ) ).toBeInTheDocument();

	await act( async () => {
		first.reject( {} );
	} );
	expect( dialog ).toHaveTextContent(
		'The old logs could not be deleted. Try again.'
	);
	const listCalls = api.list.mock.calls.length;

	await act( async () => {
		fireEvent.click(
			within( dialog ).getByRole( 'button', { name: 'Delete old logs' } )
		);
	} );
	expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
	expect(
		screen.getByText( 'Old logs cleaned up successfully', NOTICE )
	).toBeInTheDocument();
	expect( api.cleanup ).toHaveBeenLastCalledWith( 30 );
	expect( api.list ).toHaveBeenCalledTimes( listCalls + 1 );
	expect( api.stats ).toHaveBeenCalledTimes( listCalls + 1 );
} );

test( 'a delayed list response does not overwrite a newer one', async () => {
	const slow = deferred();
	const api = makeApi( {
		list: jest
			.fn()
			.mockImplementationOnce( () => slow.promise )
			.mockImplementation( () =>
				Promise.resolve( {
					items: [ { id: 2, site_name: 'Newer' } ],
				} )
			),
	} );
	renderScreen( api );

	fireEvent.change( screen.getByLabelText( 'Order' ), {
		target: { value: 'ASC' },
	} );
	expect( await screen.findByText( 'Newer' ) ).toBeInTheDocument();

	await act( async () => {
		slow.resolve( { items: [ { id: 1, site_name: 'Stale' } ] } );
	} );
	expect( screen.getByText( 'Newer' ) ).toBeInTheDocument();
	expect( screen.queryByText( 'Stale' ) ).not.toBeInTheDocument();
} );

test( 'a response arriving after unmount is ignored', async () => {
	const slow = deferred();
	const stats = deferred();
	const api = makeApi( {
		list: jest.fn( () => slow.promise ),
		stats: jest.fn( () => stats.promise ),
	} );
	const { unmount } = renderScreen( api );
	unmount();

	await act( async () => {
		slow.resolve( { items: [ { id: 1 } ] } );
		stats.reject( new Error( 'late' ) );
	} );
	// No state update, and no statistics error logged after unmount.
	expect( console ).not.toHaveErrored();
} );

test( 'two mounted screens keep separate state, even with the same row IDs', async () => {
	const ordinaryList = deferred();
	const ordinary = makeApi( {
		list: jest.fn( () => ordinaryList.promise ),
	} );
	const instagram = makeApi( {
		list: jest.fn( () =>
			Promise.resolve( {
				items: [ { id: 1, site_name: 'Insta site' } ],
			} )
		),
		stats: jest.fn( () => Promise.resolve( { total: 9, unique: 1 } ) ),
	} );

	// Separate roots in one document, like two admin tabs' bundles would be.
	renderScreen( ordinary, 'Ordinary' );
	renderScreen( instagram, 'Instagram' );

	const instagramHistory = await screen.findByText( 'Insta site' );
	expect( instagramHistory ).toBeInTheDocument();
	// The ordinary screen is still loading its own list.
	expect(
		screen
			.getByText( 'Ordinary History' )
			.closest( '.components-card' )
			.querySelector( '.components-spinner' )
	).toBeTruthy();
	expect( screen.getAllByRole( 'table' ) ).toHaveLength( 1 );

	await act( async () => {
		ordinaryList.resolve( {
			items: [ { id: 1, site_name: 'Ordinary site' } ],
		} );
	} );
	expect( screen.getByText( 'Ordinary site' ) ).toBeInTheDocument();
	expect( screen.getByText( 'Insta site' ) ).toBeInTheDocument();

	// Filtering one screen does not request the other.
	const instagramCalls = instagram.list.mock.calls.length;
	const [ ordinaryOrder ] = screen.getAllByLabelText( 'Order' );
	fireEvent.change( ordinaryOrder, { target: { value: 'ASC' } } );
	await waitFor( () => expect( ordinary.list ).toHaveBeenCalledTimes( 2 ) );
	expect( instagram.list ).toHaveBeenCalledTimes( instagramCalls );

	// Cleanup on one screen refreshes only that provider.
	const [ , instagramCleanup ] = screen.getAllByRole( 'button', {
		name: 'Cleanup Old Logs',
	} );
	fireEvent.click( instagramCleanup );
	const dialog = screen.getByRole( 'dialog', {
		name: 'Delete old Instagram logs',
	} );
	await act( async () => {
		fireEvent.click(
			within( dialog ).getByRole( 'button', { name: 'Delete old logs' } )
		);
	} );
	expect( instagram.cleanup ).toHaveBeenCalledTimes( 1 );
	expect( ordinary.cleanup ).not.toHaveBeenCalled();
	expect( ordinary.list ).toHaveBeenCalledTimes( 2 );
	expect( screen.getAllByText( 'Cleaned.', NOTICE ) ).toHaveLength( 1 );
} );
