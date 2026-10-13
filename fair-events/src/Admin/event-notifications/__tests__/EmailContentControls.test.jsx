/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from '@wordpress/element';
import EmailContentControls from '../EmailContentControls.js';

const VALUES = {
	skip_empty: true,
	subject: 'This week: {week_start}',
	intro: 'Hello',
	outro: 'Bye',
};

/**
 * A consumer holding its own state, the way each email channel does.
 *
 * @param {Object} props
 * @param {string} props.name    Region name.
 * @param {Object} props.initial Initial values.
 * @return {JSX.Element} The consumer.
 */
function Consumer( { name, initial } ) {
	const [ values, setValues ] = useState( initial );
	return (
		<section aria-label={ name }>
			<EmailContentControls
				values={ values }
				onChange={ ( field, value ) =>
					setValues( ( current ) => ( {
						...current,
						[ field ]: value,
					} ) )
				}
			/>
			<output>{ JSON.stringify( values ) }</output>
		</section>
	);
}

describe( 'EmailContentControls', () => {
	it( 'shows the values it is given', () => {
		render(
			<EmailContentControls values={ VALUES } onChange={ () => {} } />
		);

		expect(
			screen.getByLabelText(
				'Skip the email when the week has no events'
			)
		).toBeChecked();
		expect( screen.getByLabelText( 'Subject' ) ).toHaveValue(
			'This week: {week_start}'
		);
		expect(
			screen.getByLabelText( 'Text above the list of events' )
		).toHaveValue( 'Hello' );
		expect(
			screen.getByLabelText( 'Text below the list of events' )
		).toHaveValue( 'Bye' );
		// The placeholders are documented next to the subject.
		expect(
			screen.getByText(
				'Use {week_start} and {week_end} to insert the week’s dates.'
			)
		).toBeInTheDocument();
	} );

	it( 'reports each change with its field name and keeps no state', () => {
		const onChange = jest.fn();
		render(
			<EmailContentControls values={ VALUES } onChange={ onChange } />
		);

		fireEvent.change( screen.getByLabelText( 'Subject' ), {
			target: { value: 'New subject' },
		} );
		fireEvent.change(
			screen.getByLabelText( 'Text above the list of events' ),
			{ target: { value: 'Intro' } }
		);
		fireEvent.change(
			screen.getByLabelText( 'Text below the list of events' ),
			{ target: { value: 'Outro' } }
		);
		fireEvent.click(
			screen.getByLabelText(
				'Skip the email when the week has no events'
			)
		);

		expect( onChange.mock.calls ).toEqual( [
			[ 'subject', 'New subject' ],
			[ 'intro', 'Intro' ],
			[ 'outro', 'Outro' ],
			[ 'skip_empty', false ],
		] );
		// Controlled: without new values from the parent nothing changes.
		expect( screen.getByLabelText( 'Subject' ) ).toHaveValue(
			'This week: {week_start}'
		);
	} );

	it( 'keeps two consumers independent', () => {
		render(
			<>
				<Consumer name="Bulk" initial={ VALUES } />
				<Consumer
					name="Individual"
					initial={ { ...VALUES, subject: 'Organizer update' } }
				/>
			</>
		);

		const bulk = within( screen.getByRole( 'region', { name: 'Bulk' } ) );
		const individual = within(
			screen.getByRole( 'region', { name: 'Individual' } )
		);
		fireEvent.change( individual.getByLabelText( 'Subject' ), {
			target: { value: 'Changed' },
		} );
		fireEvent.click(
			individual.getByLabelText(
				'Skip the email when the week has no events'
			)
		);

		expect( individual.getByLabelText( 'Subject' ) ).toHaveValue(
			'Changed'
		);
		expect(
			individual.getByLabelText(
				'Skip the email when the week has no events'
			)
		).not.toBeChecked();
		expect( bulk.getByLabelText( 'Subject' ) ).toHaveValue(
			'This week: {week_start}'
		);
		expect(
			bulk.getByLabelText( 'Skip the email when the week has no events' )
		).toBeChecked();
	} );
} );
