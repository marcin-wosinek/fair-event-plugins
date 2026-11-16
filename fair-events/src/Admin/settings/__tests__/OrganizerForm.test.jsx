/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { useState } from '@wordpress/element';
import OrganizerForm, { EMPTY_ORGANIZER } from '../OrganizerForm.js';
import { loadAttachmentUrl } from '../settings-api.js';

jest.mock( '../settings-api.js' );

beforeEach( () => {
	loadAttachmentUrl.mockResolvedValue( '' );
} );

afterEach( () => {
	jest.clearAllMocks();
} );

function Harness( { initial = {}, onSubmit = jest.fn(), ...props } ) {
	const [ organizer, setOrganizer ] = useState( {
		...EMPTY_ORGANIZER,
		...initial,
	} );
	return (
		<OrganizerForm
			organizer={ organizer }
			onChange={ setOrganizer }
			onSubmit={ onSubmit }
			isSaving={ false }
			{ ...props }
		/>
	);
}

// Render and let the logo preview request settle inside act().
async function renderForm( ui ) {
	render( ui );
	await act( async () => {} );
}

const saveButton = () =>
	screen.getByRole( 'button', { name: /Save organizer/i } );

test( 'a required blank name blocks saving and says why', async () => {
	const onSubmit = jest.fn();
	await renderForm( <Harness requireName onSubmit={ onSubmit } /> );

	expect( screen.getByLabelText( 'Name (required)' ) ).toBeInTheDocument();
	expect( saveButton() ).toBeDisabled();
	expect(
		screen.getByText( 'Enter a name before saving.' )
	).toBeInTheDocument();

	fireEvent.change( screen.getByLabelText( 'Name (required)' ), {
		target: { value: '   ' },
	} );
	expect( saveButton() ).toBeDisabled();

	fireEvent.change( screen.getByLabelText( 'Name (required)' ), {
		target: { value: 'North Club' },
	} );
	expect( saveButton() ).toBeEnabled();
	fireEvent.click( saveButton() );
	expect( onSubmit ).toHaveBeenCalledTimes( 1 );
} );

test( 'without site defaults blank fields show no fallback', async () => {
	await renderForm(
		<Harness
			defaults={ null }
			intro={ <p>Additional organizer intro</p> }
		/>
	);

	expect( screen.getByText( 'Additional organizer intro' ) ).toBeVisible();
	expect( screen.getByLabelText( 'Name' ) ).toHaveAttribute(
		'placeholder',
		''
	);
	expect( screen.getByLabelText( 'Website' ) ).toHaveAttribute(
		'placeholder',
		''
	);
	expect(
		screen.queryByText(
			"Falls back to the site's logo when not overridden."
		)
	).not.toBeInTheDocument();
	expect( loadAttachmentUrl ).toHaveBeenCalledWith( 0 );
} );

test( 'without site defaults removing the logo says it leaves none', async () => {
	await renderForm(
		<Harness defaults={ null } initial={ { logo_id: 5 } } />
	);

	fireEvent.click( screen.getByRole( 'button', { name: 'Remove' } ) );

	expect(
		screen.getByText(
			'The organizer will have no logo. The image you remove here stays in the Media Library.'
		)
	).toBeInTheDocument();
} );

test( 'with site defaults the sitewide fallbacks are kept', async () => {
	await renderForm(
		<Harness
			defaults={ {
				name: 'Test Site',
				website: 'https://example.com',
				logoId: 3,
			} }
		/>
	);

	expect( screen.getByLabelText( 'Name' ) ).toHaveAttribute(
		'placeholder',
		'Test Site'
	);
	expect(
		screen.getByText( "Falls back to the site's logo when not overridden." )
	).toBeInTheDocument();
	expect( loadAttachmentUrl ).toHaveBeenCalledWith( 3 );
	expect( saveButton() ).toBeEnabled();
} );
