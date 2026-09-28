/**
 * @jest-environment jsdom
 *
 * Signup answers in the Event Participants "Questions" column (#1609): each
 * ticket's answers are shown with that ticket, answers not attached to a
 * ticket stay with the participant.
 */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import {
	renderParticipantAnswers,
	countParticipantAnswers,
} from '../EventParticipants.js';

const diet = ( value ) => ( {
	question_key: 'diet',
	question_text: 'Dietary needs?',
	question_type: 'short_text',
	answer_value: value,
} );

describe( 'renderParticipantAnswers', () => {
	it( 'shows each ticket’s answers under that ticket only', () => {
		const item = {
			questionnaire_answers: [],
			tickets: [
				{
					id: 71,
					position: 1,
					reference: 'AE2671B5',
					answers: [ diet( 'Vegan' ) ],
					answers_need_review: false,
				},
				{
					id: 72,
					position: 2,
					reference: 'C0FFEE12',
					answers: [],
					answers_need_review: false,
				},
			],
		};
		render( renderParticipantAnswers( item ) );

		expect( screen.getByText( 'Ticket 1 (AE2671B5)' ) ).toBeVisible();
		expect( screen.queryByText( 'Ticket 2 (C0FFEE12)' ) ).toBeNull();
		expect( screen.getAllByText( 'Vegan' ) ).toHaveLength( 1 );
		expect(
			screen.queryByText( 'Check which ticket these belong to' )
		).toBeNull();
		expect( countParticipantAnswers( item ) ).toBe( 1 );
	} );

	it( 'keeps answers without a ticket with the participant and flags a review', () => {
		const item = {
			questionnaire_answers: [ diet( 'Vegetarian' ) ],
			questionnaire_answers_need_review: true,
			tickets: [],
		};
		render( renderParticipantAnswers( item ) );

		expect( screen.getByText( 'Vegetarian' ) ).toBeVisible();
		expect(
			screen.getByText( 'Check which ticket these belong to' )
		).toBeVisible();
	} );

	it( 'renders nothing when there are no answers', () => {
		expect(
			renderParticipantAnswers( {
				questionnaire_answers: [],
				tickets: [
					{ id: 1, position: 1, reference: 'X', answers: [] },
				],
			} )
		).toBeNull();
	} );
} );
