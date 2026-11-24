/**
 * @jest-environment jsdom
 *
 * Tests for the Team members directory page (#2394): the list, the
 * required name, server-side field errors that keep what was typed,
 * clearing optional fields, deletion blocked while the profile is on an
 * event's team, and the promotional website, bio and Media Library
 * portrait (#2421).
 */
import '@testing-library/jest-dom';
import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from '@testing-library/react';
import TeamMembersPage from '../TeamMembersPage.js';
import {
	createTeamMember,
	deleteTeamMember,
	loadAttachmentUrl,
	loadTeamMember,
	loadTeamMembers,
	updateTeamMember,
} from '../team-members-api.js';

jest.mock( '../team-members-api.js' );

const NOTICE = { selector: '.components-notice__content' };

const profile = ( overrides = {} ) => ( {
	id: 1,
	name: 'Ana',
	surname: 'Ruiz',
	instagram: '',
	email: 'ana@example.com',
	facebook_url: '',
	phone: '+34 600 000 001',
	website_url: '',
	bio: '',
	portrait_attachment_id: null,
	gender: null,
	event_count: 0,
	...overrides,
} );

/** Open a member's overflow menu and choose one of its items. */
async function chooseMenuItem( member, item ) {
	const toggle = screen.getByRole( 'button', {
		name: `More actions for “${ member }”`,
	} );
	act( () => toggle.focus() );
	fireEvent.click( toggle );
	const menu = await screen.findByRole( 'menu', {
		name: `More actions for “${ member }”`,
	} );
	await act( async () =>
		fireEvent.click(
			within( menu ).getByRole( 'menuitem', { name: item } )
		)
	);
}

/** Stand-in for `wp.media` that selects `attachment` when opened. */
function mockMediaLibrary( attachment ) {
	const frame = {
		handlers: {},
		on( event, handler ) {
			this.handlers[ event ] = handler;
		},
		open: jest.fn( function () {
			this.handlers.select();
		} ),
		state: () => ( {
			get: () => ( { first: () => ( { toJSON: () => attachment } ) } ),
		} ),
	};
	window.wp = { media: jest.fn( () => frame ) };
	return frame;
}

/** Open the editor of Ana Ruiz once her profile has loaded. */
async function editAna() {
	fireEvent.click(
		await screen.findByRole( 'button', { name: 'Edit “Ana Ruiz”' } )
	);
	await screen.findByText( 'Not on any event’s team yet.', {
		exact: false,
	} );
}

const saveMember = () =>
	act( async () =>
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Save team member' } )
		)
	);

afterEach( () => {
	delete window.wp;
} );

beforeEach( () => {
	jest.resetAllMocks();
	loadAttachmentUrl.mockResolvedValue( null );
	loadTeamMembers.mockResolvedValue( [
		profile(),
		profile( {
			id: 2,
			name: 'Marek',
			surname: 'Nowak',
			email: '',
			event_count: 2,
		} ),
	] );
} );

