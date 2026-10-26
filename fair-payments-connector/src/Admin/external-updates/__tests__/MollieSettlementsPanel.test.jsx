/**
 * Loading new Mollie settlements from External Updates (#1694): the same
 * server-held import as the Settlements page in Fair Finance, inside this
 * page's one-action-at-a-time model.
 */
import '@testing-library/jest-dom';
import {
	configure,
	fireEvent,
	render,
	screen,
	waitFor,
} from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import MollieSettlementsPanel, {
	MOLLIE_SETTLEMENTS_ACTION,
} from '../components/MollieSettlementsPanel.js';

jest.mock( '@wordpress/api-fetch' );

// Notices also announce themselves in a live region, which would make every
// notice text match twice. Mocking @wordpress/a11y is not enough: components
// may resolve its own copy of the package, so ignore the region instead.
configure( { defaultIgnore: 'script, style, .a11y-speak-region' } );

const IMPORTS = '/fair-payments-connector/v1/settlements/imports';

const run = ( overrides = {} ) => ( {
	id: 5,
	kind: 'new',
	status: 'running',
	resumable: false,
	progress: {
		settlements_done: 0,
		settlements_skipped: 0,
		settlements_queued: 0,
		listing_done: false,
		requests_done: 0,
		current_part: null,
	},
	error_code: null,
	error_message: null,
	...overrides,
} );

/**
 * Route apiFetch calls to canned answers.
 *
 * @param {Object} routes `"METHOD path"` to a value or a function.
 * @return {Array} Request keys, in order.
 */
const mockApi = ( routes = {} ) => {
	const calls = [];
	const answers = { [ `GET ${ IMPORTS }` ]: { run: null }, ...routes };

	apiFetch.mockImplementation( ( request ) => {
		const key = `${ request.method || 'GET' } ${ request.path }`;
		calls.push( key );
		const answer = answers[ key ];
		if ( answer === undefined ) {
			return Promise.reject( { message: `unexpected ${ key }` } );
		}
		const value = typeof answer === 'function' ? answer( request ) : answer;
		return value?.reject
			? Promise.reject( value.reject )
			: Promise.resolve( value );
	} );

	return calls;
};

const renderPanel = ( props = {} ) => {
	const onBegin = jest.fn( () => true );
	const onEnd = jest.fn();
	const utils = render(
		<MollieSettlementsPanel
			activeAction={ null }
			onBegin={ onBegin }
			onEnd={ onEnd }
			{ ...props }
		/>
	);
	return { ...utils, onBegin, onEnd };
};

beforeEach( () => {
	window.fairPaymentsExternalUpdates = {
		financeActive: true,
		settlementsUrl: 'admin.php?page=fair-finance-settlements',
	};
} );

afterEach( () => {
	apiFetch.mockReset();
} );

it( 'loads new settlements inside the page busy state and reports the result', async () => {
	const steps = [
		run( { progress: { ...run().progress, settlements_done: 1 } } ),
		run( {
			status: 'completed',
			progress: {
				...run().progress,
				settlements_done: 2,
				settlements_skipped: 1,
			},
		} ),
	];
	let request;
	const calls = mockApi( {
		[ `POST ${ IMPORTS }` ]: ( options ) => {
			request = options.data;
			return { run: run() };
		},
		[ `POST ${ IMPORTS }/5/step` ]: () => ( { run: steps.shift() } ),
	} );

	const { onBegin, onEnd } = renderPanel();

	expect(
		screen.getByRole( 'link', {
			name: 'Inspect or reload settlements in Fair Finance.',
		} )
	).toHaveAttribute( 'href', 'admin.php?page=fair-finance-settlements' );

	fireEvent.click(
		await screen.findByRole( 'button', { name: 'Load new settlements' } )
	);

	expect(
		await screen.findByText( 'Loaded 2 settlements from Mollie.' )
	).toBeInTheDocument();
	expect( request ).toEqual( { kind: 'new', settlement_id: 0 } );
	expect( onBegin ).toHaveBeenCalledWith( MOLLIE_SETTLEMENTS_ACTION );
	expect( onBegin ).toHaveBeenCalledTimes( 1 );
	expect( onEnd ).toHaveBeenCalledTimes( 1 );
	expect(
		calls.filter( ( key ) => key === `POST ${ IMPORTS }/5/step` )
	).toHaveLength( 2 );
} );

it( 'says so when nothing new was found', async () => {
	mockApi( {
		[ `POST ${ IMPORTS }` ]: { run: run() },
		[ `POST ${ IMPORTS }/5/step` ]: {
			run: run( {
				status: 'completed',
				progress: { ...run().progress, settlements_skipped: 3 },
			} ),
		},
	} );

	renderPanel();
	fireEvent.click(
		await screen.findByRole( 'button', { name: 'Load new settlements' } )
	);

	expect(
		await screen.findByText(
			'Nothing new: all 3 settlements Mollie lists are already saved.'
		)
	).toBeInTheDocument();
} );

