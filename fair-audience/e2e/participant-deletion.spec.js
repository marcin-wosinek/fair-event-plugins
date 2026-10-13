/**
 * E2E: deleting participant profiles from the All Participants list and
 * from a participant's own page goes through the same popup (#1775). It
 * names who is deleted, cancelling changes nothing, a profile whose deletion
 * failed stays selected for a retry, and the participant page returns to
 * the list once its profile is gone.
 */

import { test, expect } from '@playwright/test';

const WP_ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const WP_ADMIN_PASS = process.env.WP_ADMIN_PASS || 'password';

async function apiFetch( page, options ) {
	const result = await page.evaluate( async ( opts ) => {
		try {
			// eslint-disable-next-line no-undef
			const data = await wp.apiFetch( opts );
			return { ok: true, data };
		} catch ( error ) {
			return { ok: false, error: { code: error?.code } };
		}
	}, options );

	if ( ! result.ok ) {
		throw new Error(
			`apiFetch ${ options.method || 'GET' } ${
				options.path
			} failed: ${ JSON.stringify( result.error ) }`
		);
	}

	return result.data;
}

async function login( page ) {
	await page.goto( '/wp-admin' );
	if ( page.url().includes( 'wp-login.php' ) ) {
		await page.fill( '#user_login', WP_ADMIN_USER );
		await page.fill( '#user_pass', WP_ADMIN_PASS );
		await page.click( '#wp-submit' );
	}
	await page.waitForSelector( '#wpadminbar' );
}

// apiFetch sends DELETE as POST with an X-HTTP-Method-Override header.
const deletedParticipantId = ( request ) => {
	const match = decodeURIComponent( request.url() ).match(
		/\/fair-audience\/v1\/participants\/(\d+)(?:[?&]|$)/
	);
	const isDelete =
		request.method() === 'DELETE' ||
		request.headers()[ 'x-http-method-override' ] === 'DELETE';
	return match && isDelete ? Number( match[ 1 ] ) : null;
};