describe( 'TeamMembersPage', () => {
	it( 'lists the directory with phone numbers and event counts', async () => {
		render( <TeamMembersPage /> );

		const ana = (
			await screen.findByRole( 'link', { name: 'Ana Ruiz' } )
		).closest( 'tr' );
		expect( within( ana ).getByText( '+34 600 000 001' ) ).toBeVisible();
		expect( within( ana ).getByText( 'None' ) ).toBeVisible();
		const marek = screen
			.getByRole( 'link', { name: 'Marek Nowak' } )
			.closest( 'tr' );
		expect( within( marek ).getByText( '2 events' ) ).toBeVisible();
	} );

	it( 'requires a name and keeps typed values when the server rejects fields', async () => {
		createTeamMember.mockRejectedValue( {
			code: 'rest_invalid_param',
			message: 'Invalid parameter(s): email, facebook_url',
			data: {
				status: 400,
				params: {
					email: 'Enter a valid email address.',
					facebook_url:
						'Enter the full address of a Facebook profile.',
				},
			},
		} );
		render( <TeamMembersPage /> );

		fireEvent.click(
			await screen.findByRole( 'button', { name: 'Add team member' } )
		);
		const save = screen.getByRole( 'button', { name: 'Add team member' } );
		expect( save ).toHaveAttribute( 'aria-disabled', 'true' );
		expect( screen.getByText( 'Enter a name to save.' ) ).toBeVisible();

		fireEvent.change( screen.getByLabelText( 'Name (required)' ), {
			target: { value: 'Sam' },
		} );
		fireEvent.change( screen.getByLabelText( 'Email address' ), {
			target: { value: 'not-an-email' },
		} );
		fireEvent.change( screen.getByLabelText( 'Facebook profile' ), {
			target: { value: 'https://example.com/sam' },
		} );
		await act( async () => fireEvent.click( save ) );

		expect(
			await screen.findByText(
				'The team member was not saved. Correct the highlighted fields and try again.',
				NOTICE
			)
		).toBeVisible();
		expect(
			screen.getByText( 'Enter a valid email address.' )
		).toBeVisible();
		expect(
			screen.getByText( 'Enter the full address of a Facebook profile.' )
		).toBeVisible();
		expect( screen.getByLabelText( 'Email address' ) ).toHaveValue(
			'not-an-email'
		);
		expect( createTeamMember ).toHaveBeenCalledWith(
			expect.objectContaining( {
				name: 'Sam',
				email: 'not-an-email',
				gender: null,
			} )
		);
	} );

	it( 'clears optional fields when editing a profile', async () => {
		loadTeamMember.mockResolvedValue( { ...profile(), events: [] } );
		updateTeamMember.mockImplementation( ( id, data ) =>
			Promise.resolve( { ...profile(), ...data, events: [] } )
		);
		render( <TeamMembersPage /> );

		fireEvent.click(
			await screen.findByRole( 'button', { name: 'Edit “Ana Ruiz”' } )
		);
		await screen.findByText( 'Not on any event’s team yet.', {
			exact: false,
		} );
		fireEvent.change( screen.getByLabelText( 'Email address' ), {
			target: { value: '' },
		} );
		fireEvent.change( screen.getByLabelText( 'Grammatical gender' ), {
			target: { value: 'female' },
		} );
		await act( async () =>
			fireEvent.click(
				screen.getByRole( 'button', { name: 'Save team member' } )
			)
		);

		expect( updateTeamMember ).toHaveBeenCalledWith(
			1,
			expect.objectContaining( { email: '', gender: 'female' } )
		);
		expect(
			await screen.findByText(
				'Team member saved. Every event they are on shows the new details.',
				NOTICE
			)
		).toBeVisible();
	} );

	it( 'blocks deletion while the profile is on event teams and names those events', async () => {
		loadTeamMember.mockResolvedValue( {
			...profile( { id: 2, name: 'Marek', surname: 'Nowak' } ),
			events: [
				{
					event_date_id: 7,
					title: 'Rock &amp; Roll night',
					start_date: '2035-09-03',
					is_series: false,
				},
				{
					event_date_id: 9,
					title: 'Weekly class',
					start_date: '2035-09-10',
					is_series: true,
				},
			],
		} );
		render( <TeamMembersPage /> );
		await screen.findByRole( 'link', { name: 'Marek Nowak' } );

		await chooseMenuItem( 'Marek Nowak', 'Delete' );

		const dialog = await screen.findByRole( 'dialog', {
			name: 'Delete team member — Marek Nowak',
		} );
		expect(
			await within( dialog ).findByRole( 'link', {
				name: 'Rock & Roll night',
			} )
		).toBeVisible();
		expect(
			within( dialog ).getByText( '— series from 2035-09-10', {
				exact: false,
			} )
		).toBeVisible();
		expect(
			within( dialog ).getByText(
				'Marek Nowak is on the team of 2 events.',
				{ exact: false }
			)
		).toBeVisible();
		const confirm = within( dialog ).getByRole( 'button', {
			name: 'Delete team member',
		} );
		expect( confirm ).toBeDisabled();
		expect( deleteTeamMember ).not.toHaveBeenCalled();
	} );

	it( 'shows the events when the profile was linked meanwhile', async () => {
		deleteTeamMember.mockRejectedValue( {
			code: 'rest_team_member_linked',
			message: 'This team member is still linked to 1 event.',
			data: {
				status: 409,
				events: [
					{
						event_date_id: 7,
						title: 'Winter social',
						start_date: '2035-12-12',
						is_series: false,
					},
				],
			},
		} );
		render( <TeamMembersPage /> );
		await screen.findByRole( 'link', { name: 'Ana Ruiz' } );

		await chooseMenuItem( 'Ana Ruiz', 'Delete' );
		const dialog = await screen.findByRole( 'dialog', {
			name: 'Delete team member — Ana Ruiz',
		} );
		await act( async () =>
			fireEvent.click(
				within( dialog ).getByRole( 'button', {
					name: 'Delete team member',
				} )
			)
		);

		expect(
			await within( dialog ).findByRole( 'link', {
				name: 'Winter social',
			} )
		).toBeVisible();
		expect(
			within( dialog ).getByRole( 'button', {
				name: 'Delete team member',
			} )
		).toBeDisabled();
		// The profile stays listed behind the dialog.
		expect(
			screen.getByRole( 'link', { name: 'Ana Ruiz', hidden: true } )
		).toBeInTheDocument();
	} );

	it( 'deletes an unlinked profile', async () => {
		deleteTeamMember.mockResolvedValue( { deleted: true, id: 1 } );
		render( <TeamMembersPage /> );
		await screen.findByRole( 'link', { name: 'Ana Ruiz' } );

		await chooseMenuItem( 'Ana Ruiz', 'Delete' );
		const dialog = await screen.findByRole( 'dialog', {
			name: 'Delete team member — Ana Ruiz',
		} );
		expect(
			within( dialog ).getByText( 'This cannot be undone.', {
				exact: false,
			} )
		).toBeVisible();
		await act( async () =>
			fireEvent.click(
				within( dialog ).getByRole( 'button', {
					name: 'Delete team member',
				} )
			)
		);

		await waitFor( () =>
			expect(
				screen.queryByRole( 'link', { name: 'Ana Ruiz' } )
			).not.toBeInTheDocument()
		);
		expect(
			screen.getByText(
				'Ana Ruiz was deleted from the directory.',
				NOTICE
			)
		).toBeVisible();
		expect( deleteTeamMember ).toHaveBeenCalledWith( 1 );
	} );

	it( 'saves a website and a bio with its line breaks', async () => {
		loadTeamMember.mockResolvedValue( { ...profile(), events: [] } );
		updateTeamMember.mockImplementation( ( id, data ) =>
			Promise.resolve( { ...profile(), ...data, events: [] } )
		);
		render( <TeamMembersPage /> );
		await editAna();

		fireEvent.change( screen.getByLabelText( 'Website' ), {
			target: { value: 'https://ana.example.com' },
		} );
		fireEvent.change( screen.getByLabelText( 'Bio' ), {
			target: { value: 'Teacher.\nDancer.' },
		} );
		await saveMember();

		expect( updateTeamMember ).toHaveBeenCalledWith(
			1,
			expect.objectContaining( {
				website_url: 'https://ana.example.com',
				bio: 'Teacher.\nDancer.',
				portrait_attachment_id: null,
			} )
		);
	} );

	it( 'chooses a portrait from the Media Library and shows its preview', async () => {
		loadTeamMember.mockResolvedValue( { ...profile(), events: [] } );
		updateTeamMember.mockImplementation( ( id, data ) =>
			Promise.resolve( { ...profile(), ...data, events: [] } )
		);
		const frame = mockMediaLibrary( {
			id: 52,
			url: 'https://example.test/ana.jpg',
		} );
		render( <TeamMembersPage /> );
		await editAna();

		await act( async () =>
			fireEvent.click(
				screen.getByRole( 'button', { name: 'Choose portrait' } )
			)
		);

		expect( window.wp.media ).toHaveBeenCalledWith(
			expect.objectContaining( {
				library: { type: 'image' },
				multiple: false,
			} )
		);
		expect( frame.open ).toHaveBeenCalled();
		expect(
			screen.getByRole( 'img', { name: 'Portrait preview' } )
		).toHaveAttribute( 'src', 'https://example.test/ana.jpg' );
		expect(
			screen.getByRole( 'button', { name: 'Replace portrait' } )
		).toBeVisible();
		await saveMember();

		expect( updateTeamMember ).toHaveBeenCalledWith(
			1,
			expect.objectContaining( { portrait_attachment_id: 52 } )
		);
	} );

	it( 'removes a portrait by saving it as cleared', async () => {
		loadTeamMembers.mockResolvedValue( [
			profile( { portrait_attachment_id: 52 } ),
		] );
		loadTeamMember.mockResolvedValue( {
			...profile( { portrait_attachment_id: 52 } ),
			events: [],
		} );
		loadAttachmentUrl.mockResolvedValue( 'https://example.test/ana.jpg' );
		updateTeamMember.mockImplementation( ( id, data ) =>
			Promise.resolve( { ...profile(), ...data, events: [] } )
		);
		render( <TeamMembersPage /> );
		await editAna();

		expect(
			await screen.findByRole( 'img', { name: 'Portrait preview' } )
		).toHaveAttribute( 'src', 'https://example.test/ana.jpg' );
		expect( loadAttachmentUrl ).toHaveBeenCalledWith( 52 );
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Remove portrait' } )
		);

		expect(
			screen.queryByRole( 'img', { name: 'Portrait preview' } )
		).not.toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: 'Choose portrait' } )
		).toBeVisible();
		await saveMember();

		expect( updateTeamMember ).toHaveBeenCalledWith(
			1,
			expect.objectContaining( { portrait_attachment_id: null } )
		);
	} );

	it( 'explains a portrait that is no longer in the Media Library', async () => {
		loadTeamMembers.mockResolvedValue( [
			profile( { portrait_attachment_id: 77 } ),
		] );
		loadTeamMember.mockResolvedValue( {
			...profile( { portrait_attachment_id: 77 } ),
			events: [],
		} );
		render( <TeamMembersPage /> );
		await editAna();

		expect(
			await screen.findByText(
				'This image is no longer available in the Media Library',
				{ exact: false }
			)
		).toBeVisible();
		expect(
			screen.queryByRole( 'img', { name: 'Portrait preview' } )
		).not.toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: 'Remove portrait' } )
		).toBeVisible();
	} );
} );
