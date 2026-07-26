/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import OrganizerTab from '../OrganizerTab.js';
import { loadOrganizerSettings, saveSettings } from '../settings-api.js';

jest.mock('../settings-api.js');

const baseOrganizer = {
	name: '',
	type: 'Organization',
	street_address: '',
	address_locality: '',
	address_region: '',
	postal_code: '',
	address_country: '',
	same_as: [],
};

beforeEach(() => {
	loadOrganizerSettings.mockResolvedValue({ ...baseOrganizer });
	saveSettings.mockResolvedValue({});
});

afterEach(() => {
	jest.clearAllMocks();
});

const nameField = () => screen.getByLabelText('Name');
const saveButton = () =>
	screen.getByRole('button', { name: /Save organizer/i });

test('renders and populates fields from loaded settings', async () => {
	loadOrganizerSettings.mockResolvedValue({
		...baseOrganizer,
		name: 'Acme Club',
		type: 'SportsClub',
	});

	render(<OrganizerTab onNotice={jest.fn()} />);

	await waitFor(() => expect(nameField()).toHaveValue('Acme Club'));
	expect(screen.getByLabelText('Organization type')).toHaveValue(
		'SportsClub'
	);
});

test('adding a link renders a new row, removing it takes it away', async () => {
	render(<OrganizerTab onNotice={jest.fn()} />);

	await waitFor(() => expect(nameField()).toBeInTheDocument());

	fireEvent.click(screen.getByRole('button', { name: /Add link/i }));
	expect(screen.getAllByLabelText('Profile URL')).toHaveLength(1);

	fireEvent.click(screen.getByRole('button', { name: /Remove/i }));
	expect(screen.queryAllByLabelText('Profile URL')).toHaveLength(0);
});

test('an invalid URL blocks save and shows a message', async () => {
	render(<OrganizerTab onNotice={jest.fn()} />);

	await waitFor(() => expect(nameField()).toBeInTheDocument());

	fireEvent.click(screen.getByRole('button', { name: /Add link/i }));
	fireEvent.change(screen.getByLabelText('Profile URL'), {
		target: { value: 'not a url' },
	});

	expect(screen.getByText(/Enter a valid URL/i)).toBeInTheDocument();
	expect(saveButton()).toBeDisabled();
});

test('save sends fair_events_organizer with the edited values', async () => {
	render(<OrganizerTab onNotice={jest.fn()} />);

	await waitFor(() => expect(nameField()).toBeInTheDocument());

	fireEvent.change(nameField(), { target: { value: 'Acme Club' } });
	fireEvent.click(saveButton());

	await waitFor(() => expect(saveSettings).toHaveBeenCalledTimes(1));
	expect(saveSettings).toHaveBeenCalledWith({
		fair_events_organizer: expect.objectContaining({ name: 'Acme Club' }),
	});
});
