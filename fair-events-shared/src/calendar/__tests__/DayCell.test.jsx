/**
 * @jest-environment jsdom
 *
 * Tests for the shared DayCell: mobile agenda support (#1168), untitled
 * events, link destinations and icons, and optional creation controls.
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import DayCell from '../DayCell.js';
import { labels } from './labels.js';

const MANAGE = '/wp-admin/admin.php?page=fair-events-manage-event';

function makeEvents( count ) {
	return Array.from( { length: count }, ( _, index ) => ( {
		uid: `standalone_${ index }@example.com`,
		title: `Event ${ index + 1 }`,
	} ) );
}

function renderCell( props = {} ) {
	return render(
		<DayCell
			date={ new Date( 2026, 6, 15 ) }
			events={ [] }
			isCurrentMonth
			isToday={ false }
			isPast={ false }
			labels={ labels }
			{ ...props }
		/>
	);
}

it( 'adds a localized data-month-name attribute to the day number', () => {
	const { container } = renderCell();

	const dayNumber = container.querySelector(
		'.fair-events-calendar-day-number'
	);
	expect( dayNumber ).toHaveAttribute(
		'data-month-name',
		new Date( 2026, 6, 15 ).toLocaleDateString( undefined, {
			month: 'long',
		} )
	);
} );

it( 'renders every event row in the DOM, not just the first three', () => {
	renderCell( { events: makeEvents( 5 ) } );

	for ( let i = 1; i <= 5; i++ ) {
		expect( screen.getByText( `Event ${ i }` ) ).toBeInTheDocument();
	}
} );

it( 'shows a "+N more" label counting events beyond the first three', () => {
	renderCell( { events: makeEvents( 5 ) } );

	expect( screen.getByText( '+2 more' ) ).toBeInTheDocument();
} );

it( 'omits the "+N more" label when there are three events or fewer', () => {
	renderCell( { events: makeEvents( 3 ) } );

	expect( screen.queryByText( /more$/ ) ).not.toBeInTheDocument();
} );

it.each( [ '', '   ', undefined ] )(
	'shows the fallback label for an untitled event (%p)',
	( title ) => {
		renderCell( { events: [ { uid: 'standalone_1@site', title } ] } );

		expect( screen.getByText( '(untitled event)' ) ).toBeInTheDocument();
	}
);

it( 'shows the add button only when creation is enabled', () => {
	const onAddEvent = jest.fn();
	const { unmount } = renderCell( { onAddEvent } );
	fireEvent.click( screen.getByRole( 'button', { name: 'Add event' } ) );
	expect( onAddEvent ).toHaveBeenCalledWith( new Date( 2026, 6, 15 ) );
	unmount();

	renderCell();
	expect(
		screen.queryByRole( 'button', { name: 'Add event' } )
	).not.toBeInTheDocument();
} );

it( 'links local events to management and keeps a destination link', () => {
	renderCell( {
		manageEventUrl: MANAGE,
		events: [
			{
				uid: 'fair_event_7_2@site',
				title: 'Concert',
				url: 'https://site/concert/',
				categories: [ { name: 'Music' } ],
			},
		],
	} );

	const title = screen.getByRole( 'link', { name: /Concert/ } );
	expect( title ).toHaveAttribute( 'href', `${ MANAGE }&event_date_id=2` );
	expect( title ).toHaveAttribute( 'title', 'Concert\nMusic' );
	expect(
		title.querySelector( '.dashicons-admin-post' )
	).toBeInTheDocument();
	expect( screen.getByText( 'Music' ) ).toBeInTheDocument();

	const destination = screen.getByTitle( 'Open link destination' );
	expect( destination ).toHaveAttribute( 'href', 'https://site/concert/' );
	expect( destination ).not.toHaveAttribute( 'target' );
} );

it( 'links feed events to their destination and opens external pages safely', () => {
	renderCell( {
		events: [
			{
				uid: 'abc@elsewhere',
				title: 'Partner festival',
				url: 'https://example.com/festival',
			},
		],
	} );

	const row = document.querySelector( '.fair-events-calendar-event-row' );
	expect( row ).toHaveClass( 'link-type-external' );
	expect(
		screen.getByRole( 'link', { name: /Partner festival/ } )
	).toHaveAttribute( 'href', 'https://example.com/festival' );

	const destination = screen.getByTitle( 'Open link destination' );
	expect( destination ).toHaveAttribute( 'target', '_blank' );
	expect( destination ).toHaveAttribute( 'rel', 'noopener noreferrer' );
} );

it( 'renders an event without any destination as read-only', () => {
	renderCell( {
		events: [ { uid: 'standalone_3@site', title: 'Draft', url: '' } ],
	} );

	expect(
		screen.queryByRole( 'link', { name: /Draft/ } )
	).not.toBeInTheDocument();
	expect( screen.getByText( 'Draft' ) ).toHaveClass(
		'fair-events-calendar-event-readonly'
	);
	expect(
		document.querySelector( '.dashicons-editor-unlink' )
	).toBeInTheDocument();
} );
