/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from '@testing-library/react';
import SalesSummaryCard, { blockedReason } from '../SalesSummaryCard.js';
import {
	loadSalesSummary,
	previewSalesSummary,
	saveSalesSummary,
	testSalesSummary,
} from '../sales-summary-api.js';

jest.mock( '../sales-summary-api.js' );

const payload = ( settings = {}, extra = {} ) => ( {
	report: 'default',
	settings: {
		frequency: 'off',
		time_of_day: '08:00',
		day_of_week: 1,
		fallback_email: '',
		...settings,
	},
	available: true,
	organizer_resolution_available: false,
	recipient_count: 2,
	next_run: null,
	last_run: null,
	...extra,
} );

const renderCard = async () => {
	render(
		<SalesSummaryCard
			report="default"
			title="Sales summary"
			description="Summary"
		/>
	);
	await screen.findByLabelText( 'How often' );
};

// Notices are also spoken through the a11y live region; read the visible one.
const NOTICE = { selector: '.components-notice__content' };

const save = () => screen.getByRole( 'button', { name: 'Save sales summary' } );

const click = async ( element ) => {
	await act( async () => {
		fireEvent.click( element );
	} );
};

beforeEach( () => {
	loadSalesSummary.mockResolvedValue( payload() );
} );

afterEach( () => {
	jest.clearAllMocks();
} );

test( 'starts off with only the fallback address, explaining who receives it', async () => {
	await renderCard();

	expect( screen.getByLabelText( 'How often' ) ).toHaveValue( 'off' );
	expect( screen.queryByLabelText( 'Weekday' ) ).not.toBeInTheDocument();
	expect(
		screen.queryByLabelText( 'Delivery time' )
	).not.toBeInTheDocument();
	expect(
		screen.getByText( /each of the 2 notification addresses/ )
	).toBeInTheDocument();
	expect( save() ).toBeDisabled();
} );

test( 'shows the time for daily and the weekday only for weekly', async () => {
	await renderCard();

	fireEvent.change( screen.getByLabelText( 'How often' ), {
		target: { value: 'daily' },
	} );
	expect( screen.getByLabelText( 'Delivery time' ) ).toBeInTheDocument();
	expect( screen.queryByLabelText( 'Weekday' ) ).not.toBeInTheDocument();

	fireEvent.change( screen.getByLabelText( 'How often' ), {
		target: { value: 'weekly' },
	} );
	expect( screen.getByLabelText( 'Weekday' ) ).toBeInTheDocument();
} );

test( 'turning it on without a fallback address says why it cannot be saved', async () => {
	await renderCard();

	fireEvent.change( screen.getByLabelText( 'How often' ), {
		target: { value: 'daily' },
	} );

	expect( save() ).toBeDisabled();
	expect(
		screen.getByText(
			'Add a fallback email address before turning the sales summary on.'
		)
	).toBeInTheDocument();
} );

test( 'saves only this report and shows the saved settings', async () => {
	saveSalesSummary.mockResolvedValue(
		payload( {
			frequency: 'weekly',
			day_of_week: 3,
			fallback_email: 'team@example.com',
		} )
	);
	await renderCard();

	fireEvent.change( screen.getByLabelText( 'How often' ), {
		target: { value: 'weekly' },
	} );
	fireEvent.change( screen.getByLabelText( 'Weekday' ), {
		target: { value: '3' },
	} );
	fireEvent.change( screen.getByLabelText( 'Fallback email address' ), {
		target: { value: ' team@example.com ' },
	} );
	await click( save() );

	expect( saveSalesSummary ).toHaveBeenCalledWith( 'default', {
		frequency: 'weekly',
		time_of_day: '08:00',
		day_of_week: 3,
		fallback_email: 'team@example.com',
	} );
	expect(
		await screen.findByText( 'Sales summary saved.', NOTICE )
	).toBeVisible();
	expect( screen.getByLabelText( 'Weekday' ) ).toHaveValue( '3' );
	expect( save() ).toBeDisabled();
} );

test( 'keeps what was entered when the save fails, with the server message', async () => {
	saveSalesSummary.mockRejectedValue( {
		message: 'Invalid parameter(s)',
		data: {
			params: { fallback_email: 'Enter one valid fallback email.' },
		},
	} );
	await renderCard();

	fireEvent.change( screen.getByLabelText( 'How often' ), {
		target: { value: 'daily' },
	} );
	fireEvent.change( screen.getByLabelText( 'Fallback email address' ), {
		target: { value: 'team@example.com' },
	} );
	await click( save() );

	expect(
		await screen.findByText( 'Enter one valid fallback email.', NOTICE )
	).toBeVisible();
	expect( screen.getByLabelText( 'How often' ) ).toHaveValue( 'daily' );
	expect( screen.getByLabelText( 'Fallback email address' ) ).toHaveValue(
		'team@example.com'
	);
	expect( save() ).toBeEnabled();
} );

test( 'previews and tests with the saved cadence', async () => {
	loadSalesSummary.mockResolvedValue(
		payload( { frequency: 'daily', fallback_email: 'team@example.com' } )
	);
	previewSalesSummary.mockResolvedValue( {
		subject: 'Sales summary for Site: Nov 17',
		html: '<p>Concert</p>',
	} );
	testSalesSummary.mockResolvedValue( { sent_to: 'admin@example.com' } );
	await renderCard();

	await click( screen.getByRole( 'button', { name: 'Preview' } ) );
	expect( previewSalesSummary ).toHaveBeenCalledWith( 'default', 'daily' );
	expect(
		await screen.findByText( 'Sales summary for Site: Nov 17' )
	).toBeVisible();
	expect(
		screen.getByRole( 'group', { name: 'Sales summary preview' } )
	).toHaveTextContent( 'Concert' );

	await click(
		screen.getByRole( 'button', { name: 'Send test email to me' } )
	);
	expect( testSalesSummary ).toHaveBeenCalledWith( 'default', 'daily' );
	expect(
		await screen.findByText( /delivery to admin@example.com/, NOTICE )
	).toBeVisible();
} );

test( 'a paused report says so and cannot be changed', async () => {
	loadSalesSummary.mockResolvedValue(
		payload( { frequency: 'daily' }, { available: false } )
	);
	await renderCard();

	expect(
		screen.getByText( /paused while organizer management is off/, NOTICE )
	).toBeInTheDocument();
	expect( screen.getByLabelText( 'How often' ) ).toBeDisabled();
	expect( screen.getByRole( 'button', { name: 'Preview' } ) ).toBeDisabled();
} );

test( 'blockedReason checks the address and time', () => {
	const base = {
		frequency: 'daily',
		time_of_day: '08:00',
		day_of_week: '1',
		fallback_email: 'team@example.com',
	};
	expect( blockedReason( base ) ).toBeNull();
	expect(
		blockedReason( { ...base, fallback_email: 'not-an-address' } )
	).toMatch( /valid fallback/ );
	expect( blockedReason( { ...base, time_of_day: '' } ) ).toMatch(
		/hours and minutes/
	);
	expect(
		blockedReason( { ...base, frequency: 'off', fallback_email: '' } )
	).toBeNull();
} );

test( 'a load failure can be retried', async () => {
	loadSalesSummary.mockRejectedValueOnce( { message: 'Server error' } );
	render( <SalesSummaryCard report="default" title="Sales summary" /> );

	expect( await screen.findByText( 'Server error', NOTICE ) ).toBeVisible();
	await click( screen.getByRole( 'button', { name: 'Try again' } ) );
	await waitFor( () =>
		expect( screen.getByLabelText( 'How often' ) ).toBeInTheDocument()
	);
} );
