/**
 * Connected-site imports from External Updates (#1695).
 */
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import ConnectedSitesPanel from '../components/ConnectedSitesPanel.js';

jest.mock( '@wordpress/api-fetch' );

const SITES = '/fair-payments-connector/v1/admin/connected-sites';
const RUNS = '/fair-payments-connector/v1/external-updates/runs';

const noticeText = ( text ) =>
	screen.queryByText(
		( content, element ) =>
			content === text &&
			element?.className === 'components-notice__content'
	);

const renderPanel = ( props = {} ) => {
	const onBegin = jest.fn( () => true );
	const onEnd = jest.fn();
	render(
		<ConnectedSitesPanel
			activeAction={ null }
			onBegin={ onBegin }
			onEnd={ onEnd }
			{ ...props }
		/>
	);
	return { onBegin, onEnd };
};

beforeEach( () => {
	window.fairPaymentsExternalUpdates = {
		connectedSitesUrl:
			'/wp-admin/admin.php?page=fair-payments-connector-connected-sites',
	};
} );

afterEach( () => {
	apiFetch.mockReset();
} );

it( 'lists disabled sites with an explanation and no way to import from them', async () => {
	apiFetch.mockResolvedValueOnce( [
		{
			id: 1,
			label: 'enabled.example',
			base_url: 'https://a',
			enabled: true,
		},
		{
			id: 2,
			label: 'disabled.example',
			base_url: 'https://b',
			enabled: false,
		},
	] );

	renderPanel();

	expect(
		await screen.findByRole( 'button', {
			name: 'Import transactions from enabled.example',
		} )
	).toBeEnabled();
	expect(
		screen.getByRole( 'button', {
			name: 'Import transactions from disabled.example',
		} )
	).toBeDisabled();
	expect(
		screen.getByText(
			'Disabled. Enable it on the Connected Sites page to import from it.'
		)
	).toBeInTheDocument();
} );

it( 'starts a run for the site and passes its ID to the import', async () => {
	apiFetch
		.mockResolvedValueOnce( [
			{
				id: 3,
				label: 'shop.example',
				base_url: 'https://c',
				enabled: true,
			},
		] )
		.mockResolvedValueOnce( { run: { id: 11, status: 'running' } } )
		.mockResolvedValueOnce( {
			created: 2,
			updated: 1,
			skipped: 0,
			run: {
				id: 11,
				status: 'succeeded',
				counts: { created: 2, updated: 1, skipped: 0, failed: 0 },
			},
		} );

	const { onBegin, onEnd } = renderPanel();
	fireEvent.click(
		await screen.findByRole( 'button', {
			name: 'Import transactions from shop.example',
		} )
	);

	await waitFor( () =>
		expect(
			noticeText( 'Finished: 2 new, 1 updated.' )
		).toBeInTheDocument()
	);
	expect( onBegin ).toHaveBeenCalledWith( 'import_connected_site:3' );
	expect( apiFetch ).toHaveBeenNthCalledWith(
		2,
		expect.objectContaining( {
			path: RUNS,
			data: { action: 'import_connected_site', source_id: '3' },
		} )
	);
	expect( apiFetch ).toHaveBeenNthCalledWith(
		3,
		expect.objectContaining( {
			path: `${ SITES }/3/import-transactions`,
			method: 'POST',
			data: { run_id: 11 },
		} )
	);
	expect( onEnd ).toHaveBeenCalledTimes( 1 );
} );

it( 'reports a remote failure after partial progress as partly completed', async () => {
	apiFetch
		.mockResolvedValueOnce( [
			{
				id: 3,
				label: 'shop.example',
				base_url: 'https://c',
				enabled: true,
			},
		] )
		.mockResolvedValueOnce( { run: { id: 12, status: 'running' } } )
		.mockRejectedValueOnce( {
			code: 'rest_connected_site_unreachable',
			message: 'The import from shop.example stopped after 200 new…',
			data: {
				status: 502,
				run: {
					id: 12,
					status: 'partial',
					counts: { created: 200, updated: 0, skipped: 0, failed: 0 },
					error_message: 'The connected site could not be reached.',
				},
			},
		} );

	renderPanel();
	fireEvent.click(
		await screen.findByRole( 'button', {
			name: 'Import transactions from shop.example',
		} )
	);

	const notice = await waitFor( () => {
		const found = noticeText(
			'Partly completed: 200 new. The connected site could not be reached.'
		);
		expect( found ).toBeInTheDocument();
		return found;
	} );
	expect( notice.closest( '.components-notice' ) ).toHaveClass(
		'is-warning'
	);
} );

it( 'explains the setup when connected sites are not available', async () => {
	apiFetch.mockRejectedValueOnce( {
		code: 'rest_no_route',
		message: 'No route was found matching the URL and request method.',
		data: { status: 404 },
	} );

	renderPanel();

	expect(
		await screen.findByText(
			/needs the Fair Payments Connector Experimental plugin/
		)
	).toBeInTheDocument();
} );

it( 'links to the Connected Sites page when none exist', async () => {
	apiFetch.mockResolvedValueOnce( [] );

	renderPanel();

	expect(
		await screen.findByRole( 'link', {
			name: 'Add one on the Connected Sites page.',
		} )
	).toHaveAttribute(
		'href',
		'/wp-admin/admin.php?page=fair-payments-connector-connected-sites'
	);
} );
