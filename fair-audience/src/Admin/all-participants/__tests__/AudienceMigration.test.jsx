/**
 * @jest-environment jsdom
 *
 * Component tests for the audience CSV export and import (#2218): the
 * overflow menu's export download and the import popup's upload, pending
 * and error states and result report.
 */
import '@testing-library/jest-dom';
import { act, render, screen, fireEvent } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import AudienceMigrationMenu from '../AudienceMigrationMenu.js';
import ImportAudienceModal from '../ImportAudienceModal.js';

jest.mock( '@wordpress/api-fetch' );

const RESULT = {
	total: 6,
	imported: [ { line: 2, name: 'Marta Gómez', email: 'marta@example.net' } ],
	already_present: [ { line: 3, name: 'Jo Lee', email: 'jo@example.com' } ],
	missing_email: [ { line: 4, name: 'Li Wei', email: '' } ],
	conflicts: [
		{
			line: 5,
			name: 'Ana Ruiz',
			email: 'ana@example.com',
			fields: [ 'email_profile', 'weekly_summary_opt_out' ],
			untransferred_opt_out: [ 'weekly_summary_opt_out' ],
		},
	],
	invalid: [
		{
			line: 6,
			name: 'Bo',
			email: 'bo@example.com',
			errors: [
				{
					field: 'email_profile',
					message:
						'email_profile must be minimal, marketing or declined.',
				},
			],
		},
	],
	failed: [],
};

const deferred = () => {
	let resolve;
	let reject;
	const promise = new Promise( ( res, rej ) => {
		resolve = res;
		reject = rej;
	} );
	return { promise, resolve, reject };
};

const chooseFile = () => {
	const file = new window.File( [ 'format_version\n' ], 'audience.csv', {
		type: 'text/csv',
	} );
	fireEvent.change( screen.getByLabelText( 'CSV file' ), {
		target: { files: [ file ] },
	} );
	return file;
};

afterEach( () => {
	jest.resetAllMocks();
} );

describe( 'ImportAudienceModal', () => {
	it( 'explains what moves and needs a file before importing', () => {
		render(
			<ImportAudienceModal
				onClose={ jest.fn() }
				onImported={ jest.fn() }
			/>
		);

		expect(
			screen.getByText( /Feed subscriptions are not transferred/ )
		).toBeInTheDocument();
		expect(
			screen.getByText( /Existing members are never changed/ )
		).toBeInTheDocument();
		expect(
			screen.getByText( 'Choose a file to import.' )
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: 'Import members' } )
		).toHaveAttribute( 'aria-disabled', 'true' );
	} );

	it( 'uploads the file, blocks closing while pending and reports every outcome', async () => {
		const request = deferred();
		apiFetch.mockReturnValue( request.promise );
		const onClose = jest.fn();
		const onImported = jest.fn();
		render(
			<ImportAudienceModal
				onClose={ onClose }
				onImported={ onImported }
			/>
		);

		const file = chooseFile();
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Import members' } )
		);

		expect( apiFetch ).toHaveBeenCalledTimes( 1 );
		const call = apiFetch.mock.calls[ 0 ][ 0 ];
		expect( call.path ).toBe( '/fair-audience/v1/participants/import' );
		expect( call.method ).toBe( 'POST' );
		expect( call.body.get( 'file' ) ).toBe( file );

		const pending = screen.getByRole( 'button', { name: 'Importing…' } );
		expect( pending ).toHaveAttribute( 'aria-disabled', 'true' );
		expect(
			screen.getByRole( 'button', { name: 'Cancel' } )
		).toBeDisabled();
		fireEvent.click( pending );
		fireEvent.keyDown( screen.getByRole( 'dialog' ), { key: 'Escape' } );
		expect( apiFetch ).toHaveBeenCalledTimes( 1 );
		expect( onClose ).not.toHaveBeenCalled();

		await act( async () => {
			request.resolve( RESULT );
		} );

		expect( onImported ).toHaveBeenCalledTimes( 1 );
		// The report keeps focus inside the popup once the form is gone.
		expect( document.activeElement ).toHaveClass(
			'fair-audience-import__report'
		);
		expect(
			screen.getByText( 'The file had 6 rows. Added 1 new member.' )
		).toBeInTheDocument();
		expect(
			screen.getByText( 'Conflicts with existing members, skipped: 1' )
		).toBeInTheDocument();
		expect(
			screen.getByText( 'Line 5: Ana Ruiz — ana@example.com' )
		).toBeInTheDocument();
		expect(
			screen.getByText( 'Different: Mailing, Weekly summary opt-out' )
		).toBeInTheDocument();
		expect(
			screen.getByText(
				/1 member opted out in the file but not on this site/,
				{ selector: '.components-notice__content' }
			)
		).toBeInTheDocument();
		expect(
			screen.getByText(
				/Opt-out not transferred \(Weekly summary opt-out\)/
			)
		).toBeInTheDocument();
		expect(
			screen.getByText(
				'email_profile must be minimal, marketing or declined.'
			)
		).toBeInTheDocument();
		expect( screen.getByText( 'Line 4: Li Wei' ) ).toBeInTheDocument();
		expect(
			screen.getByText( /Feed subscriptions were not transferred/, {
				selector: '.components-notice__content',
			} )
		).toBeInTheDocument();

		fireEvent.click( screen.getByText( 'Close', { selector: 'button' } ) );
		expect( onClose ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'does not refresh the list when nothing was added', async () => {
		apiFetch.mockResolvedValue( {
			...RESULT,
			imported: [],
			conflicts: [],
		} );
		const onImported = jest.fn();
		render(
			<ImportAudienceModal
				onClose={ jest.fn() }
				onImported={ onImported }
			/>
		);

		chooseFile();
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Import members' } )
		);

		expect(
			await screen.findByText(
				'The file had 6 rows. Added 0 new members.'
			)
		).toBeInTheDocument();
		expect( onImported ).not.toHaveBeenCalled();
		expect(
			screen.queryByText( /opted out in the file/ )
		).not.toBeInTheDocument();
	} );

	it( 'keeps the form with the server error so the import can be retried', async () => {
		apiFetch.mockRejectedValueOnce( {
			message: 'These columns are not supported: feeds.',
		} );
		render(
			<ImportAudienceModal
				onClose={ jest.fn() }
				onImported={ jest.fn() }
			/>
		);

		chooseFile();
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Import members' } )
		);

		expect(
			await screen.findByText(
				'These columns are not supported: feeds.',
				{
					selector: '.components-notice__content',
				}
			)
		).toBeInTheDocument();
		const retry = screen.getByRole( 'button', { name: 'Import members' } );
		expect( retry ).toBeEnabled();

		apiFetch.mockResolvedValueOnce( RESULT );
		fireEvent.click( retry );
		expect(
			await screen.findByText(
				'The file had 6 rows. Added 1 new member.'
			)
		).toBeInTheDocument();
		expect(
			screen.queryByText( 'These columns are not supported: feeds.', {
				selector: '.components-notice__content',
			} )
		).not.toBeInTheDocument();
	} );
} );

