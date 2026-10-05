/**
 * @jest-environment jsdom
 *
 * Component tests for the Groups tab's load states (#1716): a failed load is
 * never presented as an empty rule list, and the list, the empty state and
 * the editing controls only appear once all three requests have succeeded.
 */
import '@testing-library/jest-dom';
import {
	act,
	fireEvent,
	render,
	waitFor,
	within,
} from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import GroupRules from '../GroupRules.js';

jest.mock( '@wordpress/api-fetch' );

const EMPTY_STATE = 'No group rules yet. Add one below.';
const LOAD_FAILURE = /Group rules could not be loaded\./;

const GROUPS = [
	{ id: 5, name: 'Members' },
	{ id: 6, name: 'Volunteers' },
];
const PRICING = [
	{
		id: 11,
		group_id: 5,
		group_name: 'Members',
		discount_type: 'percentage',
		discount_value: 20,
	},
];
const PERMISSIONS = [ { id: 21, group_id: 5, permission_type: 'invited' } ];

const noRoute = () =>
	Object.assign( new Error( 'No route was found matching the URL.' ), {
		code: 'rest_no_route',
	} );

/** Which of the three load requests a path belongs to. */
function requestName( path ) {
	if ( path.endsWith( '/group-pricing-rules' ) ) {
		return 'pricing';
	}
	if ( path.endsWith( '/group-permission-rules' ) ) {
		return 'permissions';
	}
	if ( path === '/fair-audience/v1/groups' ) {
		return 'groups';
	}
	return null;
}

/**
 * Route apiFetch by path. `responses` maps a load request name to its payload
 * or to an Error to reject with; writes go to `onWrite`.
 */
function mockApi( responses, onWrite = () => Promise.resolve( {} ) ) {
	apiFetch.mockImplementation( ( options ) => {
		if ( options.method && options.method !== 'GET' ) {
			return onWrite( options );
		}
		const response = responses[ requestName( options.path ) ];
		return response instanceof Error
			? Promise.reject( response )
			: Promise.resolve( response );
	} );
}

/**
 * Render the tab and return queries scoped to it. Notices are also announced
 * through `@wordpress/a11y` live regions on `document.body`, which outlive a
 * test, so unscoped text queries would match those copies too.
 */
function renderRules( eventDateId = 139 ) {
	const view = render( <GroupRules eventDateId={ eventDateId } /> );
	return { ...view, tab: within( view.container ) };
}

const loaded = { pricing: PRICING, permissions: PERMISSIONS, groups: GROUPS };
const empty = { pricing: [], permissions: [], groups: GROUPS };