test.describe( 'Fair Audience — delete participant profiles', () => {
	test.setTimeout( 90_000 );

	let adminContext;
	let adminPage;
	const stamp = Date.now();
	const surname = `Deletion${ stamp }`;
	// Two people share a name: the popup tells them apart by email.
	const people = [
		{ name: 'Twin', email: `twin-a-${ stamp }@example.test` },
		{ name: 'Twin', email: `twin-b-${ stamp }@example.test` },
		{ name: 'Solo', email: `solo-${ stamp }@example.test` },
		{ name: 'Detail', email: `detail-${ stamp }@example.test` },
	];
	const ids = [];

	const exists = async ( id ) =>
		adminPage.evaluate( async ( participantId ) => {
			try {
				// eslint-disable-next-line no-undef
				await wp.apiFetch( {
					path: `/fair-audience/v1/participants/${ participantId }`,
				} );
				return true;
			} catch ( error ) {
				return false;
			}
		}, id );

	test.beforeAll( async ( { browser } ) => {
		adminContext = await browser.newContext();
		adminPage = await adminContext.newPage();
		await login( adminPage );
		await adminPage.goto( '/wp-admin/admin.php?page=fair-audience' );
		await adminPage.waitForFunction(
			() => window.wp && window.wp.apiFetch
		);

		for ( const person of people ) {
			const participant = await apiFetch( adminPage, {
				path: '/fair-audience/v1/participants',
				method: 'POST',
				data: { ...person, surname },
			} );
			ids.push( participant.id );
		}
	} );

	test.afterAll( async () => {
		for ( const id of ids ) {
			await apiFetch( adminPage, {
				path: `/fair-audience/v1/participants/${ id }`,
				method: 'DELETE',
			} ).catch( () => {} );
		}
		await adminContext?.close();
	} );

	const rows = () =>
		adminPage.locator( '.dataviews-view-table tbody tr', {
			hasText: surname,
		} );

	const openList = async () => {
		await adminPage.goto( '/wp-admin/admin.php?page=fair-audience' );
		await adminPage.getByRole( 'searchbox' ).fill( surname );
		await expect( rows().first() ).toBeVisible();
	};

	const openBulkDelete = async ( names ) => {
		for ( const name of names ) {
			const matching = rows().filter( {
				hasText: `${ name } ${ surname }`,
			} );
			const count = await matching.count();
			for ( let i = 0; i < count; i++ ) {
				await matching
					.nth( i )
					.locator( '.dataviews-selection-checkbox input' )
					.check( { force: true } );
			}
		}
		await adminPage
			.locator( '.dataviews-bulk-actions-footer__container' )
			.getByRole( 'button', { name: 'Delete' } )
			.click();
		const dialog = adminPage.getByRole( 'dialog', {
			name: 'Delete participant profiles',
		} );
		await expect( dialog ).toBeVisible();
		return dialog;
	};

	test( 'lists who is selected, and cancelling deletes no one', async () => {
		await openList();
		await expect( rows() ).toHaveCount( 4 );

		const dialog = await openBulkDelete( [ 'Twin', 'Solo' ] );
		await expect( dialog ).toContainText(
			'Permanently delete the profiles of 3 participants?'
		);
		const list = dialog.getByRole( 'list', {
			name: 'Participants to delete',
		} );
		await expect( list.getByRole( 'listitem' ) ).toHaveCount( 3 );
		await expect( list ).toContainText(
			`Twin ${ surname } (${ people[ 0 ].email })`
		);
		await expect( list ).toContainText(
			`Twin ${ surname } (${ people[ 1 ].email })`
		);
		// A name that is unique in the selection stands alone.
		await expect( list ).not.toContainText( people[ 2 ].email );
		await expect( dialog ).toContainText(
			'Deleting a profile does not cancel tickets, delete event registrations or refund payments.'
		);

		let requested = false;
		const watch = ( request ) => {
			requested = requested || deletedParticipantId( request ) !== null;
		};
		adminPage.on( 'request', watch );
		await dialog.getByRole( 'button', { name: 'Cancel' } ).click();
		await expect( dialog ).toBeHidden();
		adminPage.off( 'request', watch );

		expect( requested ).toBe( false );
		await openList();
		await expect( rows() ).toHaveCount( 4 );
	} );

	test( 'keeps the profile whose deletion failed, and deletes it on retry', async () => {
		await openList();
		const dialog = await openBulkDelete( [ 'Twin', 'Solo' ] );

		const soloId = ids[ 2 ];
		const fail = async ( route ) => {
			if ( deletedParticipantId( route.request() ) !== soloId ) {
				return route.fallback();
			}
			return route.fulfill( {
				status: 500,
				contentType: 'application/json',
				body: JSON.stringify( {
					code: 'deletion_failed',
					message: 'Failed to delete participant.',
					data: { status: 500 },
				} ),
			} );
		};
		await adminPage.route( '**/*', fail );
		await dialog
			.getByRole( 'button', { name: 'Delete 3 participants' } )
			.click();

		await expect( dialog ).toContainText(
			'2 participant profiles were deleted.'
		);
		await expect( dialog ).toContainText(
			'1 participant profile could not be deleted and was kept. Try again:'
		);
		const failed = dialog.getByRole( 'list', {
			name: 'Profiles that could not be deleted',
		} );
		await expect( failed ).toContainText( `Solo ${ surname }` );
		await expect( failed ).toContainText( 'Failed to delete participant.' );
		await adminPage.unroute( '**/*', fail );

		// The list behind the popup already lost the two deleted profiles.
		await expect( rows() ).toHaveCount( 2 );
		expect( await exists( ids[ 0 ] ) ).toBe( false );
		expect( await exists( ids[ 1 ] ) ).toBe( false );
		expect( await exists( soloId ) ).toBe( true );

		await dialog
			.getByRole( 'button', { name: 'Delete 1 participant' } )
			.click();
		await expect( dialog ).toBeHidden();
		await expect(
			adminPage.getByText( '1 participant profile deleted.' ).first()
		).toBeVisible();
		await expect( rows() ).toHaveCount( 1 );
		expect( await exists( soloId ) ).toBe( false );
	} );

	test( 'shows the popup and its actions on a phone', async () => {
		const participant = await apiFetch( adminPage, {
			path: '/fair-audience/v1/participants',
			method: 'POST',
			data: {
				name: 'Phone',
				// Long enough to wrap: the popup must not overflow.
				surname: `${ surname } Wolfeschlegelsteinhausenbergerdorff`,
				email: `phone-${ stamp }@example.test`,
			},
		} );
		ids.push( participant.id );

		await adminPage.setViewportSize( { width: 375, height: 812 } );
		try {
			await adminPage.goto(
				`/wp-admin/admin.php?page=fair-audience-participant-detail&participant_id=${ participant.id }`
			);
			await adminPage
				.getByRole( 'button', { name: 'Delete participant' } )
				.click();
			const dialog = adminPage.getByRole( 'dialog' );
			await expect( dialog ).toBeVisible();
			const confirm = dialog.getByRole( 'button', {
				name: 'Delete participant',
			} );
			await confirm.scrollIntoViewIfNeeded();
			await expect( confirm ).toBeInViewport();
			await expect(
				dialog.getByRole( 'button', { name: 'Cancel' } )
			).toBeInViewport();
			// Nothing sticks out sideways: the popup is as wide as the screen.
			expect(
				await dialog.evaluate( ( node ) =>
					[ node, ...node.querySelectorAll( '*' ) ].every(
						( element ) =>
							element.getBoundingClientRect().right <=
							window.innerWidth + 1
					)
				)
			).toBe( true );
			await dialog.getByRole( 'button', { name: 'Cancel' } ).click();
			await expect( dialog ).toBeHidden();
		} finally {
			await adminPage.setViewportSize( { width: 1280, height: 720 } );
		}
	} );

	// Last: the page it leaves behind was reached by a script redirect, which
	// stalls rendering in headless runs.
	test( 'asks the same way on the participant page, and returns to the list', async () => {
		const detailId = ids[ 3 ];
		const fullName = `Detail ${ surname }`;
		let nativeDialogs = 0;
		const countDialog = ( nativeDialog ) => {
			nativeDialogs++;
			nativeDialog.dismiss();
		};
		adminPage.on( 'dialog', countDialog );

		await adminPage.goto(
			`/wp-admin/admin.php?page=fair-audience-participant-detail&participant_id=${ detailId }`
		);
		await adminPage
			.getByRole( 'button', { name: 'Delete participant' } )
			.click();
		const dialog = adminPage.getByRole( 'dialog', {
			name: `Delete participant — ${ fullName }`,
		} );
		await expect( dialog ).toBeVisible();
		expect( nativeDialogs ).toBe( 0 );
		await expect( dialog ).toContainText(
			`Permanently delete the participant profile of ${ fullName }?`
		);

		// Focus starts inside the popup, and Escape keeps the profile.
		expect(
			await dialog.evaluate( ( node ) =>
				node.contains( document.activeElement )
			)
		).toBe( true );
		await adminPage.keyboard.press( 'Escape' );
		await expect( dialog ).toBeHidden();
		expect( await exists( detailId ) ).toBe( true );

		await adminPage
			.getByRole( 'button', { name: 'Delete participant' } )
			.click();
		await dialog
			.getByRole( 'button', { name: 'Delete participant' } )
			.click();

		await adminPage.waitForURL( /page=fair-audience(?:&|$)/ );
		await expect(
			adminPage.getByRole( 'heading', { name: 'All Participants' } )
		).toBeVisible();
		adminPage.off( 'dialog', countDialog );
		expect( await exists( detailId ) ).toBe( false );
	} );
} );