describe( 'AudienceMigrationMenu', () => {
	const openMenu = () =>
		fireEvent.click(
			screen.getByRole( 'button', {
				name: 'Export or import the audience',
			} )
		);

	it( 'downloads the whole audience and reports the count', async () => {
		apiFetch.mockResolvedValue( {
			filename: 'fair-audience-2026-11-11.csv',
			count: 2,
			content: '﻿format_version\r\n',
		} );
		URL.createObjectURL = jest.fn( () => 'blob:audience' );
		URL.revokeObjectURL = jest.fn();
		const click = jest
			.spyOn( window.HTMLAnchorElement.prototype, 'click' )
			.mockImplementation( () => {} );
		const onMessage = jest.fn();
		render(
			<AudienceMigrationMenu
				onMessage={ onMessage }
				onError={ jest.fn() }
				onImported={ jest.fn() }
			/>
		);

		openMenu();
		expect(
			screen.getByText( 'Every participant, whatever the table shows' )
		).toBeInTheDocument();
		await act( async () => {
			fireEvent.click(
				screen.getByRole( 'menuitem', { name: /Export audience CSV/ } )
			);
		} );

		expect( apiFetch ).toHaveBeenCalledWith( {
			path: '/fair-audience/v1/participants/export',
		} );
		expect( click ).toHaveBeenCalledTimes( 1 );
		expect( onMessage ).toHaveBeenCalledWith(
			'Exported 2 audience members.'
		);
		click.mockRestore();
	} );

	it( 'reports a failed export', async () => {
		apiFetch.mockRejectedValue( {} );
		const onError = jest.fn();
		render(
			<AudienceMigrationMenu
				onMessage={ jest.fn() }
				onError={ onError }
				onImported={ jest.fn() }
			/>
		);

		openMenu();
		await act( async () => {
			fireEvent.click(
				screen.getByRole( 'menuitem', { name: /Export audience CSV/ } )
			);
		} );

		expect( onError ).toHaveBeenLastCalledWith(
			'The audience could not be exported. Please try again.'
		);
	} );

	it( 'opens the import popup', () => {
		render(
			<AudienceMigrationMenu
				onMessage={ jest.fn() }
				onError={ jest.fn() }
				onImported={ jest.fn() }
			/>
		);

		openMenu();
		fireEvent.click(
			screen.getByRole( 'menuitem', { name: /Import audience CSV/ } )
		);

		expect(
			screen.getByRole( 'dialog', { name: 'Import audience CSV' } )
		).toBeInTheDocument();
	} );
} );