describe( 'GroupRules load states', () => {
	beforeEach( () => {
		apiFetch.mockReset();
	} );

	it( 'shows the rules and editing controls once every request succeeds', async () => {
		mockApi( loaded );
		const { tab } = renderRules();

		expect(
			await tab.findByRole( 'heading', { name: 'Members' } )
		).toBeInTheDocument();
		expect( tab.getByText( /20%/ ) ).toBeInTheDocument();
		expect( tab.getAllByLabelText( 'Invited' )[ 0 ] ).toBeChecked();
		expect(
			tab.getByRole( 'heading', { name: 'Add Group' } )
		).toBeInTheDocument();
		expect( tab.queryByText( EMPTY_STATE ) ).not.toBeInTheDocument();
		expect( tab.queryByText( LOAD_FAILURE ) ).not.toBeInTheDocument();
	} );

	it( 'shows the empty state only after a successful empty load', async () => {
		let resolveGroups;
		apiFetch.mockImplementation( ( { path } ) =>
			requestName( path ) === 'groups'
				? new Promise( ( resolve ) => {
						resolveGroups = resolve;
				  } )
				: Promise.resolve( [] )
		);
		const { tab } = renderRules();

		// Two of three requests are back: still loading, not "no rules".
		await waitFor( () => expect( resolveGroups ).toBeDefined() );
		expect( tab.queryByText( EMPTY_STATE ) ).not.toBeInTheDocument();

		await act( async () => resolveGroups( GROUPS ) );

		expect( tab.getByText( EMPTY_STATE ) ).toBeInTheDocument();
		expect(
			tab.getByRole( 'heading', { name: 'Add Group' } )
		).toBeInTheDocument();
	} );

	it.each( [ 'pricing', 'permissions', 'groups' ] )(
		'shows an error instead of an empty list when the %s request fails',
		async ( failing ) => {
			mockApi( { ...empty, [ failing ]: noRoute() } );
			const { tab } = renderRules();

			expect( await tab.findByText( LOAD_FAILURE ) ).toHaveTextContent(
				'No route was found matching the URL.'
			);
			expect(
				tab.getByRole( 'button', { name: 'Retry' } )
			).toBeInTheDocument();
			expect( tab.queryByText( EMPTY_STATE ) ).not.toBeInTheDocument();
			expect(
				tab.queryByRole( 'heading', { name: 'Add Group' } )
			).not.toBeInTheDocument();
			// The load failure is not a dismissible notice.
			expect(
				tab.queryByRole( 'button', { name: /dismiss|close/i } )
			).not.toBeInTheDocument();
		}
	);

	it( 'loads the rules when Retry succeeds after a failure', async () => {
		mockApi( { ...loaded, pricing: noRoute() } );
		const { tab } = renderRules();

		const retry = await tab.findByRole( 'button', { name: 'Retry' } );
		mockApi( loaded );
		fireEvent.click( retry );

		expect(
			await tab.findByRole( 'heading', { name: 'Members' } )
		).toBeInTheDocument();
		expect( tab.queryByText( LOAD_FAILURE ) ).not.toBeInTheDocument();
	} );

	it( 'keeps the rules visible when a failed change is dismissed', async () => {
		mockApi( loaded, () =>
			Promise.reject( new Error( 'Permission could not be saved.' ) )
		);
		const { tab } = renderRules();

		fireEvent.click(
			( await tab.findAllByLabelText( 'View signups' ) )[ 0 ]
		);

		expect(
			await tab.findByText( 'Permission could not be saved.' )
		).toBeInTheDocument();
		fireEvent.click(
			tab.getByRole( 'button', { name: /dismiss|close/i } )
		);

		expect(
			tab.queryByText( 'Permission could not be saved.' )
		).not.toBeInTheDocument();
		expect(
			tab.getByRole( 'heading', { name: 'Members' } )
		).toBeInTheDocument();
		expect( tab.queryByText( EMPTY_STATE ) ).not.toBeInTheDocument();
	} );

	it( 'reports a failed refresh after a change instead of success', async () => {
		window.confirm = jest.fn( () => true );
		mockApi( loaded );
		const { tab } = renderRules();

		const remove = await tab.findByRole( 'button', { name: 'Remove' } );
		// The deletes succeed, but the reload that follows does not.
		mockApi( { ...loaded, permissions: noRoute() } );
		fireEvent.click( remove );

		expect( await tab.findByText( LOAD_FAILURE ) ).toBeInTheDocument();
		expect(
			tab.queryByText( 'Group rules removed.' )
		).not.toBeInTheDocument();
		expect( tab.queryByText( EMPTY_STATE ) ).not.toBeInTheDocument();
	} );

	it( 'ignores a response for a previous event', async () => {
		const pending = {};
		apiFetch.mockImplementation( ( { path } ) => {
			const eventId = path.match( /event-dates\/(\d+)/ )?.[ 1 ];
			const name = requestName( path );
			if ( name === 'pricing' && eventId === '1' ) {
				return new Promise( ( resolve ) => {
					pending.first = resolve;
				} );
			}
			return Promise.resolve( name === 'groups' ? GROUPS : [] );
		} );

		const { tab, rerender } = renderRules( 1 );
		await waitFor( () => expect( pending.first ).toBeDefined() );

		rerender( <GroupRules eventDateId={ 2 } /> );
		expect( await tab.findByText( EMPTY_STATE ) ).toBeInTheDocument();

		// Event 1's rules arrive late and must not replace event 2's.
		await act( async () => pending.first( PRICING ) );

		expect( tab.getByText( EMPTY_STATE ) ).toBeInTheDocument();
		expect(
			tab.queryByRole( 'heading', { name: 'Members' } )
		).not.toBeInTheDocument();
	} );
} );