it( 'continues an import left unfinished on another page', async () => {
	const calls = mockApi( {
		[ `GET ${ IMPORTS }` ]: {
			run: run( {
				kind: 'history',
				status: 'interrupted',
				resumable: true,
				error_code: 'interrupted',
				error_message: 'The import stopped before it finished.',
				progress: { ...run().progress, settlements_done: 4 },
			} ),
		},
		[ `POST ${ IMPORTS }/5/step` ]: {
			run: run( {
				kind: 'history',
				status: 'completed',
				progress: { ...run().progress, settlements_done: 6 },
			} ),
		},
	} );

	const { onEnd } = renderPanel();

	expect(
		await screen.findByText( '“Reload all settlements” did not finish.' )
	).toBeInTheDocument();
	expect(
		screen.getByText( /4 settlements loaded so far\./ )
	).toBeInTheDocument();
	// A replacement stays possible.
	expect(
		screen.getByRole( 'button', { name: 'Load new settlements' } )
	).toBeEnabled();

	fireEvent.click(
		screen.getByRole( 'button', { name: 'Continue import' } )
	);

	expect(
		await screen.findByText( 'Loaded 6 settlements from Mollie.' )
	).toBeInTheDocument();
	// The same run was continued; none was started.
	expect( calls ).not.toContain( `POST ${ IMPORTS }` );
	expect( onEnd ).toHaveBeenCalledTimes( 1 );
} );

it( 'shows the server error and the run as the server has it after a failed step', async () => {
	mockApi( {
		[ `POST ${ IMPORTS }` ]: { run: run() },
		[ `POST ${ IMPORTS }/5/step` ]: {
			reject: { message: 'You are offline.' },
		},
		[ `GET ${ IMPORTS }/5` ]: {
			run: run( {
				status: 'failed',
				resumable: true,
				error_code: 'mollie_request_failed',
				error_message: 'Mollie could not be reached.',
			} ),
		},
	} );

	const { onEnd } = renderPanel();
	fireEvent.click(
		await screen.findByRole( 'button', { name: 'Load new settlements' } )
	);

	expect( await screen.findByText( 'You are offline.' ) ).toBeInTheDocument();
	expect(
		await screen.findByText( '“Load new settlements” did not finish.' )
	).toBeInTheDocument();
	expect(
		screen.getByRole( 'button', { name: 'Continue import' } )
	).toBeEnabled();
	expect(
		screen.getByRole( 'button', { name: 'Load new settlements' } )
	).toBeEnabled();
	expect( onEnd ).toHaveBeenCalledTimes( 1 );
} );

it( 'keeps a run the server counts as active protected and offers a status refresh', async () => {
	const calls = mockApi( {
		[ `GET ${ IMPORTS }` ]: { run: run() },
		[ `GET ${ IMPORTS }/5` ]: {
			run: run( {
				status: 'interrupted',
				resumable: true,
				error_message: 'The import stopped before it finished.',
			} ),
		},
	} );

	renderPanel();

	expect(
		await screen.findByText( '“Load new settlements” is running.' )
	).toBeInTheDocument();
	expect(
		screen.getByRole( 'button', { name: 'Load new settlements' } )
	).toBeDisabled();

	fireEvent.click( screen.getByRole( 'button', { name: 'Refresh status' } ) );

	expect(
		await screen.findByText( '“Load new settlements” did not finish.' )
	).toBeInTheDocument();
	expect(
		screen.getByRole( 'button', { name: 'Load new settlements' } )
	).toBeEnabled();
	expect( calls ).toContain( `GET ${ IMPORTS }/5` );
} );

it( 'is disabled while another action runs on the page, and starts nothing', async () => {
	const calls = mockApi();

	const { onBegin } = renderPanel( {
		activeAction: 'load_missing_mollie_fees',
	} );

	await waitFor( () => expect( calls ).toContain( `GET ${ IMPORTS }` ) );
	expect(
		screen.getByRole( 'button', { name: 'Load new settlements' } )
	).toBeDisabled();
	expect( onBegin ).not.toHaveBeenCalled();
	expect( calls ).not.toContain( `POST ${ IMPORTS }` );
} );

it( 'starts nothing when the page refuses the busy state', async () => {
	const calls = mockApi();
	const onBegin = jest.fn( () => false );

	renderPanel( { onBegin } );
	fireEvent.click(
		await screen.findByRole( 'button', { name: 'Load new settlements' } )
	);

	await waitFor( () => expect( onBegin ).toHaveBeenCalled() );
	expect( calls ).not.toContain( `POST ${ IMPORTS }` );
} );
