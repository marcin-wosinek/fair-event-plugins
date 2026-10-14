/**
 * @jest-environment jsdom
 *
 * Submission identity shown in the delete and edit dialogs (#1774): each
 * value has a visible fallback, and the ID is always present so repeated
 * submissions with identical timestamps stay distinguishable.
 */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import SubmissionContext, { describeSubmission } from '../SubmissionContext.js';

describe( 'describeSubmission', () => {
	it( 'uses the participant name, stored form title, formatted date, and ID', () => {
		expect(
			describeSubmission( {
				id: 74,
				participant_name: 'Alex Demo',
				participant_email: 'alex@example.test',
				form_title: 'Workshop feedback',
				created_at: '2026-10-14 04:11:53',
			} )
		).toEqual( {
			respondent: 'Alex Demo',
			form: 'Workshop feedback',
			date: new Date( '2026-10-14 04:11:53Z' ).toLocaleString(),
			id: '#74',
		} );
	} );

	it( 'falls back to the email when there is no name', () => {
		expect(
			describeSubmission( {
				id: 1,
				participant_name: '',
				participant_email: 'alex@example.test',
			} ).respondent
		).toBe( 'alex@example.test' );
	} );

	it( 'labels anonymous, untitled, and undated submissions', () => {
		expect(
			describeSubmission( {
				id: 5,
				participant_name: '',
				participant_email: '',
				form_title: '',
				created_at: null,
			} )
		).toEqual( {
			respondent: 'Anonymous respondent',
			form: 'Untitled form',
			date: 'Unknown date',
			id: '#5',
		} );
	} );

	it( 'treats an unparseable date as unknown', () => {
		expect(
			describeSubmission( { id: 6, created_at: 'garbage' } ).date
		).toBe( 'Unknown date' );
	} );
} );

describe( 'SubmissionContext', () => {
	it( 'renders every label with its value', () => {
		render(
			<SubmissionContext
				submission={ {
					id: 9,
					participant_name: '',
					participant_email: '',
					form_title: 'Workshop feedback',
					created_at: '',
				} }
			/>
		);

		expect( screen.getByText( 'Respondent' ) ).toBeInTheDocument();
		expect(
			screen.getByText( 'Anonymous respondent' )
		).toBeInTheDocument();
		expect( screen.getByText( 'Workshop feedback' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Unknown date' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Submission ID' ) ).toBeInTheDocument();
		expect( screen.getByText( '#9' ) ).toBeInTheDocument();
	} );
} );
